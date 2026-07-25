/**
 * Unit tests for tool-relay initiator + primary_addr refresh + policy defaults.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const sendToPeer = vi.fn();
let peerRow: any = null;
const runs: Array<{ sql: string; args: unknown[] }> = [];

vi.mock("../src/lib/fleet/peer-client", () => ({
  sendToPeer: (...args: unknown[]) => sendToPeer(...args),
}));

vi.mock("../src/lib/agent/audit-logger", () => ({
  logStart: () => 11,
  logComplete: vi.fn(),
  linkAuditToPeer: vi.fn(),
}));

vi.mock("../src/lib/db", () => ({
  getConfigDb: () => ({
    prepare: (sql: string) => ({
      run: (...args: unknown[]) => {
        runs.push({ sql, args });
        return { changes: 1 };
      },
      get: () => {
        if (/FROM fleet_peers WHERE peer_node_id/.test(sql) || /SELECT \* FROM fleet_peers/.test(sql)) {
          return peerRow;
        }
        if (/strftime/.test(sql)) return { t: Date.now() };
        return null;
      },
      all: () => (peerRow ? [peerRow] : []),
    }),
  }),
}));

import { relayToolToPeer } from "../src/lib/fleet/tool-relay-initiator";
import { updatePeerPrimaryAddr, DEFAULT_PEER_POLICY, parsePeerPolicy } from "../src/lib/db/fleet";

describe("relayToolToPeer", () => {
  beforeEach(() => {
    sendToPeer.mockReset();
  });

  it("sends a tool-relay envelope and returns peer output", async () => {
    sendToPeer.mockResolvedValue({
      ok: true,
      envelope: {
        payload: {
          executor_audit_id: 99,
          ok: true,
          output: "inbox",
          summary: "3 emails",
        },
        sig: "sig",
        lamport: 3,
      },
    });
    const r = await relayToolToPeer({
      peer_node_id: "pc-1",
      tool: "email",
      input: { op: "list" },
      conversation_id: "c1",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.output).toBe("inbox");
      expect(r.summary).toBe("3 emails");
      expect(r.peer_audit_id).toBe(99);
    }
    expect(sendToPeer).toHaveBeenCalledWith(
      "pc-1",
      "tool-relay",
      expect.objectContaining({
        tool: "email",
        input: { op: "list" },
        conversation_id: "c1",
        initiator_audit_id: 11,
      }),
      expect.any(Object)
    );
  });

  it("maps RPC failure to ok:false", async () => {
    sendToPeer.mockResolvedValue({ ok: false, status: 502, reason: "peer down" });
    const r = await relayToolToPeer({
      peer_node_id: "pc-1",
      tool: "filesystem",
      input: {},
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/peer down/);
  });

  it("maps peer refusal payload to ok:false", async () => {
    sendToPeer.mockResolvedValue({
      ok: true,
      envelope: {
        payload: { executor_audit_id: 1, ok: false, output: "", error: "not granted" },
        sig: "s",
        lamport: 1,
      },
    });
    const r = await relayToolToPeer({
      peer_node_id: "pc-1",
      tool: "calendar",
      input: {},
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/not granted/);
  });
});

describe("updatePeerPrimaryAddr", () => {
  beforeEach(() => {
    peerRow = null;
    runs.length = 0;
  });

  it("updates when the advertised LAN address changes", () => {
    peerRow = {
      peer_node_id: "spark",
      primary_addr: "192.168.1.20:9443",
      pubkey_pem: "",
      label: null,
      paired_at: 0,
      last_seen_at: null,
      capabilities_json: "{}",
      policy_json: "{}",
      trusted: 1,
    };
    updatePeerPrimaryAddr("spark", "192.168.1.55:9443");
    expect(runs.some((r) => /UPDATE fleet_peers SET primary_addr/.test(r.sql))).toBe(true);
    const update = runs.find((r) => /UPDATE fleet_peers SET primary_addr/.test(r.sql));
    expect(update?.args).toEqual(["192.168.1.55:9443", "spark"]);
  });

  it("no-ops for loopback and unchanged addresses", () => {
    peerRow = {
      peer_node_id: "spark",
      primary_addr: "192.168.1.20:9443",
      pubkey_pem: "",
      label: null,
      paired_at: 0,
      last_seen_at: null,
      capabilities_json: "{}",
      policy_json: "{}",
      trusted: 1,
    };
    updatePeerPrimaryAddr("spark", "127.0.0.1:9443");
    updatePeerPrimaryAddr("spark", "localhost:9443");
    updatePeerPrimaryAddr("spark", "192.168.1.20:9443");
    updatePeerPrimaryAddr("spark", null);
    expect(runs.filter((r) => /primary_addr/.test(r.sql))).toHaveLength(0);
  });
});

describe("parsePeerPolicy — accept_tool_relay default", () => {
  it("fills accept_tool_relay=false when policy_json omits it", () => {
    const policy = parsePeerPolicy({
      peer_node_id: "x",
      pubkey_pem: "",
      label: null,
      primary_addr: null,
      paired_at: 0,
      last_seen_at: null,
      capabilities_json: "{}",
      policy_json: JSON.stringify({ accept_chat_relay: true }),
      trusted: 1,
    });
    expect(policy.accept_chat_relay).toBe(true);
    expect(policy.accept_tool_relay).toBe(false);
    expect(DEFAULT_PEER_POLICY.accept_tool_relay).toBe(false);
  });
});
