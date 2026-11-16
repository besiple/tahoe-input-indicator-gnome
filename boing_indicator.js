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

const TAP_LINGER_MS = 700;        // Linger time on screen after quick Alt+Space tap
const RELEASE_LINGER_MS = 450;    // Linger time after releasing held modifier
const FADE_OUT_DURATION_MS = 320; // Smooth disappearing duration

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
        this._followLoopId = null;

        this._currentX = 0;
        this._currentY = 0;
        this._currentTilt = 0;
        this._spawnTime = 0;
        this._releaseTime = 0;
        this._wasHeld = false;
        this._side = 1; // 1 = right of cursor, -1 = left of cursor
        this._prevPointerX = null;
        this._prevPointerY = null;
    }

    enable() {
        this._setupKeybindings();
        this._connectSignals();
        console.log('[Boing Cloud Indicator] Clean minimalist style active');
    }

    disable() {
        this._disconnectSignals();
        this._restoreKeybindings();
        this._cleanupCloud();
        console.log('[Boing Cloud Indicator] Implementation disabled');
    }

    _cleanupCloud() {
        this._stopFollowLoop();
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
        this._wasHeld = false;
        this._releaseTime = 0;
        this._prevPointerX = null;
        this._prevPointerY = null;
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

        const [px, py, mods] = global.get_pointer();

        const primaryMonitor = Main.layoutManager ? Main.layoutManager.primaryMonitor : null;
        if (this._prevPointerX === null) {
            if (primaryMonitor && px + 70 > primaryMonitor.x + primaryMonitor.width) {
                this._side = -1;
            } else {
                this._side = 1;
            }
        }
        this._prevPointerX = px;
        this._prevPointerY = py;

        const initialWidth = 46;
        const targetX = this._side === 1 ? px + 18 : px - initialWidth - 16;
        const targetY = py - 16;

        const isModifierHeld = (mods & (
            Clutter.ModifierType.MOD1_MASK |
            Clutter.ModifierType.SUPER_MASK |
            Clutter.ModifierType.CONTROL_MASK
        )) !== 0;

        // Rapid switch: Boing bounce in place with new text
        if (this._activeCloud && this._activeLabel && this._activeCloud.get_parent() && this._activeCloud.opacity > 50) {
            this._spawnTime = GLib.get_monotonic_time();
            this._releaseTime = 0;
            this._activeLabel.text = text;

            if (isModifierHeld) {
                this._wasHeld = true;
            }

            // Clean in-place squash & stretch pulse
            this._activeCloud.remove_all_transitions();
            this._activeCloud.opacity = 255;
            this._activeCloud.scale_x = 1.25;
            this._activeCloud.scale_y = 0.78;

            this._activeCloud.ease({
                scale_x: 0.90,
                scale_y: 1.14,
                duration: 45,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    if (this._activeCloud) {
                        this._activeCloud.ease({
                            scale_x: 1.0,
                            scale_y: 1.0,
                            duration: 40,
                            mode: Clutter.AnimationMode.EASE_IN_QUAD,
                        });
                    }
                },
            });

            if (!this._followLoopId) {
                this._startFollowLoop();
            }
            return;
        }

        this._cleanupCloud();

        this._currentX = targetX;
        this._currentY = targetY;
        this._currentTilt = 0;
        this._spawnTime = GLib.get_monotonic_time();
        this._releaseTime = 0;
        this._wasHeld = isModifierHeld;
        this._prevPointerX = px;
        this._prevPointerY = py;

        // Clean borderless dark cloud capsule (no glow aura)
        const cloud = new St.Bin({
            style_class: 'boing-cloud',
            reactive: false,
            can_focus: false,
            style: 'background-color: rgba(22, 25, 34, 0.90); ' +
                   'border-radius: 12px; ' +
                   'padding: 3px 10px; ' +
                   'min-width: 32px; ' +
                   'box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);',
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
                   'letter-spacing: 0.8px;',
        });

        if (label.clutter_text) {
            label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
            label.clutter_text.line_wrap = false;
        }

        cloud.set_child(label);
        cloud.set_pivot_point(0.5, 0.5);
        cloud.set_position(this._currentX, this._currentY);
        cloud.scale_x = 0.25;
        cloud.scale_y = 0.25;
        cloud.opacity = 0;

        Main.uiGroup.add_child(cloud);

        this._activeCloud = cloud;
        this._activeLabel = label;

        this._startFollowLoop();

        // Stage 1: "BOING!" (Elastic Squash & Stretch entry)
        cloud.ease({
            opacity: 255,
            scale_x: 1.28,
            scale_y: 0.74,
            duration: 65,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                if (!this._activeCloud) return;
                cloud.ease({
                    scale_x: 0.88,
                    scale_y: 1.16,
                    duration: 50,
                    mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
                    onComplete: () => {
                        if (!this._activeCloud) return;
                        cloud.ease({
                            scale_x: 1.0,
                            scale_y: 1.0,
                            duration: 45,
                            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                        });
                    },
                });
            },
        });
    }

    _startFollowLoop() {
        if (this._followLoopId) return;

        this._followLoopId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
            if (!this._activeCloud || !this._activeCloud.get_parent()) {
                this._followLoopId = null;
                return GLib.SOURCE_REMOVE;
            }

            const [px, py, mods] = global.get_pointer();

            // Detect cursor movement direction:
            // moving left -> bubble shifts to the left of the cursor
            // moving right -> bubble shifts to the right of the cursor
            if (this._prevPointerX !== null) {
                const deltaX = px - this._prevPointerX;
                if (deltaX < -2) {
                    this._side = -1;
                } else if (deltaX > 2) {
                    this._side = 1;
                }
            }
            this._prevPointerX = px;
            this._prevPointerY = py;

            const cloudWidth = this._activeCloud.width > 0 ? this._activeCloud.width : 46;
            let targetX = this._side === 1 ? px + 18 : px - cloudWidth - 16;
            let targetY = py - 16;

            const primaryMonitor = Main.layoutManager ? Main.layoutManager.primaryMonitor : null;
            if (primaryMonitor) {
                // If moving right but bumping against right edge, push to left
                if (this._side === 1 && targetX + cloudWidth > primaryMonitor.x + primaryMonitor.width - 6) {
                    targetX = px - cloudWidth - 16;
                } else if (this._side === -1 && targetX < primaryMonitor.x + 6) {
                    // If moving left but bumping against left edge, push to right
                    targetX = px + 18;
                }

                // Clamping to screen boundaries
                targetX = Math.max(primaryMonitor.x + 6, Math.min(primaryMonitor.x + primaryMonitor.width - cloudWidth - 6, targetX));

                if (targetY < primaryMonitor.y + 10) {
                    targetY = py + 22;
                }
            }

            // Buttery exponential smoothing (inertia / float)
            const factor = 0.28;
            this._currentX += (targetX - this._currentX) * factor;
            this._currentY += (targetY - this._currentY) * factor;

            // Subtle dynamic tilt based on horizontal velocity
            const vx = targetX - this._currentX;
            const targetTilt = Math.max(-14, Math.min(14, vx * 0.45));
            this._currentTilt += (targetTilt - this._currentTilt) * 0.25;

            try {
                this._activeCloud.rotation_angle_z = this._currentTilt;
            } catch (e) {}

            this._activeCloud.set_position(
                Math.round(this._currentX),
                Math.round(this._currentY)
            );

            // Modifier hold tracking (Alt/Super/Ctrl)
            const isModifierHeld = (mods & (
                Clutter.ModifierType.MOD1_MASK |
                Clutter.ModifierType.SUPER_MASK |
                Clutter.ModifierType.CONTROL_MASK
            )) !== 0;

            const now = GLib.get_monotonic_time();
            const elapsedMs = (now - this._spawnTime) / 1000;

            if (isModifierHeld) {
                this._wasHeld = true;
                this._releaseTime = 0;
                if (this._holdTimeoutId) {
                    GLib.source_remove(this._holdTimeoutId);
                    this._holdTimeoutId = null;
                }
            } else if (this._wasHeld) {
                if (!this._releaseTime) {
                    this._releaseTime = now;
                }
                const releaseElapsedMs = (now - this._releaseTime) / 1000;
                if (releaseElapsedMs > RELEASE_LINGER_MS) {
                    this._wasHeld = false;
                    this._releaseTime = 0;
                    this._stopFollowLoop();
                    this._triggerBahPoof(this._activeCloud, this._currentX, this._currentY);
                    return GLib.SOURCE_REMOVE;
                }
            } else if (elapsedMs > TAP_LINGER_MS && !this._holdTimeoutId) {
                this._stopFollowLoop();
                this._triggerBahPoof(this._activeCloud, this._currentX, this._currentY);
                return GLib.SOURCE_REMOVE;
            }

            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopFollowLoop() {
        if (this._followLoopId) {
            GLib.source_remove(this._followLoopId);
            this._followLoopId = null;
        }
    }

    _triggerBahPoof(cloud, originX, originY) {
        if (!cloud || !cloud.get_parent()) return;

        // Clean, gentle pop & dissolve
        cloud.remove_all_transitions();
        cloud.ease({
            opacity: 0,
            scale_x: 1.18,
            scale_y: 1.18,
            y: originY - 6,
            duration: FADE_OUT_DURATION_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                if (this._activeCloud === cloud) {
                    this._cleanupCloud();
                } else {
                    cloud.destroy();
                }
            },
        });
    }
}
