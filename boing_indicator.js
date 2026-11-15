'use strict';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Keyboard from 'resource:///org/gnome/shell/ui/status/keyboard.js';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';

export default class BoingIndicatorImpl {
    constructor(extension) {
        this._extension = extension;
        this._isManager = Keyboard.getInputSourceManager();
        this._signals = [];
        this._lastSpawnTime = 0;
        this._origPopupShow = null;
        this._activeCloud = null;
        this._activeLabel = null;
        this._holdTimeoutId = null;
    }

    enable() {
        this._setupKeybindings();
        this._connectSignals();
        console.log('[Boing Cloud Indicator] Implementation active');
    }

    disable() {
        this._disconnectSignals();
        this._restoreKeybindings();
        this._cleanupCloud();
        console.log('[Boing Cloud Indicator] Implementation disabled');
    }

    _cleanupCloud() {
        if (this._holdTimeoutId) {
            GLib.source_remove(this._holdTimeoutId);
            this._holdTimeoutId = null;
        }
        if (this._activeCloud) {
            this._activeCloud.remove_all_transitions();
            this._activeCloud.destroy();
            this._activeCloud = null;
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

        // Suppress default center modal switcher popup
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
        if (now - this._lastSpawnTime < 30000) return;
        this._lastSpawnTime = now;

        const current = this._isManager ? this._isManager.currentSource : null;
        if (!current) return;

        const raw = current.shortName || current.id || '??';
        let code = raw.toUpperCase().slice(0, 2);
        if (code === 'US') code = 'EN';

        this._showBoingCloud(code);
    }

    _showBoingCloud(text) {
        if (Main.sessionMode && Main.sessionMode.isLocked) return;

        const [px, py] = global.get_pointer();
        const startX = px + 14;
        const startY = py - 14;

        // Rapid switch: Boing bounce in place with new text
        if (this._activeCloud && this._activeLabel && this._activeCloud.get_parent() && this._activeCloud.opacity > 50) {
            if (this._holdTimeoutId) {
                GLib.source_remove(this._holdTimeoutId);
                this._holdTimeoutId = null;
            }

            this._activeLabel.text = text;
            this._activeCloud.remove_all_transitions();
            this._activeCloud.set_position(startX, startY);
            this._activeCloud.opacity = 255;

            // In-place Boing squash & stretch
            this._activeCloud.scale_x = 1.25;
            this._activeCloud.scale_y = 0.78;

            this._activeCloud.ease({
                scale_x: 0.90,
                scale_y: 1.14,
                duration: 45,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    this._activeCloud.ease({
                        scale_x: 1.0,
                        scale_y: 1.0,
                        duration: 40,
                        mode: Clutter.AnimationMode.EASE_IN_QUAD,
                        onComplete: () => {
                            this._scheduleBahPoof(this._activeCloud, startX, startY);
                        },
                    });
                },
            });
            return;
        }

        this._cleanupCloud();

        // Fluffy borderless cloud container (soft bubbly rounded pill)
        const cloud = new St.Bin({
            style_class: 'boing-cloud',
            reactive: false,
            can_focus: false,
            style: 'background-color: rgba(22, 25, 34, 0.88); ' +
                   'border-radius: 12px; ' +
                   'padding: 3px 10px; ' +
                   'min-width: 32px; ' +
                   'box-shadow: 0 4px 16px rgba(0, 0, 0, 0.45), 0 0 12px rgba(180, 215, 255, 0.30);',
        });

        const label = new St.Label({
            style_class: 'boing-label',
            text: text,
            reactive: false,
            can_focus: false,
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.CENTER,
            style: 'font-weight: 800; ' +
                   'font-size: 9.5pt; ' +
                   'color: #ffffff; ' +
                   'letter-spacing: 0.8px; ' +
                   'text-shadow: 0 0 6px rgba(255, 255, 255, 0.4);',
        });

        if (label.clutter_text) {
            label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
            label.clutter_text.line_wrap = false;
        }

        cloud.set_child(label);
        cloud.set_pivot_point(0.5, 0.5);
        cloud.set_position(startX, startY);
        cloud.scale_x = 0.25;
        cloud.scale_y = 0.25;
        cloud.opacity = 0;

        Main.uiGroup.add_child(cloud);

        this._activeCloud = cloud;
        this._activeLabel = label;

        // Stage 1: "BOING!" (Elastic Squash & Stretch entry)
        // 1a: Explosive squash expansion
        cloud.ease({
            opacity: 255,
            scale_x: 1.28,
            scale_y: 0.74,
            duration: 65,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                // 1b: Rebound stretch
                cloud.ease({
                    scale_x: 0.88,
                    scale_y: 1.16,
                    duration: 50,
                    mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
                    onComplete: () => {
                        // 1c: Settle to 1.0
                        cloud.ease({
                            scale_x: 1.0,
                            scale_y: 1.0,
                            duration: 45,
                            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                            onComplete: () => {
                                this._scheduleBahPoof(cloud, startX, startY);
                            },
                        });
                    },
                });
            },
        });
    }

    _scheduleBahPoof(cloud, originX, originY) {
        // Hold for ~240ms, then "BAH!" poof dissolve
        this._holdTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 240, () => {
            this._holdTimeoutId = null;
            if (!cloud || !cloud.get_parent()) return GLib.SOURCE_REMOVE;

            // Spawn 3 tiny comic poof micro-bubbles
            this._spawnPoofBubbles(originX, originY);

            // "BAH!" burst: expands quickly and pops away
            cloud.ease({
                opacity: 0,
                scale_x: 1.40,
                scale_y: 1.40,
                x: originX + ((Math.random() * 6) - 3),
                y: originY - 14,
                duration: 190,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    if (this._activeCloud === cloud) {
                        this._cleanupCloud();
                    } else {
                        cloud.destroy();
                    }
                },
            });
            return GLib.SOURCE_REMOVE;
        });
    }

    _spawnPoofBubbles(cx, cy) {
        const offsets = [
            { x: -11, y: -9,  size: 7 },
            { x: 13,  y: -11, size: 8 },
            { x: 2,   y: -17, size: 6 },
        ];

        for (const pt of offsets) {
            const bubble = new St.Bin({
                reactive: false,
                can_focus: false,
                style: `background-color: rgba(220, 235, 255, 0.45); ` +
                       `border-radius: 999px; ` +
                       `width: ${pt.size}px; height: ${pt.size}px; ` +
                       `box-shadow: 0 0 6px rgba(180, 220, 255, 0.6);`,
            });
            bubble.set_pivot_point(0.5, 0.5);
            bubble.set_position(cx + pt.x, cy + pt.y);
            bubble.scale_x = 0.35;
            bubble.scale_y = 0.35;
            bubble.opacity = 210;

            Main.uiGroup.add_child(bubble);

            bubble.ease({
                opacity: 0,
                scale_x: 1.5,
                scale_y: 1.5,
                x: cx + pt.x * 1.6,
                y: cy + pt.y * 1.6,
                duration: 210,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => bubble.destroy(),
            });
        }
    }
}
