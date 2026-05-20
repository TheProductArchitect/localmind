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
  execute: (input: Record<string, any>, ctx: ToolContext) => Promise<ToolResult>;
};
