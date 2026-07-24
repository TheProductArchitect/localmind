/**
 * Capability snapshot — what this node can do, refreshed on every heartbeat.
 *
 * Consumed by:
 *   - outbound heartbeats (V6.1) — peers cache this to know what we offer
 *   - placement engine (V6.5)    — picks the cheapest peer with required caps
 *   - /fleet UI (V6.2)            — surfaces capability + load per peer
 *
 * Everything in here must be cheap to compute (heartbeat fires every 30s) and
 * tolerate failures of subsystems. Each field has an independent try/catch so
 * a single broken probe doesn't blank the whole capability set.
 */

import { getNodeIdentity } from "./identity";
import { getTlsMaterial } from "./tls";
import { PLATFORM, PLATFORM_CAPS, describePlatform } from "../platform";
import { listActive } from "../db/agent-processes";
import { getSettings } from "../db/queries";
import { listPeers, parsePeerPolicy } from "../db/fleet";

export const APP_VERSION = "0.6.0";

export type ModelCapability = {
  name: string;
  loaded: boolean;
  family?: string;
  size_bytes?: number;
};

export type Capability = {
  node_id: string;
  app_version: string;
  platform: string;                      // human-readable
  platform_id: string;                   // canonical (matches PLATFORM enum)
  tls_fingerprint_short: string;
  models: ModelCapability[];
  tools: string[];
  current_load: {
    active_processes: number;
  };
  gpu_available: boolean;
  pairing_open: boolean;                  // V6.2: true only while a pairing window is open
  /** True when at least one trusted peer may drive chat on this node. */
  accepts_chat_relay: boolean;
  /** True when at least one trusted peer may run workspace/git ops on this node. */
  accepts_workspace_relay: boolean;
  generated_at: number;
};

async function fetchModels(): Promise<ModelCapability[]> {
  try {
    // Lazy import — the providers module pulls in fetch-heavy code we don't
    // want to load on cold paths that only need identity.
    const { ollamaProvider } = await import("../providers");
    const active = (() => {
      try { return getSettings().active_model; } catch { return null; }
    })();
    const installed = await ollamaProvider.getModels().catch(() => []);
    return installed.map((m) => ({
      name: m.name,
      loaded: m.name === active,
      family: m.family,
      size_bytes: m.size,
    }));
  } catch {
    return [];
  }
}

async function fetchTools(): Promise<string[]> {
  try {
    const { listAllTools } = await import("../tools");
    const tools = await listAllTools();
    return tools.map((t) => t.definition.name);
  } catch {
    return [];
  }
}

function activeProcessCount(): number {
  try {
    return listActive(null).length;
  } catch {
    return 0;
  }
}

/**
 * Build a fresh capability snapshot. Heartbeat callers should invoke this
 * once per tick, not per peer — the snapshot is the same for every recipient.
 */
export async function snapshotCapability(): Promise<Capability> {
  const id = getNodeIdentity();
  // TLS fingerprint is short-formed only — peers already have the full one
  // from pairing. Surfacing it here lets peers detect a cert rotation.
  let tlsShort = "";
  try { tlsShort = getTlsMaterial().fingerprint_short; } catch { /* fleet listener off */ }

  const [models, tools] = await Promise.all([fetchModels(), fetchTools()]);

  let acceptsChatRelay = false;
  let acceptsWorkspaceRelay = false;
  try {
    const peers = listPeers();
    acceptsChatRelay = peers.some(
      (p) => p.trusted === 1 && parsePeerPolicy(p).accept_chat_relay
    );
    acceptsWorkspaceRelay = peers.some(
      (p) => p.trusted === 1 && parsePeerPolicy(p).accept_workspace_relay
    );
  } catch {
    acceptsChatRelay = false;
    acceptsWorkspaceRelay = false;
  }

  return {
    node_id: id.node_id,
    app_version: APP_VERSION,
    platform: describePlatform(),
    platform_id: PLATFORM,
    tls_fingerprint_short: tlsShort,
    models,
    tools,
    current_load: {
      active_processes: activeProcessCount(),
    },
    gpu_available: PLATFORM_CAPS.hasGPU,
    pairing_open: false,
    accepts_chat_relay: acceptsChatRelay,
    accepts_workspace_relay: acceptsWorkspaceRelay,
    generated_at: Date.now(),
  };
}
