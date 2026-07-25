import { describe, it, expect, vi, beforeEach } from "vitest";

const peers: any[] = [];
const settings = { compute_placement: "auto", workspace_placement: "local" };

vi.mock("../src/lib/db/queries", () => ({
  getSettings: () => settings,
}));

vi.mock("../src/lib/db/fleet", () => ({
  listPeers: () => peers,
  getPeer: (id: string) => peers.find((p) => p.peer_node_id === id) || null,
  parsePeerPolicy: (p: any) => {
    try {
      return { accept_workspace_relay: false, ...(JSON.parse(p.policy_json || "{}") || {}) };
    } catch {
      return { accept_workspace_relay: false };
    }
  },
}));

vi.mock("../src/lib/fleet/chat-placement", () => ({
  pickChatExecutor: vi.fn(async () => ({ kind: "local", reason: "auto mock" })),
}));

import {
  resolveComputePin,
  resolveWorkspacePin,
  resolveWorkspacePinStrict,
  resolvePlacement,
  peerAcceptsWorkspaceRelay,
} from "../src/lib/fleet/placement-pins";

describe("placement pins", () => {
  beforeEach(() => {
    peers.length = 0;
    settings.compute_placement = "auto";
    settings.workspace_placement = "local";
  });

  it("pins compute to local", async () => {
    const r = await resolveComputePin("local");
    expect(r.kind).toBe("local");
  });

  it("pins compute to an explicit peer", async () => {
    peers.push({
      peer_node_id: "peer-a",
      label: "Spark",
      trusted: 1,
      capabilities_json: "{}",
      policy_json: "{}",
    });
    const r = await resolveComputePin("peer-a");
    expect(r.kind).toBe("peer");
    if (r.kind === "peer") {
      expect(r.peer_node_id).toBe("peer-a");
      expect(r.label).toBe("Spark");
    }
  });

  it("defaults workspace to local", () => {
    expect(resolveWorkspacePin(null)).toEqual({ kind: "local" });
  });

  it("rejects workspace peer without accepts_workspace_relay", () => {
    peers.push({
      peer_node_id: "peer-b",
      label: "Mac",
      trusted: 1,
      capabilities_json: JSON.stringify({ accepts_workspace_relay: false }),
      policy_json: "{}",
    });
    expect(peerAcceptsWorkspaceRelay("peer-b")).toBe(false);
    const strict = resolveWorkspacePinStrict("peer-b");
    expect(strict.ok).toBe(false);
    if (!strict.ok) expect(strict.error).toMatch(/workspace relay/i);
    // Soft resolve fails closed to local
    expect(resolveWorkspacePin("peer-b")).toEqual({ kind: "local" });
  });

  it("selects workspace peer that advertises accepts_workspace_relay", async () => {
    peers.push({
      peer_node_id: "peer-c",
      label: "NAS",
      trusted: 1,
      capabilities_json: JSON.stringify({ accepts_workspace_relay: true }),
      policy_json: "{}",
    });
    expect(peerAcceptsWorkspaceRelay("peer-c")).toBe(true);
    const ws = resolveWorkspacePin("peer-c");
    expect(ws).toEqual({ kind: "peer", peer_node_id: "peer-c", label: "NAS" });
    const placement = await resolvePlacement({
      computePin: "local",
      workspacePin: "peer-c",
    });
    expect(placement.compute.kind).toBe("local");
    expect(placement.workspace.kind).toBe("peer");
  });
});
