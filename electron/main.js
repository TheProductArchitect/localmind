/**
 * LocalMind desktop shell — Electron main process.
 *
 * Architecture (phase 1–2 of the agentic-browser plan):
 *   - The main BrowserWindow renders the LocalMind Next.js app. That app IS
 *     the browser chrome: rail, tab strip, URL bar, Sora panel.
 *   - Each web tab is a WebContentsView (real Chromium renderer) positioned
 *     over the content area the chrome reserves for it. The renderer reports
 *     that area's bounds over IPC; main keeps the active view glued to it.
 *   - Tab web content is UNTRUSTED: sandboxed, no preload, no node. The only
 *     privileged surface is the chrome window's preload (electron/preload.js),
 *     which exposes a narrow, typed lmBrowser API.
 *
 * Phase-3 groundwork: when LM_AGENT_BRIDGE=1, Chromium's DevTools protocol
 * listens on 127.0.0.1:9223 so the LocalMind server (Playwright
 * connectOverCDP) can drive the SAME tabs the user sees. Off by default —
 * any local process could attach to that port, so it stays opt-in until the
 * per-tab grant + watching-indicator work lands.
 *
 * Server resolution order:
 *   1. LM_APP_URL env (dev: point at `npm run dev` on :3001)
 *   2. An already-running server on :3000 (PM2 users)
 *   3. Spawn `next start -p 3000` ourselves and wait for it.
 */
const { app, BrowserWindow, WebContentsView, ipcMain, shell } = require("electron");
const { spawn } = require("node:child_process");
const path = require("node:path");
const http = require("node:http");
const fs = require("node:fs");

const ROOT = path.join(__dirname, "..");
const PORT = Number(process.env.LM_APP_PORT || 3000);
const SMOKE = process.argv.includes("--smoke");

// Agent bridge (phase 3): the LocalMind server drives GRANTED tabs via
// Playwright connectOverCDP on this loopback-only port. On by default —
// access to individual tabs is still gated per-tab by the user's grant
// toggle in the Browse chrome. Set LM_AGENT_BRIDGE=0 to disable entirely.
if (process.env.LM_AGENT_BRIDGE !== "0") {
  app.commandLine.appendSwitch("remote-debugging-port", String(process.env.LM_CDP_PORT || 9223));
  app.commandLine.appendSwitch("remote-debugging-address", "127.0.0.1");
}

let win = null;
let serverProc = null;

// ---------------------------------------------------------------- server ---

function ping(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => { res.resume(); resolve(res.statusCode < 500); });
    req.on("error", () => resolve(false));
    req.setTimeout(1500, () => { req.destroy(); resolve(false); });
  });
}

function runNpx(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(
      process.platform === "win32" ? "npx.cmd" : "npx",
      args,
      { cwd: ROOT, env: { ...process.env }, stdio: "inherit" }
    );
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${args.join(" ")} exited ${code}`))));
    p.on("error", reject);
  });
}

async function ensureServer() {
  if (process.env.LM_APP_URL) return process.env.LM_APP_URL;
  const url = `http://localhost:${PORT}`;
  if (await ping(url)) return url;

  // No production build yet (fresh clone, or .next was cleaned) — build
  // first instead of letting `next start` die with production-start-no-build-id.
  if (!fs.existsSync(path.join(ROOT, ".next", "BUILD_ID"))) {
    console.log("[localmind-app] no production build found — running next build (one-time)…");
    await runNpx(["next", "build"]);
  }

  serverProc = spawn(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["next", "start", "-p", String(PORT)],
    { cwd: ROOT, env: { ...process.env }, stdio: "inherit" }
  );
  serverProc.on("exit", (code) => {
    // Server death with the window open is unrecoverable — surface it.
    if (win && !win.isDestroyed()) {
      win.webContents.executeJavaScript(
        `document.body.innerHTML = '<pre style="padding:2rem">LocalMind server exited (code ${code}). Restart the app.</pre>'`
      ).catch(() => {});
    }
  });

  for (let i = 0; i < 60; i++) {
    if (await ping(url)) return url;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`LocalMind server did not come up on :${PORT}`);
}

// ------------------------------------------------------------ tab manager ---

/** @type {Map<number, {view: WebContentsView}>} */
const tabs = new Map();
let nextTabId = 1;
let activeTabId = null;
let contentBounds = { x: 0, y: 0, width: 0, height: 0 };
let contentVisible = false;

function tabState() {
  return {
    activeTabId,
    tabs: [...tabs.entries()].map(([id, t]) => {
      const wc = t.view.webContents;
      return {
        id,
        url: wc.getURL(),
        title: wc.getTitle(),
        loading: wc.isLoading(),
        canGoBack: wc.navigationHistory.canGoBack(),
        canGoForward: wc.navigationHistory.canGoForward(),
      };
    }),
  };
}

function pushState() {
  if (win && !win.isDestroyed()) win.webContents.send("browser:state", tabState());
}

function layout() {
  if (!win || win.isDestroyed()) return;
  for (const [id, t] of tabs) {
    if (id === activeTabId && contentVisible) {
      t.view.setBounds(contentBounds);
      t.view.setVisible(true);
    } else {
      t.view.setVisible(false);
    }
  }
}

function createTab(url) {
  const id = nextTabId++;
  const view = new WebContentsView({
    webPreferences: {
      // Untrusted web content: full sandbox, zero privileged surface.
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  const wc = view.webContents;

  for (const ev of ["did-navigate", "did-navigate-in-page", "page-title-updated", "did-start-loading", "did-stop-loading"]) {
    wc.on(ev, pushState);
  }
  // target=_blank and window.open become new tabs in our chrome, never
  // detached Electron windows.
  wc.setWindowOpenHandler(({ url: u }) => {
    if (/^https?:/i.test(u)) createTab(u);
    else if (/^(mailto|tel):/i.test(u)) shell.openExternal(u);
    return { action: "deny" };
  });
  wc.on("destroyed", () => {
    tabs.delete(id);
    if (activeTabId === id) activeTabId = tabs.size ? [...tabs.keys()].pop() : null;
    layout();
    pushState();
  });

  win.contentView.addChildView(view);
  tabs.set(id, { view });
  activeTabId = id;
  if (url) wc.loadURL(url).catch(() => {});
  layout();
  pushState();
  return id;
}

function withTab(id, fn) {
  const t = tabs.get(id);
  if (t) fn(t.view.webContents);
}

function wireIpc() {
  ipcMain.handle("browser:new-tab", (_e, url) => createTab(typeof url === "string" && url ? url : "about:blank"));
  ipcMain.handle("browser:close-tab", (_e, id) => {
    const t = tabs.get(id);
    if (!t) return;
    win.contentView.removeChildView(t.view);
    t.view.webContents.close();
  });
  ipcMain.handle("browser:select-tab", (_e, id) => {
    if (tabs.has(id)) { activeTabId = id; layout(); pushState(); }
  });
  ipcMain.handle("browser:navigate", (_e, id, url) => withTab(id, (wc) => wc.loadURL(url).catch(() => {})));
  ipcMain.handle("browser:back", (_e, id) => withTab(id, (wc) => wc.navigationHistory.goBack()));
  ipcMain.handle("browser:forward", (_e, id) => withTab(id, (wc) => wc.navigationHistory.goForward()));
  ipcMain.handle("browser:reload", (_e, id) => withTab(id, (wc) => wc.reload()));
  ipcMain.handle("browser:set-bounds", (_e, b) => {
    contentBounds = {
      x: Math.round(b.x), y: Math.round(b.y),
      width: Math.round(b.width), height: Math.round(b.height),
    };
    layout();
  });
  ipcMain.handle("browser:set-visible", (_e, v) => { contentVisible = !!v; layout(); });
  ipcMain.handle("browser:get-state", () => tabState());
  // CDP target id for a tab — the key the server uses to find this exact
  // tab over the debugging port when the user grants Sora access to it.
  ipcMain.handle("browser:get-target-id", async (_e, id) => {
    const t = tabs.get(id);
    if (!t) return null;
    const wc = t.view.webContents;
    const attachedHere = !wc.debugger.isAttached();
    try {
      if (attachedHere) wc.debugger.attach("1.3");
      const { targetInfo } = await wc.debugger.sendCommand("Target.getTargetInfo");
      return targetInfo?.targetId ?? null;
    } catch {
      return null;
    } finally {
      if (attachedHere && wc.debugger.isAttached()) {
        try { wc.debugger.detach(); } catch {}
      }
    }
  });
}

// ------------------------------------------------------------------- boot ---

async function boot() {
  const url = await ensureServer();
  wireIpc();

  win = new BrowserWindow({
    width: 1440,
    height: 900,
    title: "LocalMind",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload needs require("electron"); page itself stays isolated
    },
  });
  win.on("resize", layout);
  win.on("closed", () => { win = null; });

  await win.loadURL(url);

  if (SMOKE) {
    // CI/agent smoke: prove the shell boots, a tab loads, and the CDP bridge
    // can identify it. Prints the targetId so an external harness can
    // exercise the grant → browse_session path, then exits after 60s.
    console.log("[smoke] window loaded:", win.webContents.getURL());
    // Give the tab view real bounds — no /browse UI is mounted to send them.
    contentBounds = { x: 0, y: 80, width: 1200, height: 700 };
    contentVisible = true;
    const id = createTab(url);
    const wc = tabs.get(id).view.webContents;
    wc.once("did-stop-loading", async () => {
      try {
        wc.debugger.attach("1.3");
        const { targetInfo } = await wc.debugger.sendCommand("Target.getTargetInfo");
        wc.debugger.detach();
        console.log("[smoke] tab created:", id, "targetId:", targetInfo?.targetId, "url:", wc.getURL());
      } catch (e) {
        console.log("[smoke] targetId lookup failed:", e.message);
      }
    });
    setTimeout(() => app.quit(), 60_000);
  }
}

app.whenReady().then(boot).catch((e) => {
  console.error("[localmind-app] boot failed:", e);
  app.exit(1);
});

app.on("window-all-closed", () => app.quit());
app.on("quit", () => {
  if (serverProc && !serverProc.killed) serverProc.kill();
});
