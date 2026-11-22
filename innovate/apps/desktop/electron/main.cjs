/**
 * Innovate for Windows/macOS/Linux: an Electron window around the desktop server (server/server.mjs),
 * which runs the whole app in one Node process with Electron's own Node (ELECTRON_RUN_AS_NODE).
 * Data (database, files, AI model) lives in the user's app-data folder, e.g. %APPDATA%\Innovate\data.
 */
const { app, BrowserWindow, dialog, shell } = require("electron");
const { fork } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

const dataDir = process.env.INNOVATE_DATA_DIR || path.join(app.getPath("userData"), "data");
const logDir = path.join(app.getPath("userData"), "logs");
const serverLog = path.join(logDir, "server.log");
let server = null;
let win = null;
let origin = null;
let quitting = false;

/** A free localhost port, preferring `preferred` (a stable port keeps sign-in cookies across launches). */
function freePort(preferred) {
  const tryPort = (port) =>
    new Promise((resolve) => {
      const s = net.createServer();
      s.once("error", () => resolve(null));
      s.listen(port, "127.0.0.1", () => {
        const p = s.address().port;
        s.close(() => resolve(p));
      });
    });
  return tryPort(preferred).then((p) => p ?? tryPort(0));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: "Innovate",
    backgroundColor: "#efefef",
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  win.loadFile(path.join(__dirname, "loading.html"));
  // Links to other sites open in the default browser; the app stays on its own origin.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (origin && url.startsWith(origin)) return { action: "allow" };
    void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (origin && !url.startsWith(origin) && !url.startsWith("file:")) {
      e.preventDefault();
      void shell.openExternal(url);
    }
  });
  win.on("closed", () => (win = null));
}

async function startServer() {
  fs.mkdirSync(logDir, { recursive: true });
  const out = fs.openSync(serverLog, "a");
  const port = Number(process.env.INNOVATE_PORT) || (await freePort(47800));
  const rtPort = Number(process.env.INNOVATE_REALTIME_PORT) || (await freePort(port + 1));
  // Packaged: server, web and migrations are in resources/. Unpackaged (.stage/app): next to the app folder.
  const root = app.isPackaged ? process.resourcesPath : path.join(__dirname, "..");
  server = fork(path.join(root, "server", "server.mjs"), [], {
    stdio: ["ignore", out, out, "ipc"],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      INNOVATE_SINGLE_USER: "1",
      INNOVATE_DATA_DIR: dataDir,
      INNOVATE_PORT: String(port),
      INNOVATE_REALTIME_PORT: String(rtPort),
      INNOVATE_DESKTOP_TOKEN: process.env.INNOVATE_DESKTOP_TOKEN || crypto.randomBytes(24).toString("base64url"),
      INNOVATE_NEXT_SERVER: path.join(root, "web", "apps", "web", "server.js"),
      INNOVATE_MIGRATIONS_DIR: path.join(root, "migrations"),
    },
  });
  server.on("message", (m) => {
    if (m && m.type === "ready") {
      origin = m.url;
      if (win) void win.loadURL(m.loginUrl);
    }
  });
  server.on("exit", (code) => {
    server = null;
    if (quitting) return app.quit();
    dialog.showErrorBox("Innovate stopped", `The Innovate engine stopped unexpectedly (code ${code}).\n\nDetails are in:\n${serverLog}`);
    app.quit();
  });
}

app.on("second-instance", () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.whenReady().then(async () => {
  createWindow();
  await startServer();
  app.on("activate", () => {
    if (!win) {
      createWindow();
      if (origin) void win.loadURL(origin);
    }
  });
});

app.on("window-all-closed", () => app.quit());

// Let the server close the database cleanly before the app exits.
app.on("before-quit", (e) => {
  if (!server) return;
  e.preventDefault();
  if (quitting) return;
  quitting = true;
  server.send({ type: "shutdown" });
  setTimeout(() => server && server.kill(), 12_000).unref();
});
