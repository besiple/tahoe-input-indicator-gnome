#!/usr/bin/env bash
set -e

UUID="tahoe-input-indicator@besiple"
DEST="$HOME/.local/share/gnome-shell/extensions/$UUID"

echo "🍎 Installing macOS Tahoe Input Indicator ($UUID)..."
mkdir -p "$DEST"
cp metadata.json extension.js stylesheet.css "$DEST/"

# Enable via gsettings / gnome-extensions
if which gnome-extensions >/dev/null 2>&1; then
    gnome-extensions enable "$UUID" 2>/dev/null || true
fi

# Configure Alt+Space layout switching without modal popup
gsettings set org.gnome.desktop.input-sources xkb-options "['grp:alt_space_toggle']"
gsettings set org.gnome.desktop.wm.keybindings switch-input-source "[]"
gsettings set org.gnome.desktop.wm.keybindings switch-input-source-backward "[]"
gsettings set org.gnome.desktop.wm.keybindings activate-window-menu "[]"

echo "✨ Done! macOS Tahoe Input Indicator installed."
