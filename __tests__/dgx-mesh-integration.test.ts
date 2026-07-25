/**
 * Integration tests for DGX mesh PA: tool-home routing through executeWithCache,
 * chat-relay tool_home ALS + confirmation event forwarding, and peer policy defaults.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- Shared mocks for tool-cache path ------------------------------------
const relayToolToPeer = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const resolveWorkspaceRelayPeer = vi.fn<(...args: unknown[]) => string | null>(() => null);

vi.mock("../src/lib/fleet/tool-relay-initiator", () => ({
  relayToolToPeer: (...args: unknown[]) => relayToolToPeer(...args),
}));

vi.mock("../src/lib/fleet/workspace-route", () => ({
  resolveWorkspaceRelayPeer: (...args: unknown[]) => resolveWorkspaceRelayPeer(...args),
}));

vi.mock("../src/lib/fleet/workspace-relay-initiator", () => ({
  relayWorkspaceToolToPeer: vi.fn(),
}));

vi.mock("../src/lib/fleet/workspace-session-mirror", () => ({
  mirrorRemoteCodingSession: vi.fn(),
}));

vi.mock("../src/lib/db/tool-call-cache", () => ({
  lookup: () => null,
  store: () => {},
  computeToolInputHash: () => "hash",
}));

// ---- Chat-relay mocks ----------------------------------------------------
const peerRecord = {
  peer_node_id: "peer-pc",
  pubkey_pem: "<test-key>",
  label: "Laptop",
  primary_addr: "192.168.1.10:9443",
  paired_at: Date.now() - 8 * 24 * 3600 * 1000,
  last_seen_at: Date.now() - 1_000,
  capabilities_json: "{}",
  policy_json: "{}",
  trusted: 1,
};

vi.mock("../src/lib/db/fleet", () => ({
  getPeer: vi.fn(() => peerRecord),
  parsePeerPolicy: vi.fn(() => ({
    allow_self_actions: false,
    allowed_tools: [],
    advertise_capabilities: true,
    accept_chat_relay: true,
    accept_workspace_relay: false,
    accept_tool_relay: false,
    chat_relay_rate_per_min: 30,
    sync_conversations: true,
  })),
  DEFAULT_PEER_POLICY: {
    allow_self_actions: false,
    allowed_tools: [],
    advertise_capabilities: true,
    accept_chat_relay: false,
    accept_workspace_relay: false,
    accept_tool_relay: false,
    chat_relay_rate_per_min: 30,
    sync_conversations: true,
  },
}));

vi.mock("../src/lib/agent/audit-logger", () => ({
  logStartFederated: vi.fn(() => 42),
  logComplete: vi.fn(),
  logStart: vi.fn(() => 7),
  linkAuditToPeer: vi.fn(),
}));

vi.mock("../src/lib/db/queries", () => ({
  createConversation: vi.fn(() => ({ id: "conv-1" })),
  getConversation: vi.fn(() => ({ id: "conv-1" })),
}));

vi.mock("../src/lib/db", () => ({
  getConvDb: () => ({
    prepare: () => ({
      get: vi.fn(() => undefined),
      run: vi.fn(() => ({ changes: 1 })),
    }),
  }),
}));

vi.mock("../src/lib/agent/engine", () => ({
  runAgentCollect: vi.fn(async () => {
    const { getToolHome } = await import("../src/lib/fleet/tool-relay-context");
    const home = getToolHome();
    return home ? `tool_home=${home.initiatorNodeId}` : "local";
  }),
  runAgent: async function* () {
    yield {
      type: "confirmation_required",
      toolCallId: "tc-stream-1",
      actionType: "delete_files",
      preview: "Delete /tmp/x",
      timeoutSeconds: 60,
      requiresPin: false,
    };
    yield { type: "text_chunk", delta: "Approved and done." };
  },
}));

import { executeWithCache } from "../src/lib/agent/tool-cache-wrapper";
import {
  runWithToolHome,
  runAsToolRelayInbound,
  getToolHome,
} from "../src/lib/fleet/tool-relay-context";
import {
  handleChatRelay,
  __resetChatRelayState,
} from "../src/lib/fleet/handlers/chat-relay";
import { DEFAULT_PEER_POLICY } from "../src/lib/db/fleet";
import { requiredRoleFor } from "../src/lib/auth/route-map";
import type { Tool } from "../src/lib/tools/types";
import type { SignedEnvelope } from "../src/lib/fleet/envelope";

function makeTool(name: string, execute = vi.fn(async () => ({ ok: true, output: "local", summary: "local" }))): Tool {
  return {
    definition: { name, description: name, parameters: { type: "object", properties: {} } },
    actionType: "read",
    execute,
  } as Tool;
}

function makeEnvelope(payload: Record<string, unknown>): SignedEnvelope<any> {
  return {
    v: 1,
    kind: "chat-relay",
    sender: "peer-pc",
    recipient: "self",
    lamport: 1,
    ts: Date.now(),
    payload,
    sig: "sig",
  };
}

describe("DEFAULT_PEER_POLICY", () => {
  it("defaults accept_tool_relay to false (explicit grant required)", () => {
    expect(DEFAULT_PEER_POLICY.accept_tool_relay).toBe(false);
    expect(DEFAULT_PEER_POLICY.accept_chat_relay).toBe(false);
    expect(DEFAULT_PEER_POLICY.accept_workspace_relay).toBe(false);
  });
});

describe("route-map: fleet confirm + chat", () => {
  it("allows authenticated users to POST confirm decisions", () => {
    expect(requiredRoleFor("/api/fleet/peers/abc/confirm", "POST")).toBe("authenticated");
    expect(requiredRoleFor("/api/fleet/peers/abc/chat", "POST")).toBe("authenticated");
  });
});

describe("executeWithCache — tool home = initiator", () => {
  beforeEach(() => {
    relayToolToPeer.mockReset();
    resolveWorkspaceRelayPeer.mockReturnValue(null);
  });

  it("relays allowlisted PA tools to the initiator when tool home is set", async () => {
    relayToolToPeer.mockResolvedValue({
      ok: true,
      local_audit_id: 1,
      peer_audit_id: 2,
      output: "calendar events",
      summary: "ok",
    });
    const tool = makeTool("calendar");
    const result = await runWithToolHome({ initiatorNodeId: "peer-pc", conversationId: "c1" }, () =>
      executeWithCache(tool, { op: "list" }, { conversationId: "c1", approvedDirs: [] })
    );
    expect(result.ok).toBe(true);
    expect(result.output).toBe("calendar events");
    expect(relayToolToPeer).toHaveBeenCalledWith(
      expect.objectContaining({
        peer_node_id: "peer-pc",
        tool: "calendar",
        conversation_id: "c1",
      })
    );
    expect(tool.execute).not.toHaveBeenCalled();
  });

  it("does not relay shell even when tool home is set", async () => {
    const execute = vi.fn(async () => ({ ok: true, output: "ran", summary: "shell" }));
    const tool = makeTool("shell", execute);
    const result = await runWithToolHome({ initiatorNodeId: "peer-pc" }, () =>
      executeWithCache(tool, { cmd: "ls" }, { conversationId: "c1", approvedDirs: [] })
    );
    expect(result.ok).toBe(true);
    expect(result.output).toBe("ran");
    expect(relayToolToPeer).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalled();
  });

  it("does not re-relay when already handling an inbound tool-relay", async () => {
    const execute = vi.fn(async () => ({ ok: true, output: "local-fs", summary: "read" }));
    const tool = makeTool("filesystem", execute);
    const result = await runWithToolHome({ initiatorNodeId: "peer-pc" }, () =>
      runAsToolRelayInbound(() =>
        executeWithCache(tool, { op: "read" }, { conversationId: "c1", approvedDirs: [] })
      )
    );
    expect(result.output).toBe("local-fs");
    expect(relayToolToPeer).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalled();
  });

  it("surfaces tool-relay failures to the model", async () => {
    relayToolToPeer.mockResolvedValue({
      ok: false,
      local_audit_id: 1,
      reason: "Peer refused tool relay.",
    });
    const tool = makeTool("email");
    const result = await runWithToolHome({ initiatorNodeId: "peer-pc" }, () =>
      executeWithCache(tool, {}, { conversationId: "c1", approvedDirs: [] })
    );
    expect(result.ok).toBe(false);
    expect(result.summary).toBe("tool-relay failed");
    expect(result.output).toMatch(/refused/i);
  });

  it("runs locally when no tool home is set", async () => {
    expect(getToolHome()).toBeNull();
    const execute = vi.fn(async () => ({ ok: true, output: "here", summary: "local" }));
    const tool = makeTool("filesystem", execute);
    const result = await executeWithCache(tool, {}, { conversationId: "c1", approvedDirs: [] });
    expect(result.output).toBe("here");
    expect(relayToolToPeer).not.toHaveBeenCalled();
  });
});

describe("chat-relay — tool_home + confirmation events", () => {
  beforeEach(() => {
    __resetChatRelayState();
  });

  it("runs the engine with tool home = initiator when requested", async () => {
    const r = await handleChatRelay({
      envelope: makeEnvelope({
        initiator_audit_id: 1,
        initiator_conversation_id: "remote-c1",
        message: "check my calendar",
        tool_home: "initiator",
      }),
      senderNodeId: "peer-pc",
    });
    expect(r.ok).toBe(true);
    expect(r.reply).toBe("tool_home=peer-pc");
  });

  it("leaves tool home unset when tool_home is executor/omitted", async () => {
    const r = await handleChatRelay({
      envelope: makeEnvelope({
        initiator_audit_id: 1,
        initiator_conversation_id: "remote-c2",
        message: "hello",
      }),
      senderNodeId: "peer-pc",
    });
    expect(r.ok).toBe(true);
    expect(r.reply).toBe("local");
  });

  it("forwards confirmation_required via onEvent during streaming", async () => {
    const events: Array<{ type: string; [k: string]: unknown }> = [];
    const tokens: string[] = [];
    const r = await handleChatRelay({
      envelope: makeEnvelope({
        initiator_audit_id: 1,
        initiator_conversation_id: "remote-c3",
        message: "delete something",
        stream_tokens: true,
        tool_home: "initiator",
      }),
      senderNodeId: "peer-pc",
      onToken: (t) => {
        tokens.push(t);
      },
      onEvent: (e) => {
        events.push(e);
      },
    });
    expect(r.ok).toBe(true);
    expect(r.reply).toBe("Approved and done.");
    expect(tokens).toEqual(["Approved and done."]);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("confirmation_required");
    expect(events[0].toolCallId).toBe("tc-stream-1");
  });
});
