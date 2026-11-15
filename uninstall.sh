#!/usr/bin/env bash
set -e

UUID="tahoe-input-indicator@besiple"
DEST="$HOME/.local/share/gnome-shell/extensions/$UUID"

echo "🗑️ Uninstalling Boing Cloud Input Indicator ($UUID)..."

# Disable extension via DBus and CLI
if [ -n "$XDG_RUNTIME_DIR" ] && [ -S "$XDG_RUNTIME_DIR/bus" ]; then
    export DBUS_SESSION_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/bus"
    gdbus call --session --dest org.gnome.Shell.Extensions --object-path /org/gnome/Shell/Extensions --method org.gnome.Shell.Extensions.DisableExtension "$UUID" >/dev/null 2>&1 || true
fi

if which gnome-extensions >/dev/null 2>&1; then
    gnome-extensions disable "$UUID" 2>/dev/null || true
fi

# Clean up gsettings lists (clean from both enabled and disabled)
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

enabled = [x for x in get_list('enabled-extensions') if x != uuid]
set_list('enabled-extensions', enabled)

disabled = [x for x in get_list('disabled-extensions') if x != uuid]
set_list('disabled-extensions', disabled)
"

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
