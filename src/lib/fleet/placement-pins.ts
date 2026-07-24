/**
 * Resolve compute vs workspace placement pins for chat / coding sessions.
 * LAN mesh only — values are local | auto | <peer_node_id>.
 */

import { getSettings } from "../db/queries";
import { listPeers, getPeer } from "../db/fleet";
import { pickChatExecutor, type ChatExecutor } from "./chat-placement";

export type PlacementPin = string; // "local" | "auto" | peer_node_id

export type ResolvedPlacement = {
  compute: ChatExecutor;
  workspace: { kind: "local" } | { kind: "peer"; peer_node_id: string; label: string };
};

function peerLabel(peerId: string): string {
  const p = listPeers().find((x) => x.peer_node_id === peerId);
  return p?.label || peerId.slice(0, 8);
}

function capsAcceptWorkspace(json: string): boolean {
  try {
    const caps = JSON.parse(json || "{}") as { accepts_workspace_relay?: boolean };
    return caps.accepts_workspace_relay === true;
  } catch {
    return false;
  }
}

/** True when a trusted peer advertises accepts_workspace_relay. */
export function peerAcceptsWorkspaceRelay(peerId: string): boolean {
  const p = getPeer(peerId) || listPeers().find((x) => x.peer_node_id === peerId);
  if (!p || p.trusted !== 1) return false;
  return capsAcceptWorkspace(p.capabilities_json);
}

/**
 * Resolve compute executor from an explicit pin (conversation or settings).
 */
export async function resolveComputePin(pin?: string | null): Promise<ChatExecutor> {
  const settings = getSettings() as { compute_placement?: string };
  const raw = (pin || settings.compute_placement || "auto").toString();
  if (raw === "local") return { kind: "local", reason: "pinned local" };
  if (raw !== "auto") {
    return {
      kind: "peer",
      peer_node_id: raw,
      label: peerLabel(raw),
      reason: "pinned compute peer",
    };
  }
  return pickChatExecutor();
}

export type WorkspaceResolve =
  | { ok: true; workspace: ResolvedPlacement["workspace"] }
  | { ok: false; error: string };

/**
 * Workspace host: where git/worktree ops run. Never "auto" — default local.
 * Use resolveWorkspacePinStrict when the API must 400 on an ineligible peer.
 */
export function resolveWorkspacePin(pin?: string | null): ResolvedPlacement["workspace"] {
  const r = resolveWorkspacePinStrict(pin);
  return r.ok ? r.workspace : { kind: "local" };
}

export function resolveWorkspacePinStrict(pin?: string | null): WorkspaceResolve {
  const settings = getSettings() as { workspace_placement?: string };
  const raw = (pin || settings.workspace_placement || "local").toString();
  if (!raw || raw === "local" || raw === "auto") {
    return { ok: true, workspace: { kind: "local" } };
  }
  if (!peerAcceptsWorkspaceRelay(raw)) {
    return {
      ok: false,
      error: `Peer ${raw.slice(0, 12)} does not accept workspace relay (enable Accept workspace relay on that device).`,
    };
  }
  return { ok: true, workspace: { kind: "peer", peer_node_id: raw, label: peerLabel(raw) } };
}

export async function resolvePlacement(opts?: {
  computePin?: string | null;
  workspacePin?: string | null;
}): Promise<ResolvedPlacement> {
  const compute = await resolveComputePin(opts?.computePin);
  const workspace = resolveWorkspacePin(opts?.workspacePin);
  return { compute, workspace };
}
