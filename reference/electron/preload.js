const { contextBridge, ipcRenderer } = require("electron");

/**
 * Preload bridge — the only privileged surface exposed to the panel UI.
 * Renders notifications via the standard web Notification API (Electron maps
 * those to native OS toasts); this bridge just adds window focus on click.
 */
contextBridge.exposeInMainWorld("electronAPI", {
  focusWindow: () => ipcRenderer.send("panel:focus-window"),
  isElectron: true,
});
