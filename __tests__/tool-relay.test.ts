import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mocks for handler dependencies -------------------------------------
const peers: Record<string, any> = {};
let policy: any = { accept_tool_relay: true };
const toolImpls: Record<string, any> = {};

vi.mock("../src/lib/agent/audit-logger", () => ({
  logStartFederated: () => 42,
  logComplete: () => {},
  logStart: () => 7,
  linkAuditToPeer: () => {},
}));

vi.mock("../src/lib/db/fleet", () => ({
  getPeer: (id: string) => peers[id] || null,
  parsePeerPolicy: () => policy,
}));

vi.mock("../src/lib/tools", () => ({
  getBuiltinTool: (name: string) => toolImpls[name] || null,
}));

vi.mock("../src/lib/db/queries", () => ({
  getSettings: () => ({ approved_dirs: "[]" }),
}));

import { handleToolRelay, TOOL_RELAY_TOOLS } from "../src/lib/fleet/handlers/tool-relay";
import {
  markOutboundActive,
  clearOutboundActive,
  __resetChatRelayState,
} from "../src/lib/fleet/handlers/chat-relay";
import {
  runWithToolHome,
  getToolHome,
  runAsToolRelayInbound,
  isToolRelayInbound,
} from "../src/lib/fleet/tool-relay-context";

function envelope(payload: any) {
  return { v: 1, kind: "tool-relay", sender: "peer-a", recipient: "me", lamport: 1, ts: 0, payload, sig: "sig" } as any;
}

describe("tool-relay allowlist", () => {
  it("includes device/account tools and excludes shell + coding/git", () => {
    expect(TOOL_RELAY_TOOLS.has("filesystem")).toBe(true);
    expect(TOOL_RELAY_TOOLS.has("calendar")).toBe(true);
    expect(TOOL_RELAY_TOOLS.has("mac_automation")).toBe(true);
    expect(TOOL_RELAY_TOOLS.has("shell")).toBe(false);
    expect(TOOL_RELAY_TOOLS.has("git")).toBe(false);
    expect(TOOL_RELAY_TOOLS.has("coding_project")).toBe(false);
  });
});

describe("tool-relay ALS context", () => {
  it("exposes tool home only inside runWithToolHome", async () => {
    expect(getToolHome()).toBeNull();
    await runWithToolHome({ initiatorNodeId: "peer-a", conversationId: "c1" }, async () => {
      expect(getToolHome()?.initiatorNodeId).toBe("peer-a");
    });
    expect(getToolHome()).toBeNull();
  });

  it("flags inbound relay scope so tools don't re-relay", async () => {
    expect(isToolRelayInbound()).toBe(false);
    await runAsToolRelayInbound(async () => {
      expect(isToolRelayInbound()).toBe(true);
    });
    expect(isToolRelayInbound()).toBe(false);
  });
});

describe("handleToolRelay", () => {
  beforeEach(() => {
    for (const k of Object.keys(peers)) delete peers[k];
    for (const k of Object.keys(toolImpls)) delete toolImpls[k];
    policy = { accept_tool_relay: true };
    peers["peer-a"] = { peer_node_id: "peer-a", trusted: 1, policy_json: "{}" };
    __resetChatRelayState();
    markOutboundActive("peer-a");
  });

  it("refuses an untrusted peer", async () => {
    peers["peer-a"].trusted = 0;
    const r = await handleToolRelay({ envelope: envelope({ tool: "filesystem", input: {} }), senderNodeId: "peer-a" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not trusted/i);
  });

  it("refuses when accept_tool_relay is off", async () => {
    policy = { accept_tool_relay: false };
    const r = await handleToolRelay({ envelope: envelope({ tool: "filesystem", input: {} }), senderNodeId: "peer-a" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not granted tool-relay/i);
  });

  it("refuses unbound tool-relay without an active outbound chat", async () => {
    clearOutboundActive("peer-a");
    toolImpls["filesystem"] = {
      execute: async () => ({ ok: true, output: "should not run", summary: "x" }),
    };
    const r = await handleToolRelay({
      envelope: envelope({ tool: "filesystem", input: {} }),
      senderNodeId: "peer-a",
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no active chat-relay/i);
  });

  it("refuses a non-allowlisted tool", async () => {
    const r = await handleToolRelay({ envelope: envelope({ tool: "shell", input: {} }), senderNodeId: "peer-a" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not allowlisted/i);
  });

  it("runs an allowlisted tool locally as inbound and returns its output", async () => {
    let sawInbound = false;
    toolImpls["filesystem"] = {
      execute: async () => {
        sawInbound = isToolRelayInbound();
        return { ok: true, output: "file contents", summary: "read ok" };
      },
    };
    const r = await handleToolRelay({
      envelope: envelope({ tool: "filesystem", input: { op: "read" } }),
      senderNodeId: "peer-a",
    });
    expect(r.ok).toBe(true);
    expect(r.output).toBe("file contents");
    expect(r.summary).toBe("read ok");
    expect(sawInbound).toBe(true); // executed within the inbound guard
  });

  it("refuses an unknown peer id", async () => {
    const r = await handleToolRelay({
      envelope: envelope({ tool: "filesystem", input: {} }),
      senderNodeId: "ghost",
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not trusted/i);
  });

  it("propagates tool execution failures", async () => {
    toolImpls["browser"] = {
      execute: async () => ({ ok: false, output: "Secure Browser unavailable", summary: "fail" }),
    };
    const r = await handleToolRelay({
      envelope: envelope({ tool: "browser", input: { url: "https://example.com" } }),
      senderNodeId: "peer-a",
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/unavailable/i);
  });

  it("returns an error when the tool is missing on this device", async () => {
    const r = await handleToolRelay({
      envelope: envelope({ tool: "contacts", input: {} }),
      senderNodeId: "peer-a",
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/unknown tool/i);
  });
});
