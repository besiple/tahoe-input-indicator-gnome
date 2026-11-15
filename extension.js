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
        // 40ms debounce
        if (now - this._lastSpawnTime < 40000) return;
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
        const startX = px + 12;
        const startY = py - 14;

        // 1. Organic Steam Wisps (струйки и завитки пара)
        const wispConfigs = [
            { offsetX: -2, offsetY: 2,  w: 6, h: 14, driftX: -6, driftY: -32, dur: 480, delay: 0 },
            { offsetX: 7,  offsetY: -3, w: 8, h: 18, driftX: 3,  driftY: -40, dur: 530, delay: 25 },
            { offsetX: 15, offsetY: 3,  w: 5, h: 12, driftX: 7,  driftY: -28, dur: 460, delay: 45 },
        ];

        for (const cfg of wispConfigs) {
            const wisp = new St.Bin({
                style_class: 'vapor-wisp',
                reactive: false,
                can_focus: false,
                style: `background-color: rgba(225, 240, 255, 0.25); ` +
                       `border-radius: 4px 6px 3px 5px; ` +
                       `width: ${cfg.w}px; height: ${cfg.h}px; ` +
                       `box-shadow: 0 -2px 10px rgba(180, 220, 255, 0.55);`,
            });
            wisp.set_pivot_point(0.5, 1.0);
            wisp.set_position(startX + cfg.offsetX, startY + cfg.offsetY);
            wisp.scale_x = 0.5;
            wisp.scale_y = 0.5;
            wisp.opacity = 0;

            Main.uiGroup.add_child(wisp);

            const startRise = () => {
                wisp.ease({
                    opacity: 200,
                    scale_x: 1.0,
                    scale_y: 1.0,
                    duration: 65,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    onComplete: () => {
                        wisp.ease({
                            opacity: 0,
                            scale_x: 1.6,
                            scale_y: 2.3, // elongates vertically like real thermal steam
                            x: startX + cfg.offsetX + cfg.driftX + (Math.random() * 4 - 2),
                            y: startY + cfg.offsetY + cfg.driftY,
                            duration: cfg.dur,
                            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                            onComplete: () => wisp.destroy(),
                        });
                    },
                });
            };

            if (cfg.delay > 0) {
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, cfg.delay, () => {
                    startRise();
                    return GLib.SOURCE_REMOVE;
                });
            } else {
                startRise();
            }
        }

        // 2. Compact Glowing Steam Text (en / ru)
        const label = new St.Label({
            style_class: 'vapor-text',
            text: text,
            reactive: false,
            can_focus: false,
            style: 'font-weight: 800; ' +
                   'font-size: 11.5pt; ' +
                   'color: #ffffff; ' +
                   'text-shadow: 0 0 6px rgba(255, 255, 255, 0.95), ' +
                   '0 -2px 12px rgba(170, 215, 255, 0.8), ' +
                   '0 -4px 18px rgba(130, 185, 255, 0.5);',
        });
        label.set_pivot_point(0.5, 0.5);
        label.set_position(startX, startY);
        label.scale_x = 0.7;
        label.scale_y = 0.7;
        label.opacity = 0;

        Main.uiGroup.add_child(label);

        label.ease({
            opacity: 255,
            scale_x: 1.05,
            scale_y: 1.05,
            duration: 60,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                const driftX = (Math.random() * 6) - 3;
                label.ease({
                    opacity: 0,
                    scale_x: 1.25,
                    scale_y: 1.25,
                    x: startX + driftX,
                    y: startY - 26,
                    duration: 480,
                    mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                    onComplete: () => label.destroy(),
                });
            },
        });
    }
}
