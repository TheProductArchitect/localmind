/**
 * Hyper-personal branding for the Electron shell.
 *
 * - App / window title = settings.assistant_name (falls back to "Assistant")
 * - Dock + window icon = the product orb (same visual as <Orb/> / icon.svg),
 *   and can follow live pulse state (thinking / tool / error / …)
 */

const { app, nativeImage } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { getOrbIcon, warmOrbIcons, VALID } = require("./orb-icon");

let currentName = "Assistant";
let currentState = "idle";
/** @type {import('electron').BrowserWindow | null} */
let mainWinRef = null;
/** @type {(() => import('electron').BrowserWindow | null) | null} */
let codingWinGetter = null;

/**
 * @param {{ mirrorOnly?: boolean }} [opts] When mirrorOnly, never fall back to
 *   the sqlite probe — that spawns a Node subprocess, which must not happen on
 *   a recurring timer in the main process.
 */
function readAssistantNameFromDb(opts) {
  try {
    const dataDir = process.env.LOCALMIND_DATA_DIR || path.join(os.homedir(), ".localmind");
    // Prefer a lightweight JSON mirror written by the Next settings API —
    // avoids loading better-sqlite3 inside Electron's ABI.
    const mirror = path.join(dataDir, "branding.json");
    // One read, no stat-then-read window: checking the file and then opening it
    // is a race, and the mirror is rewritten by the settings API at any time.
    // A missing or half-written file simply fails this parse and falls through.
    try {
      const j = JSON.parse(fs.readFileSync(mirror, "utf8"));
      const name = j?.assistant_name && String(j.assistant_name).trim();
      if (name) return name;
    } catch {
      /* mirror missing or unreadable — fall through */
    }
    if (opts?.mirrorOnly) return null;
    const dbPath = path.join(dataDir, "config.db");
    if (!fs.existsSync(dbPath)) return null;
    // Query with system Node (project's better-sqlite3), not Electron's Node.
    const { execFileSync } = require("node:child_process");
    const root = path.join(__dirname, "..");
    const script = `
      const Database = require("better-sqlite3");
      const db = new Database(${JSON.stringify(dbPath)}, { readonly: true, fileMustExist: true });
      const row = db.prepare("SELECT assistant_name FROM settings WHERE id=1").get();
      db.close();
      process.stdout.write((row && row.assistant_name) ? String(row.assistant_name) : "");
    `;
    const out = execFileSync("node", ["-e", script], {
      cwd: root,
      encoding: "utf8",
      timeout: 3000,
      env: process.env,
    }).trim();
    return out || null;
  } catch (e) {
    console.warn("[branding] could not read assistant_name:", e.message);
    return null;
  }
}

function sanitizeName(name) {
  const n = String(name || "").trim().slice(0, 64);
  return n || "Assistant";
}

function applyName(name) {
  currentName = sanitizeName(name);
  try {
    app.setName(currentName);
  } catch {
    /* setName is best-effort */
  }
  if (mainWinRef && !mainWinRef.isDestroyed()) {
    mainWinRef.setTitle(currentName);
  }
  const coding = codingWinGetter?.();
  if (coding && !coding.isDestroyed()) {
    const t = coding.getTitle() || "";
    if (/Projects|code-server|LocalMind/i.test(t) || t.startsWith(currentName) === false) {
      const suffix = /code-server/i.test(t) ? "code-server" : "Projects";
      coding.setTitle(`${currentName} · ${suffix}`);
    }
  }
  if (process.platform === "darwin" && app.dock) {
    try {
      app.dock.setBadge("");
    } catch {
      /* ignore */
    }
  }
  return currentName;
}

async function applyIcon(state) {
  const s = VALID.has(state) ? state : "idle";
  currentState = s;
  try {
    const image = await getOrbIcon(s);
    if (image.isEmpty()) return;
    if (process.platform === "darwin" && app.dock) {
      app.dock.setIcon(image);
    }
    if (mainWinRef && !mainWinRef.isDestroyed()) {
      mainWinRef.setIcon(image);
    }
    const coding = codingWinGetter?.();
    if (coding && !coding.isDestroyed()) {
      coding.setIcon(image);
    }
  } catch (e) {
    console.warn("[branding] setIcon failed:", e.message);
  }
}

/**
 * @param {{
 *   mainWindow: import('electron').BrowserWindow,
 *   getCodingWindow?: () => import('electron').BrowserWindow | null,
 * }} opts
 */
async function initBranding(opts) {
  mainWinRef = opts.mainWindow;
  codingWinGetter = opts.getCodingWindow || null;

  const fromDb = readAssistantNameFromDb();
  applyName(fromDb || "Assistant");

  // Warm frames in background; set idle icon immediately (may render once).
  applyIcon("idle").catch(() => {});
  warmOrbIcons().catch(() => {});

  // Re-read the name periodically so Settings blur-saves show up without IPC.
  // mirrorOnly keeps this off the sqlite fallback, which spawns a subprocess —
  // unacceptable on a 4s timer. Reading the tiny JSON mirror each tick is
  // cheap, and applyName already no-ops when the name is unchanged.
  const nameTimer = setInterval(() => {
    const n = readAssistantNameFromDb({ mirrorOnly: true });
    if (n && sanitizeName(n) !== currentName) applyName(n);
  }, 4000);
  nameTimer.unref?.();
}

/**
 * @param {{ name?: string, orbState?: string }} patch
 */
async function updateBranding(patch) {
  if (patch?.name != null) applyName(patch.name);
  if (patch?.orbState != null && patch.orbState !== currentState) {
    await applyIcon(patch.orbState);
  }
  return { name: currentName, orbState: currentState };
}

function getBranding() {
  return { name: currentName, orbState: currentState };
}

module.exports = {
  initBranding,
  updateBranding,
  getBranding,
  applyName,
  applyIcon,
  readAssistantNameFromDb,
};
