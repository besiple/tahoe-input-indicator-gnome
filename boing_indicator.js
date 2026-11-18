'use strict';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Keyboard from 'resource:///org/gnome/shell/ui/status/keyboard.js';
import * as IBusManager from 'resource:///org/gnome/shell/misc/ibusManager.js';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Mtk from 'gi://Mtk';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';

const TAP_LINGER_MS = 700;        // Linger time on screen after quick Super+Space tap
const RELEASE_LINGER_MS = 450;    // Linger time after releasing held modifier
const FADE_OUT_DURATION_MS = 320; // Smooth disappearing duration

export default class BoingIndicatorImpl {
    constructor(extension) {
        this._extension = extension;
        this._isManager = Keyboard.getInputSourceManager();
        this._signals = [];
        this._lastSpawnTime = 0;
        this._origPopupShow = null;
        this._origSetCursorLocation = null;
        this._origFocusOut = null;
        this._lastCaretRect = null;

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
        this._attachedToCaret = false;
    }

    enable() {
        this._setupKeybindings();
        this._connectSignals();
        this._hookInputMethod();
        console.log('[Boing Cloud Indicator] Caret anchor style active');
    }

    disable() {
        this._unhookInputMethod();
        this._disconnectSignals();
        this._restoreKeybindings();
        this._cleanupCloud();
        console.log('[Boing Cloud Indicator] Implementation disabled');
    }

    _hookInputMethod() {
        if (!Main.inputMethod) return;

        const self = this;
        this._origSetCursorLocation = Main.inputMethod.vfunc_set_cursor_location;
        Main.inputMethod.vfunc_set_cursor_location = function(rect) {
            if (rect) {
                try {
                    const rx = rect.get_x();
                    const ry = rect.get_y();
                    const rw = rect.get_width();
                    const rh = rect.get_height();
                    const focusWindow = global.display.focus_window;

                    if (focusWindow && rh > 2) {
                        const mtkRect = new Mtk.Rectangle({
                            x: Math.round(rx),
                            y: Math.round(ry),
                            width: Math.max(1, Math.round(rw)),
                            height: Math.max(1, Math.round(rh)),
                        });
                        const stageRect = focusWindow.protocol_to_stage_rect(mtkRect);
                        self._lastCaretRect = {
                            x: stageRect.x,
                            y: stageRect.y,
                            width: Math.max(2, stageRect.width),
                            height: Math.max(14, stageRect.height),
                            window: focusWindow,
                            time: GLib.get_monotonic_time(),
                        };
                    }
                } catch (e) {}
            }
            if (self._origSetCursorLocation)
                return self._origSetCursorLocation.call(this, rect);
        };

        this._origFocusOut = Main.inputMethod.vfunc_focus_out;
        Main.inputMethod.vfunc_focus_out = function() {
            self._lastCaretRect = null;
            if (self._origFocusOut)
                return self._origFocusOut.call(this);
        };
    }

    _unhookInputMethod() {
        if (Main.inputMethod) {
            if (this._origSetCursorLocation) {
                Main.inputMethod.vfunc_set_cursor_location = this._origSetCursorLocation;
                this._origSetCursorLocation = null;
            }
            if (this._origFocusOut) {
                Main.inputMethod.vfunc_focus_out = this._origFocusOut;
                this._origFocusOut = null;
            }
        }
        this._lastCaretRect = null;
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
        this._attachedToCaret = false;
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

    _getCaretPosition() {
        // 1. Clutter / GNOME Shell UI focused element (e.g. search entries, dialogs)
        try {
            const keyFocus = global.stage.key_focus;
            if (keyFocus && keyFocus instanceof Clutter.Text) {
                const [ok, cursorRect] = keyFocus.get_cursor_rect();
                const [stageX, stageY] = keyFocus.get_transformed_position();
                const rx = cursorRect ? cursorRect.x : 0;
                const ry = cursorRect ? cursorRect.y : 0;
                const rw = cursorRect ? cursorRect.width : 2;
                const rh = cursorRect ? cursorRect.height : 20;
                return {
                    x: Math.round(stageX + rx),
                    y: Math.round(stageY + ry),
                    width: Math.max(2, Math.round(rw)),
                    height: Math.max(14, Math.round(rh)),
                };
            }
        } catch (e) {}

        // 2. Candidate popup dummyCursor from IBus
        try {
            const ibusMgr = IBusManager.getIBusManager?.();
            const popup = ibusMgr?._candidatePopup;
            if (popup && popup._dummyCursor && popup._dummyCursor.width > 0 && popup._dummyCursor.height > 2) {
                const [cx, cy] = popup._dummyCursor.get_position();
                const cw = popup._dummyCursor.width;
                const ch = popup._dummyCursor.height;
                if (ch > 6 && ch < 300) {
                    return { x: Math.round(cx), y: Math.round(cy), width: Math.max(2, Math.round(cw)), height: Math.round(ch) };
                }
            }
        } catch (e) {}

        // 3. Tracked caret rect from inputMethod hook
        if (this._lastCaretRect && this._lastCaretRect.height > 2) {
            const focusWindow = global.display.focus_window;
            if (!this._lastCaretRect.window || this._lastCaretRect.window === focusWindow) {
                return this._lastCaretRect;
            }
        }

        // 4. Main.inputMethod._cursorRect directly
        try {
            const cr = Main.inputMethod?._cursorRect;
            const focusWindow = global.display.focus_window;
            if (cr && cr.height > 2 && focusWindow) {
                const mtkRect = new Mtk.Rectangle({
                    x: Math.round(cr.x),
                    y: Math.round(cr.y),
                    width: Math.max(1, Math.round(cr.width)),
                    height: Math.max(1, Math.round(cr.height)),
                });
                const stageRect = focusWindow.protocol_to_stage_rect(mtkRect);
                if (stageRect && stageRect.height > 2) {
                    return {
                        x: stageRect.x,
                        y: stageRect.y,
                        width: Math.max(2, stageRect.width),
                        height: Math.max(14, stageRect.height),
                    };
                }
            }
        } catch (e) {}

        return null;
    }

    _calculateTargetPosition(caret) {
        const cloudWidth = this._activeCloud && this._activeCloud.width > 0 ? this._activeCloud.width : 42;
        const cloudHeight = this._activeCloud && this._activeCloud.height > 0 ? this._activeCloud.height : 24;
        const primaryMonitor = Main.layoutManager ? Main.layoutManager.primaryMonitor : null;

        if (caret) {
            // Anchor to text caret: centered horizontally over the '|' cursor, floating right above it
            let targetX = Math.round(caret.x + (caret.width / 2) - (cloudWidth / 2));
            let targetY = Math.round(caret.y - cloudHeight - 5);

            if (primaryMonitor) {
                // If too close to top bar or screen top edge, flip to appear below the caret line
                if (targetY < primaryMonitor.y + 10) {
                    targetY = Math.round(caret.y + caret.height + 5);
                }
                // Keep horizontally on screen
                targetX = Math.max(primaryMonitor.x + 8, Math.min(primaryMonitor.x + primaryMonitor.width - cloudWidth - 8, targetX));
            }
            return { x: targetX, y: targetY, isCaret: true };
        }

        // Fallback when no text field / caret is active: near pointer
        const [px, py] = global.get_pointer();
        let targetX = px + 18;
        let targetY = py - 16;
        if (primaryMonitor) {
            if (targetX + cloudWidth > primaryMonitor.x + primaryMonitor.width - 6) {
                targetX = px - cloudWidth - 16;
            }
            targetX = Math.max(primaryMonitor.x + 6, Math.min(primaryMonitor.x + primaryMonitor.width - cloudWidth - 6, targetX));
            if (targetY < primaryMonitor.y + 10) {
                targetY = py + 22;
            }
        }
        return { x: targetX, y: targetY, isCaret: false };
    }

    _showBoingCloud(text) {
        if (Main.sessionMode && Main.sessionMode.isLocked) return;

        const [, , mods] = global.get_pointer();
        const caret = this._getCaretPosition();
        const pos = this._calculateTargetPosition(caret);
        this._attachedToCaret = pos.isCaret;

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

            // Snap to latest caret position if present
            if (pos.isCaret) {
                this._currentX = pos.x;
                this._currentY = pos.y;
                this._activeCloud.set_position(pos.x, pos.y);
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

        this._currentX = pos.x;
        this._currentY = pos.y;
        this._currentTilt = 0;
        this._spawnTime = GLib.get_monotonic_time();
        this._releaseTime = 0;
        this._wasHeld = isModifierHeld;
        this._attachedToCaret = pos.isCaret;

        // Clean borderless dark cloud capsule (macOS Tahoe style)
        const cloud = new St.Bin({
            style_class: 'boing-cloud',
            reactive: false,
            can_focus: false,
            style: 'background-color: rgba(22, 25, 34, 0.92); ' +
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

            const [, , mods] = global.get_pointer();

            // If attached to caret: stay anchored at caret '|'
            // If caret moves (e.g. typing while holding Super), update smoothly to new caret location
            if (this._attachedToCaret) {
                const caret = this._getCaretPosition();
                if (caret) {
                    const pos = this._calculateTargetPosition(caret);
                    const factor = 0.35;
                    this._currentX += (pos.x - this._currentX) * factor;
                    this._currentY += (pos.y - this._currentY) * factor;
                    this._activeCloud.set_position(
                        Math.round(this._currentX),
                        Math.round(this._currentY)
                    );
                }
            } else {
                // Fallback mouse tracking only when NO text field is active
                const [px, py] = global.get_pointer();
                const pos = this._calculateTargetPosition(null);
                const factor = 0.28;
                this._currentX += (pos.x - this._currentX) * factor;
                this._currentY += (pos.y - this._currentY) * factor;

                const vx = pos.x - this._currentX;
                const targetTilt = Math.max(-14, Math.min(14, vx * 0.45));
                this._currentTilt += (targetTilt - this._currentTilt) * 0.25;

                try {
                    this._activeCloud.rotation_angle_z = this._currentTilt;
                } catch (e) {}

                this._activeCloud.set_position(
                    Math.round(this._currentX),
                    Math.round(this._currentY)
                );
            }

            // Modifier hold tracking (Super/Alt/Ctrl)
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
