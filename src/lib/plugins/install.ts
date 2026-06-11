import {
  recordInstall,
  findInstalledByName,
  uninstall as dbUninstall,
  getInstalled,
  setVersion,
  updateConfig,
} from "../db/plugins";
import type { RegistryPlugin } from "./registry";
import { createPersona, getPersona, deletePersona } from "../db/personas";
import { listBlocks, replaceBlocks, BUILTIN_BLOCK_NAMES } from "../db/system-prompt-blocks";
import { createWorkflow, deleteWorkflow, getWorkflow } from "../db/automations";
import { addMcpServer, deleteMcpServer, getMcpServer, listMcpServers } from "../db/mcp";
import { resolveLaunch, INSTALL_MCP_SOURCES, type InstallSource } from "../tools/install-mcp";

export type InstallReceipt = {
  plugin_id: string;
  plugin_type: string;
  name: string;
  artefacts: Array<{ kind: string; ref: string }>;
};

/**
 * Install a plugin from a registry entry. Returns the install receipt so the
 * caller can show the user what was created. Idempotent on (name, type) —
 * if the same plugin is already installed, the call no-ops and returns the
 * existing record.
 *
 * Only pure-JSON plugin types (workflow-template, system-prompt-template) are
 * handled here. MCP server installs go through the existing MCP settings flow
 * for now; the marketplace UI surfaces them but routes the user to that page.
 */
type McpLaunchPayload = {
  source: InstallSource;
  package?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  default_tool_tier?: "allow" | "ask" | "pin";
};

export async function installPlugin(reg: RegistryPlugin): Promise<{ ok: boolean; receipt?: InstallReceipt; reason?: string }> {
  if (reg.plugin_type === "mcp-server") {
    // Plugin marketplace MCP installs reuse the same launch-line builder
    // as Sora's `install_mcp_server` tool — same security floor (this is
    // already gated as `install_mcp` in the destructive list), same
    // allowlist semantics. No new sandbox needed because every MCP server
    // already runs as a separate stdio child process whose outbound
    // traffic is routed through the per-server domain allowlist proxy.
    const payload = (reg.payload as McpLaunchPayload | undefined) || undefined;
    if (!payload || !payload.source || !INSTALL_MCP_SOURCES.includes(payload.source)) {
      return {
        ok: false,
        reason:
          "This MCP server entry is missing launch metadata. Install it from the MCP Servers page → Add server, and the marketplace will pick up the connection on its next refresh.",
      };
    }
    const resolved = resolveLaunch({
      source: payload.source,
      package: payload.package,
      command: payload.command,
      args: payload.args,
    });
    if (!resolved.ok) {
      return { ok: false, reason: resolved.error };
    }
    const dupe = listMcpServers().find(
      (s) => s.name === reg.name || (s.command || "") === resolved.launch.preview
    );
    if (dupe) {
      return {
        ok: false,
        reason: `An MCP server with this ${dupe.name === reg.name ? "name" : "launch command"} is already registered. Disable or remove it first if you want to replace it.`,
      };
    }
    const server = addMcpServer({
      name: reg.name,
      url: resolved.launch.preview,
      description: reg.description,
      tier: payload.default_tool_tier || "ask",
      transport: resolved.launch.transport,
      source: payload.source,
      command: resolved.launch.preview,
      env: payload.env,
      allowlist: reg.network_domains || [],
    });
    const record = recordInstall({
      plugin_type: reg.plugin_type,
      name: reg.name,
      version: reg.version,
      source_url: reg.source_url ?? null,
      config: { registry_id: reg.id, artefacts: [{ kind: "mcp-server", ref: server.id }] },
    });
    return {
      ok: true,
      receipt: {
        plugin_id: record.plugin_id,
        plugin_type: record.plugin_type,
        name: record.name,
        artefacts: [{ kind: "mcp-server", ref: server.id }],
      },
    };
  }
  if (reg.plugin_type === "knowledge-dataset" || reg.plugin_type === "agent-config") {
    return {
      ok: false,
      reason: `Plugin type "${reg.plugin_type}" install lands in a follow-up — its payload format is still being finalised.`,
    };
  }

  const existing = findInstalledByName(reg.name, reg.plugin_type);
  if (existing) {
    return {
      ok: false,
      reason: `"${reg.name}" is already installed. Use Update to bump to ${reg.version}.`,
    };
  }

  const artefacts: InstallReceipt["artefacts"] = [];

  if (reg.plugin_type === "workflow-template") {
    const payload = reg.payload as { name: string; trigger_type?: string; trigger_config?: unknown; steps?: unknown[] } | undefined;
    if (!payload || !Array.isArray(payload.steps)) {
      return { ok: false, reason: "Workflow template payload is missing or malformed." };
    }
    const wf = createWorkflow({
      name: payload.name || reg.name,
      trigger_type: payload.trigger_type || "manual",
      trigger_config: payload.trigger_config ?? {},
      steps: payload.steps,
    });
    artefacts.push({ kind: "workflow", ref: wf.id });
  }

  if (reg.plugin_type === "system-prompt-template") {
    const payload = reg.payload as
      | { persona: { name: string; description?: string }; blocks: Array<{ block_type: string; block_name: string; content?: string; condition_json?: string | null }> }
      | undefined;
    if (!payload || !payload.persona?.name || !Array.isArray(payload.blocks)) {
      return { ok: false, reason: "System prompt template payload is missing or malformed." };
    }
    const persona = createPersona({
      name: payload.persona.name,
      description: payload.persona.description ?? null,
    });
    // Seed the standard built-in slots first, then append the custom blocks
    // — replaceBlocks already restores missing built-ins, so we just pass the
    // customs and let it fill in the rest.
    const seeded = BUILTIN_BLOCK_NAMES.map((name, i) => ({
      block_type: "builtin" as const,
      block_name: name,
      content: "",
      enabled: true,
      sort_order: i,
    }));
    const customs = payload.blocks
      .filter((b) => b.block_type === "custom-static" || b.block_type === "custom-conditional")
      .map((b, i) => ({
        block_type: b.block_type as "custom-static" | "custom-conditional",
        block_name: b.block_name,
        content: b.content ?? "",
        enabled: true,
        sort_order: seeded.length + i,
        condition_json: b.condition_json ?? null,
      }));
    replaceBlocks(persona.persona_id, [...seeded, ...customs]);
    artefacts.push({ kind: "persona", ref: persona.persona_id });
  }

  const record = recordInstall({
    plugin_type: reg.plugin_type,
    name: reg.name,
    version: reg.version,
    source_url: reg.source_url ?? null,
    config: { registry_id: reg.id, artefacts },
  });

  return {
    ok: true,
    receipt: {
      plugin_id: record.plugin_id,
      plugin_type: record.plugin_type,
      name: record.name,
      artefacts,
    },
  };
}

/**
 * Uninstall a plugin and remove the things it created. Built-in personas are
 * never deleted regardless of what the receipt claims.
 */
export function uninstallPlugin(pluginId: string): { ok: boolean; reason?: string } {
  const installed = getInstalled(pluginId);
  if (!installed) return { ok: false, reason: "Plugin not found." };

  try {
    const cfg = JSON.parse(installed.config_json) as { artefacts?: Array<{ kind: string; ref: string }> };
    for (const a of cfg.artefacts || []) {
      if (a.kind === "workflow" && getWorkflow(a.ref)) {
        deleteWorkflow(a.ref);
      }
      if (a.kind === "persona" && getPersona(a.ref)) {
        deletePersona(a.ref);
      }
      if (a.kind === "mcp-server") {
        // deleteMcpServer refuses on builtins (throws); ignore that case
        // — a builtin can't have been installed via the marketplace anyway,
        // so this only happens on a corrupt receipt.
        const row = getMcpServer(a.ref);
        if (row && !row.builtin) {
          try { deleteMcpServer(a.ref); } catch {}
        }
      }
    }
  } catch {
    // Best-effort cleanup — proceed to remove the plugin record anyway.
  }

  dbUninstall(pluginId);
  return { ok: true };
}

/**
 * Update a plugin in place. For pure-JSON types we uninstall + reinstall and
 * preserve the receipt's plugin_id so the marketplace UI doesn't blink.
 */
export async function updatePlugin(pluginId: string, reg: RegistryPlugin): Promise<{ ok: boolean; reason?: string }> {
  const installed = getInstalled(pluginId);
  if (!installed) return { ok: false, reason: "Plugin not found." };
  if (installed.name !== reg.name || installed.plugin_type !== reg.plugin_type) {
    return { ok: false, reason: "Registry entry does not match the installed plugin." };
  }
  const un = uninstallPlugin(pluginId);
  if (!un.ok) return un;
  const ins = await installPlugin(reg);
  if (!ins.ok) return ins;
  // Carry over version metadata on the freshly recorded plugin row — the
  // new install picked the latest registry version automatically.
  if (ins.receipt) {
    setVersion(ins.receipt.plugin_id, reg.version);
    updateConfig(ins.receipt.plugin_id, { registry_id: reg.id, artefacts: ins.receipt.artefacts });
  }
  return { ok: true };
}
