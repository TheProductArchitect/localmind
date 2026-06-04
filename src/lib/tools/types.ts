import type { ToolDefinition } from "../providers/types";

export type ToolContext = {
  conversationId: string;
  approvedDirs: string[];
};

export type ToolResult = {
  ok: boolean;
  output: string;
  summary?: string;
};

export type Tool = {
  definition: ToolDefinition;
  actionType: string;
  classify?: (input: Record<string, any>) => string; // refine action type per-call
  preview?: (input: Record<string, any>) => string;
  forcedTier?: "allow" | "ask" | "pin"; // used by MCP tools; overrides permission profile
  /**
   * Version string used as a tool_call_cache key. Bump this when the tool's
   * implementation changes in a way that would invalidate prior outputs
   * (decision §14.1 — tool version busts cache).
   *
   * Default treated as "1" when omitted.
   */
  version?: string;
  /**
   * Returns true if THIS specific invocation can be cached. The cache only
   * fires when this returns true; without this hook, no caching happens.
   *
   * The caller is `runAgent` / executor; they pass the same `input` object
   * the agent supplied. Read-only ops (filesystem read, web_search, knowledge
   * search) typically return true; write ops (send_email, delete_files,
   * write_files) always return false. Tools that mix ops use the input's
   * `operation` discriminator to decide.
   */
  cacheable?: (input: Record<string, any>) => boolean;
  execute: (input: Record<string, any>, ctx: ToolContext) => Promise<ToolResult>;
};
