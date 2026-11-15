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

export default class VaporInputIndicatorExtension extends Extension {
    enable() {
        this._isManager = Keyboard.getInputSourceManager();
        this._signals = [];
        this._lastSpawnTime = 0;
        this._origPopupShow = null;

        this._setupKeybindings();
        this._connectSignals();

        console.log('[Steam Vapor Input Indicator] Extension enabled');
    }

    disable() {
        this._disconnectSignals();
        this._restoreKeybindings();

        console.log('[Steam Vapor Input Indicator] Extension disabled');
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
                this._triggerSteam();
            });
            this._signals.push({ obj: this._isManager, id });
        }

        try {
            const modId = global.display.connect('modifiers-accelerator-activated', () => {
                GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                    this._triggerSteam();
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

    _triggerSteam() {
        const now = GLib.get_monotonic_time();
        // 50ms debounce
        if (now - this._lastSpawnTime < 50000) return;
        this._lastSpawnTime = now;

        const current = this._isManager ? this._isManager.currentSource : null;
        if (!current) return;

        const raw = current.shortName || current.id || '??';
        const code = raw.toLowerCase().slice(0, 3); // 'en', 'ru'

        this._spawnSteam(code);
    }

    _spawnSteam(text) {
        if (Main.sessionMode && Main.sessionMode.isLocked) return;

        const [px, py] = global.get_pointer();
        const startX = px + 14;
        const startY = py - 18;

        // 1. Soft steam cloud puff behind text
        const puff = new St.Bin({
            style_class: 'vapor-puff',
            reactive: false,
            can_focus: false,
            style: 'background-color: rgba(220, 240, 255, 0.22); ' +
                   'border-radius: 999px; ' +
                   'width: 36px; height: 36px; ' +
                   'box-shadow: 0 0 24px rgba(180, 220, 255, 0.65);',
        });
        puff.set_pivot_point(0.5, 0.5);
        puff.set_position(startX - 6, startY - 4);
        puff.scale_x = 0.4;
        puff.scale_y = 0.4;
        puff.opacity = 0;

        Main.uiGroup.add_child(puff);

        // 2. Kill-effect / Steam text actor
        const label = new St.Label({
            style_class: 'vapor-text',
            text: text,
            reactive: false,
            can_focus: false,
            style: 'font-weight: 900; ' +
                   'font-size: 15pt; ' +
                   'color: #ffffff; ' +
                   'text-shadow: 0 0 10px rgba(255, 255, 255, 0.95), ' +
                   '0 0 20px rgba(180, 220, 255, 0.85), ' +
                   '0 -4px 14px rgba(140, 190, 255, 0.6);',
        });
        label.set_pivot_point(0.5, 0.5);
        label.set_position(startX, startY);
        label.scale_x = 0.55;
        label.scale_y = 0.55;
        label.opacity = 0;

        Main.uiGroup.add_child(label);

        // Animation Phase 1: Snap into existence (60ms)
        puff.ease({
            opacity: 180,
            scale_x: 1.0,
            scale_y: 1.0,
            duration: 60,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                // Phase 2: Steam expands, rises upward and dissolves
                const driftX = (Math.random() * 12) - 6;
                puff.ease({
                    opacity: 0,
                    scale_x: 2.8,
                    scale_y: 2.8,
                    x: startX - 6 + driftX,
                    y: startY - 65,
                    duration: 600,
                    mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                    onComplete: () => puff.destroy(),
                });
            },
        });

        label.ease({
            opacity: 255,
            scale_x: 1.05,
            scale_y: 1.05,
            duration: 60,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                // Phase 2: Ascend and evaporate into thin air like bullet smoke / steam
                const driftX = (Math.random() * 10) - 5;
                label.ease({
                    opacity: 0,
                    scale_x: 1.45,
                    scale_y: 1.45,
                    x: startX + driftX,
                    y: startY - 50,
                    duration: 620,
                    mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                    onComplete: () => label.destroy(),
                });
            },
        });
    }
}
