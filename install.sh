#!/usr/bin/env bash
set -e

UUID="tahoe-input-indicator@besiple"
DEST="$HOME/.local/share/gnome-shell/extensions/$UUID"
REPO_URL="https://github.com/besiple/tahoe-input-indicator-gnome.git"

echo "☁️ Installing Boing Cloud Input Indicator ($UUID)..."

# If executed via curl | bash (files not in current directory), clone to a temp directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || echo "")"
TEMP_DIR=""

if [ ! -f "$SCRIPT_DIR/extension.js" ] || [ ! -f "$SCRIPT_DIR/boing_indicator.js" ]; then
    echo "📦 Downloading latest files from GitHub..."
    TEMP_DIR=$(mktemp -d)
    git clone --depth 1 "$REPO_URL" "$TEMP_DIR"
    SOURCE_DIR="$TEMP_DIR"
else
    SOURCE_DIR="$SCRIPT_DIR"
fi

# Ensure destination directory exists
mkdir -p "$DEST"

# Copy all required extension files
cp -f "$SOURCE_DIR/metadata.json" "$DEST/"
cp -f "$SOURCE_DIR/extension.js" "$DEST/"
cp -f "$SOURCE_DIR/boing_indicator.js" "$DEST/"
cp -f "$SOURCE_DIR/stylesheet.css" "$DEST/"

# Clean up temp dir if created
if [ -n "$TEMP_DIR" ] && [ -d "$TEMP_DIR" ]; then
    rm -rf "$TEMP_DIR"
fi

# Configure Alt+Space layout switching and suppress modal center popup
echo "⌨️ Configuring Alt+Space switching..."
gsettings set org.gnome.desktop.input-sources xkb-options "['grp:alt_space_toggle']"
gsettings set org.gnome.desktop.wm.keybindings switch-input-source "[]"
gsettings set org.gnome.desktop.wm.keybindings switch-input-source-backward "[]"
gsettings set org.gnome.desktop.wm.keybindings activate-window-menu "[]"

# Enable extension via gnome-extensions
if which gnome-extensions >/dev/null 2>&1; then
    gnome-extensions enable "$UUID" 2>/dev/null || true
fi

# Try live reload via DBus if GNOME Shell is running
if [ -n "$XDG_RUNTIME_DIR" ] && [ -S "$XDG_RUNTIME_DIR/bus" ]; then
    export DBUS_SESSION_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/bus"
    gdbus call --session --dest org.gnome.Shell.Extensions --object-path /org/gnome/Shell/Extensions --method org.gnome.Shell.Extensions.DisableExtension "$UUID" >/dev/null 2>&1 || true
    gdbus call --session --dest org.gnome.Shell.Extensions --object-path /org/gnome/Shell/Extensions --method org.gnome.Shell.Extensions.EnableExtension "$UUID" >/dev/null 2>&1 || true
fi

echo ""
echo "✨ Boing Cloud Input Indicator successfully installed!"
echo "👉 Press Alt + Space to test the bouncy cloud!"
echo "💡 Note: On first install in GNOME Shell, a quick Log Out → Log In may be needed."
