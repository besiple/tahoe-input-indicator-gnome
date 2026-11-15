#!/usr/bin/env bash
set -e

UUID="tahoe-input-indicator@besiple"
DEST="$HOME/.local/share/gnome-shell/extensions/$UUID"

echo "Removing $UUID..."
if which gnome-extensions >/dev/null 2>&1; then
    gnome-extensions disable "$UUID" 2>/dev/null || true
fi

rm -rf "$DEST"

# Restore GNOME default switching if needed
gsettings reset org.gnome.desktop.input-sources xkb-options
gsettings set org.gnome.desktop.wm.keybindings switch-input-source "['<Super>space']"
gsettings set org.gnome.desktop.wm.keybindings switch-input-source-backward "['<Shift><Super>space']"

echo "Uninstalled successfully."
