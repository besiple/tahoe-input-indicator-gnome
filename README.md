# Boing Cloud Input Indicator ☁️💥

> A playful, cartoonish **"Boing — Bah!"** animated input source indicator for GNOME Shell (GNOME 45–51+).

Replaces the clunky default center modal switcher with a bouncy, borderless floating cloud right next to your cursor with zero-latency switching and smooth mouse tracking.

---

## ✨ Features

- **"BOING!" Elastic Bouncy Entry**: Pops up right at your cursor with cartoon *squash & stretch* physics (`RU` / `EN`).
- **"BAH!" Poof Disappearance**: Rapid puff burst expansion and dissolving micro-bubbles upon release.
- **Buttery Cursor Tracking**: Follows your cursor smoothly at 60 FPS with subtle directional tilt and momentum.
- **Hold-to-Cycle (Зажатие / Зацикливание)**:
  - Hold `Super` and press `Space`: the cloud stays alive on screen as long as `Super` is held, gliding with your cursor.
  - Cycle through languages with snappy in-place bounces.
  - Release `Super` to instantly pop (**"BAH!"**) and disappear.
- **Zero-Latency Switching**: Instant keyboard layout toggle via `Super + Space` without annoying modal window lag.
- **Smart Screen Clamping**: Automatically flips inside screen bounds near display edges.

---

## 🚀 One-Line Quick Install

Simply run this command in your terminal:

```bash
curl -fsSL https://raw.githubusercontent.com/besiple/tahoe-input-indicator-gnome/main/install.sh | bash
```

---

## 🛠️ Manual Installation (Git)

```bash
git clone https://github.com/besiple/tahoe-input-indicator-gnome.git
cd tahoe-input-indicator-gnome
./install.sh
```

> **Note**: On the very first install in GNOME Shell, perform a quick **Log Out → Log In** to allow GNOME Shell to register the extension.

---

## 🗑️ Uninstallation

To completely remove the extension and restore standard GNOME switcher settings:

```bash
curl -fsSL https://raw.githubusercontent.com/besiple/tahoe-input-indicator-gnome/main/uninstall.sh | bash
```

Or from the cloned repository:

```bash
./uninstall.sh
```

---

## ⚙️ Compatibility

- **GNOME Shell**: 45, 46, 47, 48, 49, 50, 51+
- **Display Server**: Wayland & X11
- **OS**: Arch Linux, Fedora, Ubuntu, Debian, openSUSE, and other modern distributions.

---

## 📄 License

MIT © [besiple](https://github.com/besiple)
