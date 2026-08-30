/**
 * Agent-visible browser control: element addressing, action cues, and the
 * activity feed the Browse chrome narrates.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/agent/web-guard", () => ({
  checkWebAccess: () => ({ ok: true }),
  auditPageRead: () => {},
}));
vi.mock("../src/lib/tools/browser", () => ({
  getBrowser: async () => {
    throw new Error("headless browser not used in this test");
  },
}));
vi.mock("../src/lib/playwright-path", () => ({}));

type Cue = { kind: string; label?: string; x?: number; y?: number };

const ELEMENTS = [
  { tag: "button", type: "submit", label: "Sign in", x: 100, y: 200, box: { x: 60, y: 190, width: 80, height: 24 } },
  { tag: "a", type: "", label: "Create account", x: 300, y: 400, box: { x: 250, y: 390, width: 100, height: 20 } },
];

function fakePage(url = "https://example.com/login") {
  const cues: Cue[] = [];
  const calls: string[] = [];
  const page = {
    cues,
    calls,
    url: () => url,
    title: async () => "Login",
    evaluate: async (script: unknown, arg?: unknown) => {
      const src = String(script);
      if (src.includes("querySelectorAll")) return ELEMENTS;
      if (arg && typeof arg === "object") cues.push(arg as Cue);
      return undefined;
    },
    screenshot: async () => Buffer.alloc(0),
    mouse: {
      click: async (x: number, y: number) => { calls.push(`click:${x},${y}`); },
      move: async (x: number, y: number) => { calls.push(`move:${x},${y}`); },
      wheel: async () => { calls.push("wheel"); },
    },
    keyboard: {
      type: async (t: string) => { calls.push(`type:${t}`); },
      press: async (k: string) => { calls.push(`press:${k}`); },
    },
    goto: async () => {},
    goBack: async () => {},
    goForward: async () => {},
    close: async () => {},
  };
  return page;
}

async function loadSession() {
  vi.resetModules();
  return import("../src/lib/browse/session");
}

describe("browse element addressing", () => {
  it("indexes interactive elements and formats them for the agent", async () => {
    const { registerExternalPage, browseElements, formatBrowseElements } = await loadSession();
    const page = fakePage();
    registerExternalPage("apptab-A1", page as never);

    const list = await browseElements("apptab-A1");
    expect(list.map((e) => e.index)).toEqual([1, 2]);
    expect(list[0].label).toBe("Sign in");

    const text = formatBrowseElements(list);
    expect(text).toContain('[1] button:submit "Sign in" @ 100,200');
    expect(text).toContain('[2] a "Create account"');
  });

  it("matches by text with exact priority over partial", async () => {
    const { matchElementByText } = await loadSession();
    const list = [
      { index: 1, tag: "a", type: "", label: "Create account today", x: 1, y: 1, box: { x: 0, y: 0, width: 1, height: 1 } },
      { index: 2, tag: "button", type: "", label: "Create account", x: 2, y: 2, box: { x: 0, y: 0, width: 1, height: 1 } },
    ];
    expect(matchElementByText(list, "create account")?.index).toBe(2);
    expect(matchElementByText(list, "today")?.index).toBe(1);
    expect(matchElementByText(list, "nope")).toBeNull();
  });

  it("clicks the element behind an index and shows the user where", async () => {
    const { registerExternalPage, browseAction } = await loadSession();
    const page = fakePage();
    registerExternalPage("apptab-B2", page as never);

    const res = await browseAction("apptab-B2", { type: "click_index", index: 1 });
    expect(res.ok).toBe(true);
    expect(page.calls).toContain("move:100,200");
    expect(page.calls).toContain("click:100,200");

    const kinds = page.cues.map((c) => c.kind);
    expect(kinds).toContain("box");
    expect(kinds).toContain("move");
    expect(kinds).toContain("click");
    expect(page.cues.some((c) => c.label === "clicking Sign in")).toBe(true);
  });

  it("clicks by visible text", async () => {
    const { registerExternalPage, browseAction } = await loadSession();
    const page = fakePage();
    registerExternalPage("apptab-C3", page as never);

    const res = await browseAction("apptab-C3", { type: "click_text", text: "create account" });
    expect(res.ok).toBe(true);
    expect(page.calls).toContain("click:300,400");
  });

  it("refuses a stale index instead of clicking blind", async () => {
    const { registerExternalPage, browseAction } = await loadSession();
    const page = fakePage();
    registerExternalPage("apptab-D4", page as never);

    const res = await browseAction("apptab-D4", { type: "click_index", index: 99 });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("No element [99]");
    expect(page.calls.some((c) => c.startsWith("click:"))).toBe(false);
  });

  it("keeps the user's tab open when a granted session is revoked", async () => {
    const { registerExternalPage, closeBrowseSession, getBrowseSession } = await loadSession();
    const page = fakePage();
    const closed = vi.fn();
    page.close = async () => { closed(); };
    registerExternalPage("apptab-E5", page as never);

    await closeBrowseSession("apptab-E5");
    expect(closed).not.toHaveBeenCalled();
    expect(getBrowseSession("apptab-E5")).toBeUndefined();
    expect(page.cues.some((c) => c.kind === "clear")).toBe(true);
  });
});

describe("agent activity feed", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("publishes actions to subscribers and keeps recent history", async () => {
    const { recordAgentActivity, subscribeAgentActivity, getAgentActivity, clearAgentActivity } =
      await import("../src/lib/browse/agent-activity");

    const seen: string[] = [];
    const off = subscribeAgentActivity("s1", (a) => seen.push(a.action));
    recordAgentActivity({ sessionId: "s1", action: "click_index", detail: "Sign in", ok: true });
    recordAgentActivity({ sessionId: "other", action: "navigate", detail: "x", ok: true });
    off();
    recordAgentActivity({ sessionId: "s1", action: "type", detail: "3 chars", ok: true });

    expect(seen).toEqual(["click_index"]);
    expect(getAgentActivity("s1").map((a) => a.action)).toEqual(["click_index", "type"]);

    clearAgentActivity("s1");
    expect(getAgentActivity("s1")).toEqual([]);
  });

  it("records agent actions performed through the session layer", async () => {
    const { registerExternalPage, browseAction } = await loadSession();
    const { getAgentActivity } = await import("../src/lib/browse/agent-activity");
    const page = fakePage();
    registerExternalPage("apptab-F6", page as never);

    await browseAction("apptab-F6", { type: "click_index", index: 2 });
    const feed = getAgentActivity("apptab-F6");
    expect(feed.at(-1)).toMatchObject({ action: "click_index", detail: "Create account", ok: true });
  });
});

describe("agent overlay script", () => {
  it("is a valid self-contained function that never captures clicks", async () => {
    const { AGENT_CUE_SCRIPT, OVERLAY_HOST_ID } = await import("../src/lib/browse/agent-overlay");
    expect(() => new Function(`return ${AGENT_CUE_SCRIPT}`)()).not.toThrow();
    expect(AGENT_CUE_SCRIPT).toContain("pointer-events:none");
    expect(AGENT_CUE_SCRIPT).toContain("attachShadow");
    expect(AGENT_CUE_SCRIPT).toContain(OVERLAY_HOST_ID);
  });
});
