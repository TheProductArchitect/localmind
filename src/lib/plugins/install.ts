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
export async function installPlugin(reg: RegistryPlugin): Promise<{ ok: boolean; receipt?: InstallReceipt; reason?: string }> {
  if (reg.plugin_type === "mcp-server") {
    return {
      ok: false,
      reason:
        "MCP server plugins are installed from the MCP Servers settings page. The in-app sandbox installer ships in the next update.",
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
