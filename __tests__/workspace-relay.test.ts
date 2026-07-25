/**
 * Workspace-relay unit tests — route resolution + initiator wiring (mocked peer).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const sessions = new Map<string, any>();
const settings = { workspace_placement: "local" as string };

vi.mock("../src/lib/db/coding", () => ({
  getCodingSession: (id: string) => sessions.get(id) || null,
  createCodingSession: vi.fn(),
  updateCodingSession: vi.fn((id: string, patch: any) => {
    const cur = sessions.get(id);
    if (!cur) return null;
    Object.assign(cur, patch);
    return cur;
  }),
}));

vi.mock("../src/lib/db/queries", () => ({
  getSettings: () => settings,
}));

vi.mock("../src/lib/db/fleet", () => ({
  listPeers: () => [
    {
      peer_node_id: "peer-ws",
      label: "WorkspaceBox",
      trusted: 1,
      capabilities_json: JSON.stringify({ accepts_workspace_relay: true }),
      policy_json: JSON.stringify({ accept_workspace_relay: true }),
    },
  ],
  getPeer: (id: string) =>
    id === "peer-ws"
      ? {
          peer_node_id: "peer-ws",
          label: "WorkspaceBox",
          trusted: 1,
          capabilities_json: JSON.stringify({ accepts_workspace_relay: true }),
          policy_json: JSON.stringify({ accept_workspace_relay: true }),
        }
      : null,
  parsePeerPolicy: () => ({ accept_workspace_relay: true }),
}));

vi.mock("../src/lib/fleet/identity", () => ({
  getNodeIdentity: () => ({ node_id: "local-node" }),
}));

vi.mock("../src/lib/fleet/chat-placement", () => ({
  pickChatExecutor: vi.fn(async () => ({ kind: "local", reason: "mock" })),
}));

const sendToPeer = vi.fn();
vi.mock("../src/lib/fleet/peer-client", () => ({
  sendToPeer: (...args: unknown[]) => sendToPeer(...args),
}));

vi.mock("../src/lib/agent/audit-logger", () => ({
  logStart: () => 42,
  logComplete: vi.fn(),
  linkAuditToPeer: vi.fn(),
  logStartFederated: () => 99,
}));

import { resolveWorkspaceRelayPeer } from "../src/lib/fleet/workspace-route";
import { relayWorkspaceToolToPeer } from "../src/lib/fleet/workspace-relay-initiator";
import { runAsWorkspaceRelayInbound, isWorkspaceRelayInbound } from "../src/lib/fleet/workspace-relay-context";
import { WORKSPACE_RELAY_TOOLS } from "../src/lib/fleet/handlers/workspace-relay";

describe("workspace relay route", () => {
  beforeEach(() => {
    sessions.clear();
    settings.workspace_placement = "local";
    sendToPeer.mockReset();
  });

  it("allowlists only git / coding_project / filesystem", () => {
    expect(WORKSPACE_RELAY_TOOLS.has("git")).toBe(true);
    expect(WORKSPACE_RELAY_TOOLS.has("shell")).toBe(false);
  });

  it("routes to session workspace peer", () => {
    sessions.set("csess-1", {
      id: "csess-1",
      workspace_peer_id: "peer-ws",
      compute_peer_id: "local",
    });
    const peer = resolveWorkspaceRelayPeer(
      "git",
      { operation: "status" },
      { conversationId: "c1", approvedDirs: [], codingSessionId: "csess-1" }
    );
    expect(peer).toBe("peer-ws");
  });

  it("does not route when workspace is local", () => {
    sessions.set("csess-2", {
      id: "csess-2",
      workspace_peer_id: "local",
    });
    const peer = resolveWorkspaceRelayPeer(
      "filesystem",
      {},
      { conversationId: "c1", approvedDirs: [], codingSessionId: "csess-2" }
    );
    expect(peer).toBeNull();
  });

  it("routes coding_project.start_session via settings workspace pin", () => {
    settings.workspace_placement = "peer-ws";
    const peer = resolveWorkspaceRelayPeer(
      "coding_project",
      { operation: "start_session", project_id: "p1", goal: "fix" },
      { conversationId: "c1", approvedDirs: [] }
    );
    expect(peer).toBe("peer-ws");
  });

  it("skips relay while inbound handler is running", async () => {
    sessions.set("csess-1", { id: "csess-1", workspace_peer_id: "peer-ws" });
    await runAsWorkspaceRelayInbound(async () => {
      expect(isWorkspaceRelayInbound()).toBe(true);
      const peer = resolveWorkspaceRelayPeer(
        "git",
        {},
        { conversationId: "c1", approvedDirs: [], codingSessionId: "csess-1" }
      );
      expect(peer).toBeNull();
    });
  });
});

describe("workspace relay initiator", () => {
  beforeEach(() => {
    sendToPeer.mockReset();
  });

  it("returns peer output on success", async () => {
    sendToPeer.mockResolvedValue({
      ok: true,
      envelope: {
        sig: "sig",
        lamport: 1,
        payload: {
          ok: true,
          executor_audit_id: 7,
          output: "ok-out",
          summary: "sum",
        },
      },
    });
    const r = await relayWorkspaceToolToPeer({
      peer_node_id: "peer-ws",
      tool: "git",
      input: { operation: "status" },
      conversation_id: "c1",
      coding_session_id: "csess-1",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.output).toBe("ok-out");
      expect(r.summary).toBe("sum");
      expect(r.peer_audit_id).toBe(7);
    }
    expect(sendToPeer).toHaveBeenCalledWith(
      "peer-ws",
      "workspace-relay",
      expect.objectContaining({ tool: "git" }),
      expect.objectContaining({ timeoutMs: 120_000 })
    );
  });

  it("surfaces peer refusal", async () => {
    sendToPeer.mockResolvedValue({
      ok: true,
      envelope: {
        sig: "sig",
        lamport: 1,
        payload: { ok: false, executor_audit_id: 0, output: "", error: "denied" },
      },
    });
    const r = await relayWorkspaceToolToPeer({
      peer_node_id: "peer-ws",
      tool: "filesystem",
      input: { operation: "read", path: "/x" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/denied/);
  });
});
