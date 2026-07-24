import { filesystemTool } from "./filesystem";
import { websearchTool } from "./websearch";
import { memoryTool } from "./memory";
import { calendarTool } from "./calendar";
import { emailTool } from "./email";
import { macAutomationTool } from "./mac-automation";
import { browserTool } from "./browser";
import { knowledgeTool } from "./knowledge";
import { devpmTool } from "./devpm";
import { datastoreTool } from "./datastore";
import { spreadsheetTool } from "./spreadsheet";
import { peerKnowledgeTool } from "./peer-knowledge";
import { piCodeTool } from "./pi-code";
import { spawnSubagentTool, spawnSubagentsParallelTool, spawnSubagentsSequentialTool, spawnAgentsTool } from "./subagent";
import { codingProjectTool } from "./coding-project";
import { gitTool } from "./git";
import { checkResourcesTool } from "./check-resources";
import { timeTool } from "./time";
import { requestToolAccessTool } from "./request-tool-access";
import { agentMemoryAdminTool } from "./agent-memory-admin";
import { installMcpServerTool } from "./install-mcp";
import { remindersTool } from "./reminders";
import { contactsTool } from "./contacts";
import { scheduleTool } from "./schedule";
import { recallTool } from "./recall";
import { webResearchTool } from "./web-research";
import { readSecureWebpageTool, SECURE_BROWSER_MCP_NAME } from "./read-secure-webpage";
import { browseSessionTool } from "./browse-session";
import { manageWorkflowTool } from "./manage-workflow";
import { presentationTool } from "./presentation";
import { getMcpTools } from "./mcp";
import type { Tool } from "./types";

const BUILTIN: Tool[] = [
  filesystemTool,
  websearchTool,
  memoryTool,
  calendarTool,
  emailTool,
  macAutomationTool,
  browserTool,
  remindersTool,
  contactsTool,
  scheduleTool,
  manageWorkflowTool,
  presentationTool,
  recallTool,
  webResearchTool,
  readSecureWebpageTool,
  browseSessionTool,
  knowledgeTool,
  devpmTool,
  datastoreTool,
  spreadsheetTool,
  peerKnowledgeTool,
  piCodeTool,
  checkResourcesTool,
  timeTool,
  requestToolAccessTool,
  agentMemoryAdminTool,
  installMcpServerTool,
  spawnSubagentTool,
  spawnSubagentsSequentialTool,
  spawnSubagentsParallelTool,
  spawnAgentsTool,
  codingProjectTool,
  gitTool,
];

export function listBuiltinTools(): Tool[] {
  return BUILTIN;
}

export async function listAllTools(): Promise<Tool[]> {
  const mcp = await getMcpTools().catch(() => []);
  // Secure Browser is exposed via the first-class `read_secure_webpage` alias
  // so the model doesn't see two names for the same capability.
  const otherMcp = mcp.filter((t) => t.definition.name !== SECURE_BROWSER_MCP_NAME);
  return [...BUILTIN, ...otherMcp];
}

export function getBuiltinTool(name: string): Tool | undefined {
  return BUILTIN.find((t) => t.definition.name === name);
}
