'use strict';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Keyboard from 'resource:///org/gnome/shell/ui/status/keyboard.js';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

export default class TahoeInputIndicatorExtension extends Extension {
    enable() {
        this._isManager = Keyboard.getInputSourceManager();
        this._signals = [];
        this._lastSpawnTime = 0;
        this._origPopupShow = null;
        this._activePill = null;
        this._activeLabel = null;
        this._fadeTimeoutId = null;

        this._setupKeybindings();
        this._connectSignals();

        console.log('[macOS Tahoe Input Indicator] Extension enabled');
    }

    disable() {
        this._disconnectSignals();
        this._restoreKeybindings();
        this._cleanupPill();

        console.log('[macOS Tahoe Input Indicator] Extension disabled');
    }

    _cleanupPill() {
        if (this._fadeTimeoutId) {
            GLib.source_remove(this._fadeTimeoutId);
            this._fadeTimeoutId = null;
        }
        if (this._activePill) {
            this._activePill.destroy();
            this._activePill = null;
            this._activeLabel = null;
        }
    }

    _setupKeybindings() {
        try {
            Main.wm.removeKeybinding('switch-input-source');
            Main.wm.removeKeybinding('switch-input-source-backward');
        } catch (e) {}

        const wmSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.wm.keybindings' });

        Main.wm.addKeybinding(
            'switch-input-source',
            wmSettings,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.ALL,
            () => this._cycleInputSource(false)
        );

        Main.wm.addKeybinding(
            'switch-input-source-backward',
            wmSettings,
            Meta.KeyBindingFlags.IS_REVERSED,
            Shell.ActionMode.ALL,
            () => this._cycleInputSource(true)
        );

        // Suppress any default center switcher popup
        if (Keyboard.InputSourcePopup && Keyboard.InputSourcePopup.prototype) {
            this._origPopupShow = Keyboard.InputSourcePopup.prototype.show;
            Keyboard.InputSourcePopup.prototype.show = function () {
                return false;
            };
        }
    }

    _restoreKeybindings() {
        try {
            Main.wm.removeKeybinding('switch-input-source');
            Main.wm.removeKeybinding('switch-input-source-backward');

            if (this._isManager && typeof this._isManager._switchInputSource === 'function') {
                const wmSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.wm.keybindings' });
                Main.wm.addKeybinding(
                    'switch-input-source',
                    wmSettings,
                    Meta.KeyBindingFlags.NONE,
                    Shell.ActionMode.ALL,
                    this._isManager._switchInputSource.bind(this._isManager)
                );
                Main.wm.addKeybinding(
                    'switch-input-source-backward',
                    wmSettings,
                    Meta.KeyBindingFlags.IS_REVERSED,
                    Shell.ActionMode.ALL,
                    this._isManager._switchInputSource.bind(this._isManager)
                );
            }
        } catch (e) {}

        if (this._origPopupShow && Keyboard.InputSourcePopup && Keyboard.InputSourcePopup.prototype) {
            Keyboard.InputSourcePopup.prototype.show = this._origPopupShow;
            this._origPopupShow = null;
        }
    }

    _cycleInputSource(isBackward) {
        if (!this._isManager) return;
        if (this._isManager.isLocked && this._isManager.isLocked()) return;

        const mru = this._isManager._mruSources;
        if (!mru || mru.length < 2) return;

        const target = isBackward ? mru[mru.length - 1] : mru[1];
        if (target) {
            target.activate(true);
        }
    }

    _connectSignals() {
        if (this._isManager) {
            const id = this._isManager.connect('current-source-changed', () => {
                this._triggerIndicator();
            });
            this._signals.push({ obj: this._isManager, id });
        }

        try {
            const modId = global.display.connect('modifiers-accelerator-activated', () => {
                GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                    this._triggerIndicator();
                    return GLib.SOURCE_REMOVE;
                });
            });
            this._signals.push({ obj: global.display, id: modId });
        } catch (e) {}
    }

    _disconnectSignals() {
        for (const sig of this._signals) {
            try {
                if (sig.obj && sig.id) {
                    sig.obj.disconnect(sig.id);
                }
            } catch (e) {}
        }
        this._signals = [];
    }

    _triggerIndicator() {
        const now = GLib.get_monotonic_time();
        if (now - this._lastSpawnTime < 35000) return;
        this._lastSpawnTime = now;

        const current = this._isManager ? this._isManager.currentSource : null;
        if (!current) return;

        const raw = current.shortName || current.id || '??';
        const code = raw.toUpperCase().slice(0, 3); // 'RU', 'EN'

        this._showMicroPill(code);
    }

    _showMicroPill(text) {
        if (Main.sessionMode && Main.sessionMode.isLocked) return;

        const [px, py] = global.get_pointer();
        const startX = px + 12;
        const startY = py - 10;

        // Rapid switch: if already visible, pulse in place
        if (this._activePill && this._activeLabel && this._activePill.get_parent() && this._activePill.opacity > 60) {
            if (this._fadeTimeoutId) {
                GLib.source_remove(this._fadeTimeoutId);
                this._fadeTimeoutId = null;
            }

            this._activeLabel.text = text;
            this._activePill.remove_all_transitions();
            this._activePill.set_position(startX, startY);
            this._activePill.opacity = 255;
            this._activePill.scale_x = 1.20;
            this._activePill.scale_y = 1.20;

            this._activePill.ease({
                scale_x: 1.0,
                scale_y: 1.0,
                duration: 65,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    this._startFloatAndFade(this._activePill, startX, startY);
                },
            });
            return;
        }

        this._cleanupPill();

        // Ultra-compact, borderless obsidian glass micro-capsule
        const pill = new St.Bin({
            style_class: 'tahoe-micro-pill',
            reactive: false,
            can_focus: false,
            style: 'background-color: rgba(16, 16, 20, 0.82); ' +
                   'border-radius: 6px; ' +
                   'padding: 2px 7px; ' +
                   'box-shadow: 0 3px 12px rgba(0, 0, 0, 0.40);',
        });

        const label = new St.Label({
            style_class: 'tahoe-micro-label',
            text: text,
            reactive: false,
            can_focus: false,
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.CENTER,
            style: 'font-weight: 700; ' +
                   'font-size: 9.5pt; ' +
                   'color: rgba(255, 255, 255, 0.95); ' +
                   'letter-spacing: 0.6px;',
        });

        pill.set_child(label);
        pill.set_pivot_point(0.5, 0.5);
        pill.set_position(startX, startY);
        pill.scale_x = 0.65;
        pill.scale_y = 0.65;
        pill.opacity = 0;

        Main.uiGroup.add_child(pill);

        this._activePill = pill;
        this._activeLabel = label;

        // Phase 1: Micro-spring pop in (60ms)
        pill.ease({
            opacity: 255,
            scale_x: 1.04,
            scale_y: 1.04,
            duration: 60,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                pill.ease({
                    scale_x: 1.0,
                    scale_y: 1.0,
                    duration: 35,
                    mode: Clutter.AnimationMode.EASE_IN_QUAD,
                    onComplete: () => {
                        this._startFloatAndFade(pill, startX, startY);
                    },
                });
            },
        });
    }

    _startFloatAndFade(pill, originX, originY) {
        // Hold for 120ms, then float upward and dissolve gracefully
        this._fadeTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 120, () => {
            this._fadeTimeoutId = null;
            if (!pill || !pill.get_parent()) return GLib.SOURCE_REMOVE;

            const driftX = (Math.random() * 4) - 2;
            pill.ease({
                opacity: 0,
                scale_x: 1.08,
                scale_y: 1.08,
                x: originX + driftX,
                y: originY - 18,
                duration: 440,
                mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                onComplete: () => {
                    if (this._activePill === pill) {
                        this._cleanupPill();
                    } else {
                        pill.destroy();
                    }
                },
            });
            return GLib.SOURCE_REMOVE;
        });
    }
}
