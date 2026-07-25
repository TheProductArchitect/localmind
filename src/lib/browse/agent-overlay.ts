/**
 * Agent presence overlay — draws Sora's pointer, click ripples, element
 * outlines, and a status chip *inside* the page the agent is driving, so the
 * user can watch what it touches instead of seeing the page change by itself.
 *
 * The overlay lives in a shadow root on a fixed-position host with
 * `pointer-events: none`, so it can neither restyle the page nor swallow the
 * user's clicks. Every call is best-effort: a cue that fails must never break
 * the underlying browse action.
 */
import type { Page } from "playwright";

export type AgentCue =
  | { kind: "move"; x: number; y: number; label?: string }
  | { kind: "click"; x: number; y: number; label?: string }
  | { kind: "box"; x: number; y: number; width: number; height: number; label?: string }
  | { kind: "status"; label: string }
  | { kind: "clear" };

export const OVERLAY_HOST_ID = "__lm_agent_overlay";

/**
 * Self-contained cue renderer, injected fresh on each call so it survives
 * navigations without needing an init script on the user's own tab.
 */
export const AGENT_CUE_SCRIPT = `(cue) => {
  const HOST_ID = ${JSON.stringify(OVERLAY_HOST_ID)};
  const existing = document.getElementById(HOST_ID);
  if (cue.kind === "clear") {
    if (existing) existing.remove();
    return;
  }
  let host = existing;
  if (!host) {
    host = document.createElement("div");
    host.id = HOST_ID;
    host.setAttribute("aria-hidden", "true");
    host.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none;";
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML =
      '<style>' +
      ':host{all:initial}' +
      '.cursor{position:fixed;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;' +
      'border:2px solid rgba(122,162,255,.95);background:rgba(122,162,255,.22);' +
      'box-shadow:0 0 0 3px rgba(122,162,255,.18),0 2px 10px rgba(0,0,0,.35);' +
      'transition:left .16s ease-out,top .16s ease-out;opacity:0;}' +
      '.cursor.on{opacity:1}' +
      '.ripple{position:fixed;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;' +
      'border:2px solid rgba(122,162,255,.9);animation:lmr .5s ease-out forwards;}' +
      '@keyframes lmr{from{transform:scale(.4);opacity:.95}to{transform:scale(3.6);opacity:0}}' +
      '.box{position:fixed;border:2px solid rgba(122,162,255,.9);border-radius:6px;' +
      'background:rgba(122,162,255,.10);box-shadow:0 0 0 2px rgba(122,162,255,.15);' +
      'transition:all .16s ease-out;}' +
      '.chip{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);max-width:70vw;' +
      'font:500 12px/1.35 system-ui,-apple-system,sans-serif;color:#eaf0ff;' +
      'background:rgba(12,14,24,.92);border:1px solid rgba(122,162,255,.45);border-radius:999px;' +
      'padding:6px 12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;' +
      'box-shadow:0 6px 22px rgba(0,0,0,.45);}' +
      '.chip b{color:#7aa2ff;font-weight:600}' +
      '</style>' +
      '<div class="cursor"></div><div class="chip" hidden></div>';
    (document.body || document.documentElement).appendChild(host);
  }
  const root = host.shadowRoot;
  if (!root) return;
  const cursor = root.querySelector(".cursor");
  const chip = root.querySelector(".chip");

  const showChip = (text) => {
    if (!chip || !text) return;
    chip.innerHTML = "<b>Sora</b> &middot; " + String(text).replace(/[<>&]/g, "");
    chip.hidden = false;
    clearTimeout(host.__lmChipTimer);
    host.__lmChipTimer = setTimeout(() => { chip.hidden = true; }, 2600);
  };

  if (cue.kind === "status") {
    showChip(cue.label);
    return;
  }
  if (cue.kind === "box") {
    let box = root.querySelector(".box");
    if (!box) {
      box = document.createElement("div");
      box.className = "box";
      root.appendChild(box);
    }
    box.style.left = cue.x + "px";
    box.style.top = cue.y + "px";
    box.style.width = cue.width + "px";
    box.style.height = cue.height + "px";
    clearTimeout(host.__lmBoxTimer);
    host.__lmBoxTimer = setTimeout(() => { box.remove(); }, 2200);
    showChip(cue.label);
    return;
  }
  if (cursor) {
    cursor.style.left = cue.x + "px";
    cursor.style.top = cue.y + "px";
    cursor.classList.add("on");
  }
  if (cue.kind === "click") {
    const ripple = document.createElement("div");
    ripple.className = "ripple";
    ripple.style.left = cue.x + "px";
    ripple.style.top = cue.y + "px";
    root.appendChild(ripple);
    setTimeout(() => ripple.remove(), 520);
  }
  showChip(cue.label);
}`;

/** Render one cue. Never throws. */
export async function showAgentCue(page: Page, cue: AgentCue): Promise<void> {
  try {
    await page.evaluate(AGENT_CUE_SCRIPT, cue);
  } catch {
    /* page navigating, closed, or CSP-restricted — visuals are optional */
  }
}

/** Glide the real pointer so the motion is visible, then leave it on target. */
export async function glidePointerTo(page: Page, x: number, y: number, steps = 6): Promise<void> {
  try {
    await page.mouse.move(x, y, { steps: Math.max(1, steps) });
  } catch {
    /* ignore — the click itself still moves the pointer */
  }
}
