/**
 * Orb → dock / window icon.
 *
 * Renders the same visual language as src/app/icon.svg and <Orb/> into a
 * NativeImage via an offscreen BrowserWindow (Electron can't load SVG
 * natively for dock icons). Frames are cached as PNG under ~/.localmind/branding.
 */

const { BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const SIZE = 256;

/** @typedef {"idle"|"thinking"|"tool"|"spawn"|"error"|"suspended"} OrbState */

const VALID = new Set(["idle", "thinking", "tool", "spawn", "error", "suspended"]);

function brandingDir() {
  const dataDir = process.env.LOCALMIND_DATA_DIR || path.join(os.homedir(), ".localmind");
  const dir = path.join(dataDir, "branding");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * SVG matching the product orb — dark canvas, white luminance core, state cues.
 * @param {OrbState} state
 */
function orbSvg(state) {
  const thinking = state === "thinking" || state === "tool" || state === "spawn";
  const err = state === "error";
  const sus = state === "suspended";
  const coreOpacity = sus ? 0.35 : thinking ? 1 : 0.92;
  const haloPeak = err ? 0.45 : thinking ? 0.42 : 0.28;
  const coreColor = err ? "#ff6b6b" : "#ffffff";
  const showArcs = thinking || state === "idle";
  const arcOpacity = thinking ? 0.95 : 0.55;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 32 32" fill="none">
  <rect width="32" height="32" rx="8" fill="#07070A"/>
  <circle cx="16" cy="16" r="12" fill="url(#halo)"/>
  ${
    showArcs
      ? `<circle cx="16" cy="16" r="10.5" stroke="url(#arcA)" stroke-width="1.25" stroke-linecap="round"
          stroke-dasharray="18 48" transform="rotate(-40 16 16)" opacity="${arcOpacity}"/>
         <circle cx="16" cy="16" r="7.5" stroke="url(#arcB)" stroke-width="1" stroke-linecap="round"
          stroke-dasharray="12 36" transform="rotate(110 16 16)" opacity="${arcOpacity}"/>`
      : ""
  }
  ${
    sus
      ? `<circle cx="16" cy="16" r="9" stroke="#ffffff" stroke-opacity="0.25" stroke-width="0.6" fill="none"/>`
      : ""
  }
  ${
    state === "tool" || state === "spawn"
      ? `<circle cx="24.5" cy="9.5" r="1.6" fill="#ffffff" fill-opacity="0.85"/>`
      : ""
  }
  <circle cx="16" cy="16" r="4.25" fill="url(#core)"/>
  <defs>
    <radialGradient id="halo" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${coreColor}" stop-opacity="${haloPeak}"/>
      <stop offset="55%" stop-color="${coreColor}" stop-opacity="0.08"/>
      <stop offset="100%" stop-color="${coreColor}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="core" cx="35%" cy="32%" r="65%">
      <stop offset="0%" stop-color="${coreColor}" stop-opacity="${coreOpacity}"/>
      <stop offset="55%" stop-color="${coreColor}" stop-opacity="${coreOpacity * 0.92}"/>
      <stop offset="100%" stop-color="${coreColor}" stop-opacity="0.35"/>
    </radialGradient>
    <linearGradient id="arcA" x1="6" y1="8" x2="26" y2="24">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.95"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0.15"/>
    </linearGradient>
    <linearGradient id="arcB" x1="22" y1="10" x2="10" y2="24">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.7"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0.1"/>
    </linearGradient>
  </defs>
</svg>`;
}

/**
 * @param {OrbState} state
 * @returns {Promise<import('electron').NativeImage>}
 */
async function renderOrbIcon(state) {
  const s = VALID.has(state) ? state : "idle";
  const pngPath = path.join(brandingDir(), `orb-${s}.png`);

  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    frame: false,
    transparent: false,
    backgroundColor: "#07070A",
    webPreferences: { offscreen: true },
  });
  try {
    const html = `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;width:${SIZE}px;height:${SIZE}px;background:#07070A;overflow:hidden}</style>
${orbSvg(s)}`;
    await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
    await new Promise((r) => setTimeout(r, 80));
    const image = await win.webContents.capturePage();
    try {
      fs.writeFileSync(pngPath, image.toPNG());
    } catch {
      /* cache is best-effort */
    }
    return image;
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

/**
 * Prefer cached PNG when present; otherwise render.
 * @param {OrbState} state
 */
async function getOrbIcon(state) {
  const s = VALID.has(state) ? state : "idle";
  const pngPath = path.join(brandingDir(), `orb-${s}.png`);
  const { nativeImage } = require("electron");
  if (fs.existsSync(pngPath)) {
    const img = nativeImage.createFromPath(pngPath);
    if (!img.isEmpty()) return img;
  }
  return renderOrbIcon(s);
}

/**
 * Warm common frames so dock swaps are instant.
 *
 * Each render spins up an offscreen BrowserWindow, so re-rendering frames that
 * are already cached on disk cost five window creations on every launch — and
 * offscreen capture is not even available in every session (software
 * rasterisation, --no-sandbox, headless). Skip anything already cached.
 */
async function warmOrbIcons() {
  for (const s of ["idle", "thinking", "tool", "error", "suspended"]) {
    const pngPath = path.join(brandingDir(), `orb-${s}.png`);
    try {
      if (fs.statSync(pngPath).size > 0) continue;
    } catch {
      /* not cached yet — render below */
    }
    try {
      await renderOrbIcon(/** @type {OrbState} */ (s));
    } catch (e) {
      console.warn("[branding] orb icon render failed:", s, e.message);
    }
  }
}

module.exports = { getOrbIcon, renderOrbIcon, warmOrbIcons, brandingDir, VALID };
