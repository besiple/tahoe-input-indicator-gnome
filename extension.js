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

        this._setupKeybindings();
        this._connectSignals();

        console.log('[macOS Tahoe Input Indicator] Extension enabled');
    }

    disable() {
        this._disconnectSignals();
        this._restoreKeybindings();

        console.log('[macOS Tahoe Input Indicator] Extension disabled');
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
        // 40ms debounce
        if (now - this._lastSpawnTime < 40000) return;
        this._lastSpawnTime = now;

        const current = this._isManager ? this._isManager.currentSource : null;
        if (!current) return;

        const raw = current.shortName || current.id || '??';
        const code = raw.toUpperCase().slice(0, 3); // 'RU', 'EN'

        this._spawnCapsule(code);
    }

    _spawnCapsule(text) {
        if (Main.sessionMode && Main.sessionMode.isLocked) return;

        const [px, py] = global.get_pointer();
        const startX = px + 12;
        const startY = py - 14;

        // Clean, compact macOS Tahoe / Dynamic capsule
        const pill = new St.Bin({
            style_class: 'tahoe-vapor-pill',
            reactive: false,
            can_focus: false,
            style: 'background-color: rgba(18, 18, 22, 0.88); ' +
                   'border: 1px solid rgba(255, 255, 255, 0.22); ' +
                   'border-radius: 8px; ' +
                   'padding: 3px 8px; ' +
                   'box-shadow: 0 4px 14px rgba(0, 0, 0, 0.55);',
        });

        const label = new St.Label({
            style_class: 'tahoe-vapor-label',
            text: text,
            reactive: false,
            can_focus: false,
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.CENTER,
            style: 'font-weight: 800; ' +
                   'font-size: 10.5pt; ' +
                   'color: #ffffff; ' +
                   'letter-spacing: 0.5px;',
        });

        pill.set_child(label);
        pill.set_pivot_point(0.5, 0.5);
        pill.set_position(startX, startY);
        pill.scale_x = 0.75;
        pill.scale_y = 0.75;
        pill.opacity = 0;

        Main.uiGroup.add_child(pill);

        // Phase 1: Crisp pop in (65ms)
        pill.ease({
            opacity: 255,
            scale_x: 1.0,
            scale_y: 1.0,
            duration: 65,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                // Phase 2: Smooth upward float & clean evaporate (480ms)
                const driftX = (Math.random() * 4) - 2;
                pill.ease({
                    opacity: 0,
                    scale_x: 1.15,
                    scale_y: 1.15,
                    x: startX + driftX,
                    y: startY - 26,
                    duration: 480,
                    mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                    onComplete: () => pill.destroy(),
                });
            },
        });
    }
}
