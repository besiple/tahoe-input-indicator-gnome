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

# Ensure destination directory exists and copy files
mkdir -p "$DEST"
cp -f "$SOURCE_DIR/metadata.json" "$DEST/"
cp -f "$SOURCE_DIR/extension.js" "$DEST/"
cp -f "$SOURCE_DIR/boing_indicator.js" "$DEST/"
cp -f "$SOURCE_DIR/stylesheet.css" "$DEST/"

# Also install bundle via gnome-extensions if possible (ensures GNOME Shell reloads it live)
python3 -c "
import os, zipfile
dest = '$DEST'
zip_path = '/tmp/$UUID.zip'
with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as z:
    for name in ['metadata.json', 'extension.js', 'boing_indicator.js', 'stylesheet.css']:
        fpath = os.path.join(dest, name)
        if os.path.exists(fpath):
            z.write(fpath, name)
"
if which gnome-extensions >/dev/null 2>&1; then
    gnome-extensions install --force "/tmp/$UUID.zip" 2>/dev/null || true
fi
rm -f "/tmp/$UUID.zip"

# Clean up temp dir if created
if [ -n "$TEMP_DIR" ] && [ -d "$TEMP_DIR" ]; then
    rm -rf "$TEMP_DIR"
fi

# Update GNOME Shell gsettings (remove from disabled, add to enabled)
python3 -c "
import subprocess, re

uuid = '$UUID'
def get_list(key):
    try:
        out = subprocess.check_output(['gsettings', 'get', 'org.gnome.shell', key]).decode().strip()
        return re.findall(r\"'([^']+)'\", out)
    except:
        return []

def set_list(key, items):
    val = '[' + ', '.join(f\"'{x}'\" for x in items) + ']'
    try:
        subprocess.run(['gsettings', 'set', 'org.gnome.shell', key, val])
    except:
        pass

# 1. Remove from disabled-extensions
disabled = [x for x in get_list('disabled-extensions') if x != uuid]
set_list('disabled-extensions', disabled)

# 2. Add to enabled-extensions
enabled = get_list('enabled-extensions')
if uuid not in enabled:
    enabled.append(uuid)
    set_list('enabled-extensions', enabled)
"

# Configure Alt+Space layout switching and suppress modal center popup
echo "⌨️ Configuring Alt+Space switching..."
gsettings set org.gnome.desktop.input-sources xkb-options "['grp:alt_space_toggle']"
gsettings set org.gnome.desktop.wm.keybindings switch-input-source "[]"
gsettings set org.gnome.desktop.wm.keybindings switch-input-source-backward "[]"
gsettings set org.gnome.desktop.wm.keybindings activate-window-menu "[]"

# Enable extension via gnome-extensions & DBus
if which gnome-extensions >/dev/null 2>&1; then
    gnome-extensions enable "$UUID" 2>/dev/null || true
fi

if [ -n "$XDG_RUNTIME_DIR" ] && [ -S "$XDG_RUNTIME_DIR/bus" ]; then
    export DBUS_SESSION_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/bus"
    gdbus call --session --dest org.gnome.Shell.Extensions --object-path /org/gnome/Shell/Extensions --method org.gnome.Shell.Extensions.DisableExtension "$UUID" >/dev/null 2>&1 || true
    gdbus call --session --dest org.gnome.Shell.Extensions --object-path /org/gnome/Shell/Extensions --method org.gnome.Shell.Extensions.EnableExtension "$UUID" >/dev/null 2>&1 || true
fi

echo ""
echo "✨ Boing Cloud Input Indicator successfully installed!"
echo "👉 Press Alt + Space to test the bouncy cloud!"
