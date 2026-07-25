/**
 * Resolve approvedDirs overlay when a coding_session_id is present.
 */

import { sessionApprovedDirs } from "../coding/worktree";
import type { ToolContext } from "./types";

export function resolveCodingSession(
  input: Record<string, unknown>,
  ctx: ToolContext
): { sessionId: string | null; approvedDirs: string[] } {
  const sid =
    (typeof input.coding_session_id === "string" && input.coding_session_id) ||
    ctx.codingSessionId ||
    null;
  if (!sid) return { sessionId: null, approvedDirs: ctx.approvedDirs };
  const overlay = sessionApprovedDirs(sid);
  if (overlay?.length) return { sessionId: sid, approvedDirs: overlay };
  return { sessionId: sid, approvedDirs: ctx.approvedDirs };
}
