/**
 * Resolve which peer (if any) should host workspace tools for this call.
 */

import { getCodingSession } from "../db/coding";
import { getPeer } from "../db/fleet";
import { getNodeIdentity } from "./identity";
import { resolveWorkspacePin, peerAcceptsWorkspaceRelay } from "./placement-pins";
import { WORKSPACE_RELAY_TOOLS } from "./handlers/workspace-relay";
import { isWorkspaceRelayInbound } from "./workspace-relay-context";
import type { ToolContext } from "../tools/types";

function isRemotePeerId(id: string | null | undefined): id is string {
  if (!id || id === "local" || id === "auto") return false;
  try {
    if (id === getNodeIdentity().node_id) return false;
  } catch {
    /* identity may be unavailable in unit tests */
  }
  return true;
}

/** Session/pin targets must still be a trusted peer that accepts workspace relay. */
function isEligibleWorkspacePeer(id: string): boolean {
  const peer = getPeer(id);
  if (!peer || peer.trusted !== 1) return false;
  return peerAcceptsWorkspaceRelay(id);
}

/**
 * Returns peer_node_id when this tool invocation should RPC to a workspace host.
 */
export function resolveWorkspaceRelayPeer(
  toolName: string,
  input: Record<string, unknown>,
  ctx: ToolContext
): string | null {
  if (isWorkspaceRelayInbound()) return null;
  if (!WORKSPACE_RELAY_TOOLS.has(toolName)) return null;

  const sessionId =
    (typeof input.coding_session_id === "string" && input.coding_session_id) ||
    ctx.codingSessionId ||
    (typeof input.session_id === "string" &&
    toolName === "coding_project" &&
    (input.operation === "discard_session" || input.operation === "status")
      ? input.session_id
      : null);

  if (sessionId) {
    const session = getCodingSession(sessionId);
    const peerId = session?.workspace_peer_id ?? null;
    if (isRemotePeerId(peerId) && isEligibleWorkspacePeer(peerId)) {
      return peerId;
    }
  }

  // No session (or local workspace on session): honor global/conversation workspace pin
  // for coding_project list/register/start so projects live on the workspace host.
  if (toolName === "coding_project") {
    const op = String(input.operation || "");
    if (
      op === "list_projects" ||
      op === "register_project" ||
      op === "start_session" ||
      op === "list_sessions"
    ) {
      const ws = resolveWorkspacePin();
      if (ws.kind === "peer" && isRemotePeerId(ws.peer_node_id) && isEligibleWorkspacePeer(ws.peer_node_id)) {
        return ws.peer_node_id;
      }
    }
  }

  return null;
}
