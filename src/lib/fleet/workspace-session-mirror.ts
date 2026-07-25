/**
 * After a remote coding_project.start_session, mirror the peer session locally
 * so compute-side tools can resolve coding_session_id → workspace_peer_id.
 */

import { createCodingSession, getCodingSession, updateCodingSession } from "../db/coding";
import { relayWorkspaceToolToPeer } from "./workspace-relay-initiator";

function parseStatusPayload(output: string): {
  session?: {
    id: string;
    project_id: string;
    branch: string;
    worktree_path: string;
    goal?: string;
    process_id?: string | null;
    status?: string;
  };
} | null {
  try {
    return JSON.parse(output) as {
      session?: {
        id: string;
        project_id: string;
        branch: string;
        worktree_path: string;
        goal?: string;
        process_id?: string | null;
        status?: string;
      };
    };
  } catch {
    return null;
  }
}

export async function mirrorRemoteCodingSession(args: {
  peerNodeId: string;
  remoteSessionId: string;
  conversationId?: string | null;
  goal: string;
  projectId: string;
  runSwe: boolean;
}): Promise<{ ok: true; sessionId: string } | { ok: false; error: string }> {
  const status = await relayWorkspaceToolToPeer({
    peer_node_id: args.peerNodeId,
    tool: "coding_project",
    input: { operation: "status", session_id: args.remoteSessionId },
    conversation_id: args.conversationId ?? null,
    coding_session_id: args.remoteSessionId,
  });
  if (!status.ok) {
    return { ok: false, error: status.reason };
  }
  const parsed = parseStatusPayload(status.output);
  const remote = parsed?.session;
  if (!remote?.id || !remote.worktree_path || !remote.branch) {
    return { ok: false, error: "Could not parse remote session status." };
  }

  const existing = getCodingSession(remote.id);
  if (!existing) {
    createCodingSession({
      id: remote.id,
      project_id: remote.project_id || args.projectId || "remote",
      branch: remote.branch,
      worktree_path: remote.worktree_path,
      goal: remote.goal || args.goal || "remote session",
      process_id: remote.process_id ?? null,
      compute_peer_id: "local",
      workspace_peer_id: args.peerNodeId,
    });
  } else {
    updateCodingSession(remote.id, {
      workspace_peer_id: args.peerNodeId,
      compute_peer_id: existing.compute_peer_id ?? "local",
      worktree_path: remote.worktree_path,
    });
  }

  if (args.runSwe) {
    try {
      const { startSweLoop } = await import("../coding/swe-graph");
      await startSweLoop(remote.id);
    } catch {
      /* best-effort — session still usable */
    }
  }

  return { ok: true, sessionId: remote.id };
}
