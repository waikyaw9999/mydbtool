import {
  app,
  BrowserWindow,
  Menu,
  dialog,
  safeStorage,
  shell,
  type MenuItemConstructorOptions,
} from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import { createServer } from "node:net";
import path from "node:path";

const isDev = process.env.MYDBTOOL_DEV === "1";
const PREFERRED_PORT = 39100;

let mainWindow: BrowserWindow | null = null;
let serverProcess: ChildProcess | null = null;
let quitting = false;

function projectRoot(): string {
  return path.resolve(__dirname, "..", "..");
}

function standaloneDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "standalone");
  }
  return path.join(projectRoot(), ".next", "standalone");
}

function nodeBinaryName(): string {
  return process.platform === "win32" ? "node.exe" : "node";
}

async function getFreePort(): Promise<number> {
  const listen = (port: number) =>
    new Promise<number | null>((resolve) => {
      const server = createServer();
      server.unref();
      server.on("error", () => resolve(null));
      server.listen(port, "127.0.0.1", () => {
        const addr = server.address();
        const resolved = typeof addr === "object" && addr ? addr.port : port;
        server.close(() => resolve(resolved));
      });
    });

  const port = (await listen(PREFERRED_PORT)) ?? (await listen(0));
  if (port == null) {
    throw new Error("Could not find a free local port.");
  }
  return port;
}

function readSecretFile(file: string): string | null {
  try {
    const value = fs.readFileSync(file, "utf8").trim();
    return value.length >= 8 ? value : null;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    throw err;
  }
}

function getOrCreateConnectionsSecret(userData: string): string {
  const fromEnv = process.env.CONNECTIONS_SECRET?.trim();
  if (fromEnv && fromEnv.length >= 8) return fromEnv;

  fs.mkdirSync(userData, { recursive: true });
  const plainFile = path.join(userData, "connections-secret");
  const encryptedFile = path.join(userData, "connections-secret.enc");
  const canEncrypt = safeStorage.isEncryptionAvailable();

  if (canEncrypt && fs.existsSync(encryptedFile)) {
    try {
      const decrypted = safeStorage.decryptString(fs.readFileSync(encryptedFile)).trim();
      if (decrypted.length >= 8) return decrypted;
    } catch (err) {
      console.warn("[mydbtool] Could not decrypt the desktop connections secret; a new one will be created.", err);
    }
  }

  const existingPlain = readSecretFile(plainFile);
  if (existingPlain) {
    if (canEncrypt) {
      fs.writeFileSync(encryptedFile, safeStorage.encryptString(existingPlain), { mode: 0o600 });
      fs.rmSync(plainFile, { force: true });
    }
    return existingPlain;
  }

  const secret = randomBytes(32).toString("base64url");
  if (canEncrypt) {
    fs.writeFileSync(encryptedFile, safeStorage.encryptString(secret), { mode: 0o600 });
  } else {
    fs.writeFileSync(plainFile, secret, { mode: 0o600 });
    console.warn(
      "[mydbtool] OS keychain encryption is unavailable. CONNECTIONS_SECRET is stored as a mode 0600 file in the userData directory.",
    );
  }
  return secret;
}

function desktopEnv(): NodeJS.ProcessEnv {
  const userData = app.getPath("userData");
  const connectionsPath = process.env.CONNECTIONS_PATH || path.join(userData, "connections.json");
  const connectionsSecret = getOrCreateConnectionsSecret(userData);
  return {
    ...process.env,
    CONNECTIONS_PATH: connectionsPath,
    CONNECTIONS_SECRET: connectionsSecret,
  };
}

function resolveNodeBinary(standalone: string): { bin: string; electronAsNode: boolean } {
  const bundled = path.join(standalone, nodeBinaryName());
  if (fs.existsSync(bundled)) {
    return { bin: bundled, electronAsNode: false };
  }
  if (!app.isPackaged) {
    return { bin: process.env.npm_node_execpath || "node", electronAsNode: false };
  }
  return { bin: process.execPath, electronAsNode: true };
}

function pipeServerLogs(child: ChildProcess): void {
  child.stdout?.on("data", (chunk: Buffer | string) => {
    process.stdout.write(chunk);
  });
  child.stderr?.on("data", (chunk: Buffer | string) => {
    process.stderr.write(chunk);
  });
}

function spawnNextDev(port: number, env: NodeJS.ProcessEnv): ChildProcess {
  const nextBin = path.join(projectRoot(), "node_modules", "next", "dist", "bin", "next");
  if (!fs.existsSync(nextBin)) {
    throw new Error("Next.js is not installed. Run npm install and try again.");
  }
  const nodeBin = process.env.npm_node_execpath || "node";
  const child = spawn(
    nodeBin,
    [nextBin, "dev", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      cwd: projectRoot(),
      env: {
        ...env,
        PORT: String(port),
        HOSTNAME: "127.0.0.1",
        HOST: "127.0.0.1",
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  pipeServerLogs(child);
  return child;
}

function spawnStandalone(port: number, env: NodeJS.ProcessEnv): ChildProcess {
  const dir = standaloneDir();
  const serverJs = path.join(dir, "server.js");
  if (!fs.existsSync(serverJs)) {
    throw new Error(
      `Missing Next.js standalone server at ${serverJs}. Run \`npm run build\` (or \`npm run electron:build\`) first.`,
    );
  }
  const { bin, electronAsNode } = resolveNodeBinary(dir);
  const childEnv: NodeJS.ProcessEnv = {
    ...env,
    PORT: String(port),
    HOSTNAME: "127.0.0.1",
    HOST: "127.0.0.1",
    NODE_ENV: "production",
  };
  if (electronAsNode) {
    childEnv.ELECTRON_RUN_AS_NODE = "1";
  } else {
    delete childEnv.ELECTRON_RUN_AS_NODE;
  }
  const child = spawn(bin, [serverJs], {
    cwd: dir,
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  pipeServerLogs(child);
  return child;
}

function waitForHttp(url: string, child: ChildProcess, timeoutMs = 180_000): Promise<void> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const fail = (err: Error) => {
      cleanup();
      reject(err);
    };
    const onExit = (code: number | null) => {
      fail(new Error(`The mydbtool server exited before it became ready (code ${code ?? "unknown"}).`));
    };
    const onError = (err: Error) => {
      fail(err);
    };
    const cleanup = () => {
      child.off("exit", onExit);
      child.off("error", onError);
    };
    child.once("exit", onExit);
    child.once("error", onError);

    const poll = () => {
      if (Date.now() - started > timeoutMs) {
        fail(new Error(`Timed out waiting for ${url}`));
        return;
      }
      const req = http.get(url, (res) => {
        res.resume();
        cleanup();
        resolve();
      });
      req.on("error", () => {
        setTimeout(poll, 250);
      });
      req.setTimeout(1000, () => {
        req.destroy();
      });
    };
    poll();
  });
}

function stopServer(): void {
  if (!serverProcess || serverProcess.killed) return;
  const child = serverProcess;
  serverProcess = null;
  if (process.platform === "win32" && child.pid) {
    spawn("taskkill", ["/pid", String(child.pid), "/f", "/t"], { stdio: "ignore", windowsHide: true });
    return;
  }
  child.kill("SIGTERM");
}

function installMenu(): void {
  const isMac = process.platform === "darwin";
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" as const },
              { type: "separator" as const },
              { role: "services" as const },
              { type: "separator" as const },
              { role: "hide" as const },
              { role: "hideOthers" as const },
              { role: "unhide" as const },
              { type: "separator" as const },
              { role: "quit" as const },
            ],
          },
        ]
      : []),
    { role: "fileMenu" },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        ...(isDev ? [{ role: "toggleDevTools" as const }] : []),
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        {
          label: "mydbtool on GitHub",
          click: () => {
            void shell.openExternal("https://github.com/waikyaw9999/mydbtool");
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    title: "mydbtool",
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#0b1220",
    show: false,
    autoHideMenuBar: process.platform === "win32",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setTitle("mydbtool");
  win.once("ready-to-show", () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://127.0.0.1:") || url.startsWith("https://127.0.0.1:")) {
      return { action: "allow" };
    }
    void shell.openExternal(url);
    return { action: "deny" };
  });
  return win;
}

async function startWorkbench(): Promise<void> {
  const env = desktopEnv();
  const port = await getFreePort();
  const origin = `http://127.0.0.1:${port}`;
  serverProcess = isDev ? spawnNextDev(port, env) : spawnStandalone(port, env);
  serverProcess.on("error", (err) => {
    console.error("[mydbtool] Failed to start the Next.js server:", err);
  });

  mainWindow = createWindow();
  const win = mainWindow;
  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(origin) && !url.startsWith("file:")) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });
  await win.loadFile(path.join(__dirname, "splash.html"));
  await waitForHttp(origin, serverProcess);
  await win.loadURL(origin);
  if (isDev) {
    win.webContents.openDevTools({ mode: "detach" });
  }
}

async function promptStartupError(err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  console.error("[mydbtool] startup failed:", err);
  if (app.isReady()) {
    await dialog.showMessageBox({
      type: "error",
      title: "mydbtool",
      message: "mydbtool could not start",
      detail: message,
    });
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.setName("mydbtool");
  if (process.platform === "win32") {
    app.setAppUserModelId("com.github.waikyaw9999.mydbtool");
  }

  app.whenReady().then(async () => {
    installMenu();
    try {
      await startWorkbench();
    } catch (err) {
      await promptStartupError(err);
      app.quit();
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && !quitting) {
      void startWorkbench().catch((err) => {
        void promptStartupError(err);
      });
    }
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("before-quit", () => {
    quitting = true;
    stopServer();
  });
}
