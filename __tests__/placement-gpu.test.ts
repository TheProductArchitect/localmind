import { describe, it, expect } from "vitest";
import { decidePlacement, type PeerCandidate } from "../src/lib/graph/placement";
import type { Capability } from "../src/lib/fleet/capabilities";

function caps(partial: Partial<Capability>): Capability {
  return {
    node_id: "local",
    app_version: "0.6.0",
    platform: "test",
    platform_id: "test",
    tls_fingerprint_short: "",
    models: [],
    tools: [],
    current_load: { active_processes: 0 },
    gpu_available: false,
    pairing_open: false,
    accepts_chat_relay: false,
    accepts_workspace_relay: false,
    accepts_tool_relay: false,
    generated_at: Date.now(),
    ...partial,
  };
}

function peer(node_id: string, partial: Partial<Capability>): PeerCandidate {
  return {
    node_id,
    capabilities: caps({ node_id, ...partial }),
    last_seen_at: Date.now(),
  };
}

describe("decidePlacement — GPU-aware chat placement", () => {
  const localWeak = caps({ node_id: "local", gpu_available: false, current_load: { active_processes: 0 } });

  it("prefers a fresh GPU peer with a large model over an idle local CPU node", () => {
    const spark = peer("spark", {
      gpu_available: true,
      models: [{ name: "llama3.1:70b", loaded: true }],
      current_load: { active_processes: 2 },
    });
    const d = decidePlacement({}, localWeak, [spark], { preferGpu: true });
    expect(d.target.kind).toBe("peer");
    if (d.target.kind === "peer") expect(d.target.peer_node_id).toBe("spark");
    expect(d.reason).toMatch(/GPU/i);
  });

  it("ranks a large-model GPU peer above a small-model GPU peer", () => {
    const bigGpu = peer("big", {
      gpu_available: true,
      models: [{ name: "qwen2.5:72b", loaded: true }],
      current_load: { active_processes: 5 },
    });
    const smallGpu = peer("small", {
      gpu_available: true,
      models: [{ name: "llama3.2:3b", loaded: true }],
      current_load: { active_processes: 0 },
    });
    const d = decidePlacement({}, localWeak, [bigGpu, smallGpu], { preferGpu: true });
    expect(d.target.kind).toBe("peer");
    if (d.target.kind === "peer") expect(d.target.peer_node_id).toBe("big");
  });

  it("without preferGpu, keeps the load-only ranking (tie-break to local)", () => {
    const spark = peer("spark", {
      gpu_available: true,
      models: [{ name: "llama3.1:70b", loaded: true }],
      current_load: { active_processes: 3 },
    });
    const d = decidePlacement({}, caps({ node_id: "local", current_load: { active_processes: 0 } }), [spark]);
    // Local has lower load and no GPU preference — it should win.
    expect(d.target.kind).toBe("local");
  });

  it("falls back to local when the only GPU peer has a stale heartbeat", () => {
    const stale: PeerCandidate = {
      node_id: "spark",
      capabilities: caps({ node_id: "spark", gpu_available: true }),
      last_seen_at: Date.now() - 5 * 60_000,
    };
    const d = decidePlacement({}, localWeak, [stale], { preferGpu: true });
    expect(d.target.kind).toBe("local");
  });

  it("among equal GPU+large peers, prefers lower load then local", () => {
    const localGpu = caps({
      node_id: "local",
      gpu_available: true,
      models: [{ name: "llama3.1:70b", loaded: true }],
      current_load: { active_processes: 1 },
    });
    const peerGpu = peer("spark", {
      gpu_available: true,
      models: [{ name: "llama3.1:70b", loaded: true }],
      current_load: { active_processes: 1 },
    });
    const d = decidePlacement({}, localGpu, [peerGpu], { preferGpu: true });
    expect(d.target.kind).toBe("local");
  });

  it("prefers a GPU peer over a non-GPU peer that merely has lower load", () => {
    const busyGpu = peer("spark", {
      gpu_available: true,
      models: [{ name: "qwen2.5:32b", loaded: false }],
      current_load: { active_processes: 4 },
    });
    const idleCpu = peer("laptop", {
      gpu_available: false,
      models: [{ name: "llama3.2:3b", loaded: true }],
      current_load: { active_processes: 0 },
    });
    const d = decidePlacement({}, localWeak, [idleCpu, busyGpu], { preferGpu: true });
    expect(d.target.kind).toBe("peer");
    if (d.target.kind === "peer") expect(d.target.peer_node_id).toBe("spark");
  });
});
