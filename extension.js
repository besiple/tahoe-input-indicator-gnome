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
        this._hideTimeoutId = null;
        this._origPopupShow = null;

        this._buildIndicator();
        this._setupKeybindings();
        this._hookInputSourceChanges();

        console.log('[macOS Tahoe Input Indicator] Enabled');
    }

    disable() {
        this._restoreKeybindings();
        this._unhookInputSourceChanges();
        this._destroyIndicator();

        console.log('[macOS Tahoe Input Indicator] Disabled');
    }

    _buildIndicator() {
        this._container = new St.Bin({
            style_class: 'tahoe-indicator-container',
            reactive: false,
            can_focus: false,
            style: 'background-color: rgba(22, 22, 26, 0.88); ' +
                   'border: 1px solid rgba(255, 255, 255, 0.20); ' +
                   'border-radius: 14px; ' +
                   'padding: 6px 14px; ' +
                   'box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);',
        });

        const box = new St.BoxLayout({
            style_class: 'tahoe-indicator-content',
            spacing: 8,
            style: 'spacing: 8px;',
        });

        this._codeLabel = new St.Label({
            style_class: 'tahoe-indicator-code',
            text: 'EN',
            y_align: Clutter.ActorAlign.CENTER,
            style: 'font-weight: 800; font-size: 13pt; color: #ffffff;',
        });

        this._divider = new St.Bin({
            style_class: 'tahoe-indicator-divider',
            style: 'background-color: rgba(255, 255, 255, 0.25); width: 1px; height: 16px; margin: 0 4px;',
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._nameLabel = new St.Label({
            style_class: 'tahoe-indicator-name',
            text: 'English',
            y_align: Clutter.ActorAlign.CENTER,
            style: 'font-weight: 500; font-size: 10.5pt; color: rgba(255, 255, 255, 0.75);',
        });

        box.add_child(this._codeLabel);
        box.add_child(this._divider);
        box.add_child(this._nameLabel);

        this._container.set_child(box);
        this._container.set_pivot_point(0.5, 0.5);
        this._container.opacity = 0;
        this._container.hide();

        Main.uiGroup.add_child(this._container);
    }

    _destroyIndicator() {
        if (this._hideTimeoutId) {
            GLib.source_remove(this._hideTimeoutId);
            this._hideTimeoutId = null;
        }

        if (this._container) {
            this._container.destroy();
            this._container = null;
        }
    }

    _setupKeybindings() {
        // Prevent default center modal switcher popup by replacing keybinding handlers
        try {
            Main.wm.removeKeybinding('switch-input-source');
            Main.wm.removeKeybinding('switch-input-source-backward');
        } catch (e) {
            console.log('[macOS Tahoe Input Indicator] removeKeybinding warning:', e);
        }

        const wmSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.wm.keybindings' });

        Main.wm.addKeybinding(
            'switch-input-source',
            wmSettings,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.ALL,
            (display, window, event, binding) => {
                this._cycleInputSource(false);
            }
        );

        Main.wm.addKeybinding(
            'switch-input-source-backward',
            wmSettings,
            Meta.KeyBindingFlags.IS_REVERSED,
            Shell.ActionMode.ALL,
            (display, window, event, binding) => {
                this._cycleInputSource(true);
            }
        );

        // Safeguard: suppress InputSourcePopup show method if something else calls it
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
        } catch (e) {
            console.log('[macOS Tahoe Input Indicator] restoreKeybindings warning:', e);
        }

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

        let targetSource = null;
        if (isBackward) {
            targetSource = mru[mru.length - 1];
        } else {
            targetSource = mru[1];
        }

        if (targetSource) {
            targetSource.activate(true);
        }
    }

    _hookInputSourceChanges() {
        if (!this._isManager) return;

        const id = this._isManager.connect('current-source-changed', () => {
            const current = this._isManager.currentSource;
            if (current) {
                this._showIndicator(current);
            }
        });
        this._signals.push({ obj: this._isManager, id });
    }

    _unhookInputSourceChanges() {
        for (const sig of this._signals) {
            try {
                if (sig.obj && sig.id) {
                    sig.obj.disconnect(sig.id);
                }
            } catch (e) {}
        }
        this._signals = [];
    }

    _showIndicator(source) {
        if (!this._container) return;
        if (Main.sessionMode && Main.sessionMode.isLocked) return;

        // 1. Text and labels
        const rawCode = source.shortName || source.id || '??';
        const code = rawCode.toUpperCase().slice(0, 3);

        let name = source.displayName || code;
        if (code === 'RU') {
            name = 'Русский';
        } else if (code === 'EN' || code === 'US') {
            name = 'English';
        }

        this._codeLabel.text = code;
        this._nameLabel.text = name;

        // Force allocation to measure geometry
        this._container.ensure_style();

        // 2. Compute Position: Caret priority with Cursor fallback
        let targetX = 0;
        let targetY = 0;
        let placedAtCaret = false;

        const cursorRect = Main.inputMethod?._cursorRect;
        const focusWin = global.display.focus_window;

        if (focusWin && cursorRect && cursorRect.width >= 0 && cursorRect.height >= 0) {
            const frame = focusWin.get_frame_rect();
            // Validate that cursor rect is realistically inside the active window
            if (cursorRect.x >= frame.x && cursorRect.x <= (frame.x + frame.width) &&
                cursorRect.y >= frame.y && cursorRect.y <= (frame.y + frame.height)) {
                targetX = Math.round(cursorRect.x + cursorRect.width + 4);
                targetY = Math.round(cursorRect.y + cursorRect.height + 6);
                placedAtCaret = true;
            }
        }

        if (!placedAtCaret) {
            const [px, py] = global.get_pointer();
            targetX = px + 18;
            targetY = py + 22;
        }

        // Clamp to screen monitor bounds
        const monitor = Main.layoutManager.findMonitorForActor(this._container) ||
                        Main.layoutManager.currentMonitor ||
                        Main.layoutManager.primaryMonitor;
        if (monitor) {
            const pad = 12;
            const w = this._container.width || 135;
            const h = this._container.height || 36;

            if (targetX + w > monitor.x + monitor.width - pad) {
                targetX = monitor.x + monitor.width - w - pad;
            }
            if (targetY + h > monitor.y + monitor.height - pad) {
                if (placedAtCaret && cursorRect) {
                    targetY = Math.max(monitor.y + pad, cursorRect.y - h - 6);
                } else {
                    targetY = monitor.y + monitor.height - h - pad;
                }
            }
            targetX = Math.max(monitor.x + pad, targetX);
            targetY = Math.max(monitor.y + pad, targetY);
        }

        this._container.set_position(targetX, targetY);

        // 3. Smooth macOS Tahoe Animation
        this._container.remove_all_transitions();

        if (this._hideTimeoutId) {
            GLib.source_remove(this._hideTimeoutId);
            this._hideTimeoutId = null;
        }

        this._container.show();

        if (this._container.opacity > 100) {
            // Already visible: perform a sleek quick micro-pulse
            this._container.set_scale(1.08, 1.08);
            this._container.ease({
                scale_x: 1.0,
                scale_y: 1.0,
                duration: 90,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        } else {
            // Fresh appearance: pop in with ease-out
            this._container.opacity = 0;
            this._container.set_scale(0.82, 0.82);
            this._container.ease({
                opacity: 255,
                scale_x: 1.0,
                scale_y: 1.0,
                duration: 130,
                mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            });
        }

        // Auto-fadeout after 750ms
        this._hideTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 750, () => {
            this._hideTimeoutId = null;
            this._container.ease({
                opacity: 0,
                scale_x: 0.90,
                scale_y: 0.90,
                duration: 220,
                mode: Clutter.AnimationMode.EASE_IN_CUBIC,
                onComplete: () => {
                    this._container.hide();
                },
            });
            return GLib.SOURCE_REMOVE;
        });
    }
}
