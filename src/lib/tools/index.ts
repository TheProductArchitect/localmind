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
  knowledgeTool,
  devpmTool,
  datastoreTool,
  spreadsheetTool,
];

export function listBuiltinTools(): Tool[] {
  return BUILTIN;
}

export async function listAllTools(): Promise<Tool[]> {
  const mcp = await getMcpTools().catch(() => []);
  return [...BUILTIN, ...mcp];
}

export function getBuiltinTool(name: string): Tool | undefined {
  return BUILTIN.find((t) => t.definition.name === name);
}
