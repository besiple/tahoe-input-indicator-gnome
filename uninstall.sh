#!/usr/bin/env bash
set -e

UUID="tahoe-input-indicator@besiple"
DEST="$HOME/.local/share/gnome-shell/extensions/$UUID"

echo "🗑️ Uninstalling Boing Cloud Input Indicator ($UUID)..."

# Disable extension
if which gnome-extensions >/dev/null 2>&1; then
    gnome-extensions disable "$UUID" 2>/dev/null || true
fi

if [ -n "$XDG_RUNTIME_DIR" ] && [ -S "$XDG_RUNTIME_DIR/bus" ]; then
    export DBUS_SESSION_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/bus"
    gdbus call --session --dest org.gnome.Shell.Extensions --object-path /org/gnome/Shell/Extensions --method org.gnome.Shell.Extensions.DisableExtension "$UUID" >/dev/null 2>&1 || true
fi

# Remove extension files
if [ -d "$DEST" ]; then
    rm -rf "$DEST"
fi

# Restore GNOME default keyboard switching
echo "⌨️ Restoring GNOME default switching..."
gsettings reset org.gnome.desktop.input-sources xkb-options
gsettings set org.gnome.desktop.wm.keybindings switch-input-source "['<Super>space']"
gsettings set org.gnome.desktop.wm.keybindings switch-input-source-backward "['<Shift><Super>space']"
gsettings reset org.gnome.desktop.wm.keybindings activate-window-menu

echo "✨ Uninstalled successfully. Default GNOME settings restored."
