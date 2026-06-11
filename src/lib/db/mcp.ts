import { nanoid } from "nanoid";
import { getConfigDb } from ".";
import { encrypt, decrypt } from "../crypto";

export type Transport = "sse" | "stdio" | "ws";

export type McpServer = {
  id: string;
  name: string;
  url: string;
  description: string | null;
  tier: "allow" | "ask" | "pin";
  enabled: number;
  created_at: number;
  transport: Transport;
  source: string;
  env_encrypted: string | null;
  command: string | null;
  last_connected_at: number | null;
  allowlist: string;
  builtin: number;
};

export type McpToolRow = {
  id: string;
  server_id: string;
  tool_name: string;
  description: string | null;
  parameter_schema: string | null;
  tier: "allow" | "ask" | "pin";
  call_count: number;
  last_called_at: number | null;
};

export function listMcpServers(): McpServer[] {
  return getConfigDb().prepare("SELECT * FROM mcp_servers ORDER BY created_at").all() as McpServer[];
}

export function getMcpServer(id: string): McpServer | null {
  return (getConfigDb().prepare("SELECT * FROM mcp_servers WHERE id=?").get(id) as McpServer) || null;
}

export function addMcpServer(opts: {
  name: string;
  url: string;
  description?: string;
  tier?: string;
  transport?: Transport;
  source?: string;
  command?: string;
  env?: Record<string, string>;
  allowlist?: string[];
}): McpServer {
  const id = nanoid(10);
  const now = Date.now();
  getConfigDb()
    .prepare(
      `INSERT INTO mcp_servers
        (id,name,url,description,tier,enabled,created_at,transport,source,env_encrypted,command,allowlist)
       VALUES (?,?,?,?,?,1,?,?,?,?,?,?)`
    )
    .run(
      id,
      opts.name,
      opts.url,
      opts.description || null,
      opts.tier || "ask",
      now,
      opts.transport || "sse",
      opts.source || "manual",
      opts.env ? encrypt(JSON.stringify(opts.env)) : null,
      opts.command || null,
      JSON.stringify(opts.allowlist || [])
    );
  return getMcpServer(id)!;
}

export function deleteMcpServer(id: string) {
  const db = getConfigDb();
  // Builtin servers ship with LocalMind. Deleting the row would just have
  // ensureBuiltinMcpServers() recreate it on next boot, but the user can
  // toggle `enabled` to turn them off. Refuse the delete so the caller gets
  // a clear error instead of confusing transient state.
  const row = db.prepare("SELECT builtin FROM mcp_servers WHERE id=?").get(id) as { builtin: number } | undefined;
  if (row && row.builtin) {
    throw new Error("Cannot delete a built-in MCP server. Disable it instead.");
  }
  db.prepare("DELETE FROM mcp_servers WHERE id=?").run(id);
  db.prepare("DELETE FROM mcp_tools WHERE server_id=?").run(id);
}

export function setMcpEnabled(id: string, enabled: boolean) {
  getConfigDb().prepare("UPDATE mcp_servers SET enabled=? WHERE id=?").run(enabled ? 1 : 0, id);
}

export function markConnected(id: string) {
  getConfigDb().prepare("UPDATE mcp_servers SET last_connected_at=? WHERE id=?").run(Date.now(), id);
}

export function setMcpAllowlist(id: string, allowlist: string[]) {
  getConfigDb().prepare("UPDATE mcp_servers SET allowlist=? WHERE id=?").run(JSON.stringify(allowlist), id);
}

export function getMcpEnv(server: McpServer): Record<string, string> {
  if (!server.env_encrypted) return {};
  try {
    return JSON.parse(decrypt(server.env_encrypted));
  } catch {
    return {};
  }
}

// ---- mcp_tools ----
export function listMcpTools(serverId?: string): McpToolRow[] {
  const db = getConfigDb();
  if (serverId) return db.prepare("SELECT * FROM mcp_tools WHERE server_id=?").all(serverId) as McpToolRow[];
  return db.prepare("SELECT * FROM mcp_tools").all() as McpToolRow[];
}

export function syncMcpTools(serverId: string, defaultTier: string, tools: { name: string; description?: string; schema?: any }[]) {
  const db = getConfigDb();
  const existing = listMcpTools(serverId);
  const existingByName = new Map(existing.map((t) => [t.tool_name, t]));
  const seen = new Set<string>();
  const ins = db.prepare(
    "INSERT INTO mcp_tools (id,server_id,tool_name,description,parameter_schema,tier,call_count) VALUES (?,?,?,?,?,?,0)"
  );
  const upd = db.prepare("UPDATE mcp_tools SET description=?, parameter_schema=? WHERE id=?");
  for (const t of tools) {
    seen.add(t.name);
    const prev = existingByName.get(t.name);
    if (prev) {
      upd.run(t.description || null, JSON.stringify(t.schema || {}), prev.id);
    } else {
      ins.run(nanoid(10), serverId, t.name, t.description || null, JSON.stringify(t.schema || {}), defaultTier);
    }
  }
  // Remove tools that no longer exist on the server.
  for (const t of existing) {
    if (!seen.has(t.tool_name)) db.prepare("DELETE FROM mcp_tools WHERE id=?").run(t.id);
  }
}

export function setMcpToolTier(id: string, tier: string) {
  getConfigDb().prepare("UPDATE mcp_tools SET tier=? WHERE id=?").run(tier, id);
}

export function bumpMcpToolUsage(serverId: string, toolName: string) {
  getConfigDb()
    .prepare("UPDATE mcp_tools SET call_count=call_count+1, last_called_at=? WHERE server_id=? AND tool_name=?")
    .run(Date.now(), serverId, toolName);
}
