import { nanoid } from "nanoid";
import { getConfigDb } from ".";

export type PluginType =
  | "mcp-server"
  | "workflow-template"
  | "system-prompt-template"
  | "agent-config"
  | "knowledge-dataset";

export type InstalledPlugin = {
  plugin_id: string;
  plugin_type: PluginType;
  name: string;
  version: string;
  source_url: string | null;
  installed_at: number;
  enabled: number;
  config_json: string;
};

function readNow(): number {
  const r = getConfigDb()
    .prepare("SELECT CAST(strftime('%s','now') AS INTEGER) * 1000 AS t")
    .get() as { t: number };
  return r.t;
}

export function listInstalled(): InstalledPlugin[] {
  return getConfigDb()
    .prepare("SELECT * FROM plugins ORDER BY installed_at DESC")
    .all() as InstalledPlugin[];
}

export function getInstalled(id: string): InstalledPlugin | null {
  return (
    (getConfigDb()
      .prepare("SELECT * FROM plugins WHERE plugin_id=?")
      .get(id) as InstalledPlugin | undefined) || null
  );
}

export function findInstalledByName(name: string, type: PluginType): InstalledPlugin | null {
  return (
    (getConfigDb()
      .prepare("SELECT * FROM plugins WHERE name=? AND plugin_type=?")
      .get(name, type) as InstalledPlugin | undefined) || null
  );
}

export function recordInstall(args: {
  plugin_type: PluginType;
  name: string;
  version: string;
  source_url?: string | null;
  config?: Record<string, unknown>;
}): InstalledPlugin {
  const id = `plg-${nanoid(10)}`;
  getConfigDb()
    .prepare(
      "INSERT INTO plugins (plugin_id, plugin_type, name, version, source_url, installed_at, enabled, config_json) VALUES (?,?,?,?,?,?,?,?)"
    )
    .run(
      id,
      args.plugin_type,
      args.name,
      args.version,
      args.source_url ?? null,
      readNow(),
      1,
      JSON.stringify(args.config ?? {})
    );
  return getInstalled(id)!;
}

export function setEnabled(id: string, enabled: boolean): void {
  getConfigDb()
    .prepare("UPDATE plugins SET enabled=? WHERE plugin_id=?")
    .run(enabled ? 1 : 0, id);
}

export function uninstall(id: string): boolean {
  const r = getConfigDb().prepare("DELETE FROM plugins WHERE plugin_id=?").run(id);
  return r.changes > 0;
}

export function updateConfig(id: string, config: Record<string, unknown>): void {
  getConfigDb()
    .prepare("UPDATE plugins SET config_json=? WHERE plugin_id=?")
    .run(JSON.stringify(config), id);
}

export function setVersion(id: string, version: string): void {
  getConfigDb()
    .prepare("UPDATE plugins SET version=? WHERE plugin_id=?")
    .run(version, id);
}
