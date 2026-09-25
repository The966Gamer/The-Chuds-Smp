# Falix Control Panel — Desktop app (Electron)

Wraps the panel web UI in a native desktop window with **real OS
notifications**: deaths, graves, crashes and server start/stop pop up as
system toasts (Windows Action Center / macOS Notification Center / Linux
notifications) even when the window is in the background.

## Quick start (dev)

Requirements: Node 20+.

```bash
# 1. Have the panel running (in the project root):
npm run build && npm run start        # serves http://localhost:3000

# 2. In a second terminal, from the project root:
cd electron
npm install
npm start                             # opens the panel in a native window
```

To point the desktop app at a hosted panel instead:

```bash
PANEL_URL=https://your-panel.example.com npm start
```

## Building an installer

```bash
cd electron
npm run dist:win        # Windows: NSIS installer + portable exe
npm run dist            # also macOS .dmg and Linux AppImage (on matching hosts)
```

Installers land in `electron/dist/`.

## How notifications work

- The panel web UI already asks for notification permission (bell icon in the
  top bar toggles them). Inside Electron the prompt maps to the real OS
  permission, and toasts render natively.
- Clicking a toast brings the app window to the front (preload bridge).
- External links (Falix verification page, Discord, etc.) always open in your
  system browser, never inside the app window.

## Files

```text
main.js       — app lifecycle, window creation, external-link policy
preload.js    — minimal contextBridge (window focus on toast click)
package.json  — electron-builder config for installers
```
