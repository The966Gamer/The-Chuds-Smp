const { app, BrowserWindow, shell, ipcMain, Menu } = require("electron");
const path = require("path");

/**
 * Falix Control Panel — Electron desktop shell.
 *
 * Runs the panel's web UI in a native window with:
 *  - real OS desktop notifications (web Notification API renders natively;
 *    clicking a toast focuses the window via the preload bridge)
 *  - external links open in the system browser, never in-app
 *  - panel URL override via PANEL_URL env var for hosted deployments
 *
 * Dev usage:  PANEL_URL=http://localhost:3000 npx electron electron/
 * Packaged:   see electron/package.json (electron-builder)
 */

const PANEL_URL = process.env.PANEL_URL || "http://localhost:3000";

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: "#0b0f0a",
    title: "Falix Control Panel",
    icon: path.join(__dirname, "icon.png"),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadURL(PANEL_URL);

  // Open external links (Falix verification, Discord, mc-heads, ...) in the
  // system browser instead of navigating the app window away.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(PANEL_URL) || url.startsWith("http://localhost") || url.startsWith("http://127.0.0.1")) {
      return { action: "allow" };
    }
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// Preload bridge: let toasts focus the window when clicked.
ipcMain.on("panel:focus-window", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

// Keep the web Notification API working with permission prompts even when the
// page doesn't call setPermissionRequestHandler itself.
app.commandLine.appendSwitch("enable-features", "WebNotifications");

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    // macOS: re-create the window when the dock icon is clicked.
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  // Keep the classic Windows/Linux behavior: quit when the window closes.
  if (process.platform !== "darwin") app.quit();
});
