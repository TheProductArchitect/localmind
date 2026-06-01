/**
 * Plugin marketplace registry.
 *
 * Source of truth is a public JSON file on GitHub (configurable via the
 * LOCALMIND_PLUGIN_REGISTRY env var). The fetched copy is cached in memory
 * for 5 minutes and persisted to ~/.localmind/plugin-registry-cache.json
 * so the marketplace stays browsable offline.
 *
 * Until the published registry exists we ship a small built-in catalogue
 * below — enough to exercise install/uninstall and show the UX shape.
 */

import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import os from "os";
import type { PluginType } from "../db/plugins";

export type RegistryPlugin = {
  id: string;                  // stable id within the registry
  plugin_type: PluginType;
  name: string;
  author: string;
  version: string;
  description: string;
  install_size_kb?: number;
  source_url?: string;
  permissions?: string[];      // human-readable list shown before install
  network_domains?: string[];  // for MCP servers
  payload?: unknown;           // inline payload for pure-JSON plugin types
};

export type Registry = {
  fetched_at: number;
  plugins: RegistryPlugin[];
  source: "remote" | "builtin" | "cache";
};

const CACHE_PATH = path.join(
  process.env.LOCALMIND_DATA_DIR || path.join(os.homedir(), ".localmind"),
  "plugin-registry-cache.json"
);
const CACHE_TTL_MS = 5 * 60 * 1000;
const REGISTRY_URL =
  process.env.LOCALMIND_PLUGIN_REGISTRY ||
  "https://raw.githubusercontent.com/localmind/plugin-registry/main/registry.json";

const BUILTIN: RegistryPlugin[] = [
  {
    id: "wf-daily-briefing",
    plugin_type: "workflow-template",
    name: "Daily Briefing",
    author: "LocalMind",
    version: "1.0.0",
    description:
      "Generates a morning briefing from your calendar, recent emails, and any pinned knowledge notes. Suitable as a scheduled task or proactive notification.",
    permissions: ["read_calendar", "read_email", "memory_read"],
    payload: {
      name: "Daily Briefing",
      trigger_type: "manual",
      trigger_config: {},
      steps: [
        { type: "agent", prompt: "List today's calendar events with their times in one short bullet list." },
        { type: "agent", prompt: "Summarise unread emails from the last 24 hours in one short paragraph." },
        { type: "agent", prompt: "Combine the calendar and email outputs into a friendly morning briefing under 200 words." },
      ],
    },
  },
  {
    id: "wf-github-release-notes",
    plugin_type: "workflow-template",
    name: "GitHub Release Notes",
    author: "LocalMind",
    version: "1.0.0",
    description: "Drafts release notes from recent commits on a GitHub repository you point it at.",
    permissions: ["web_search"],
    payload: {
      name: "GitHub Release Notes",
      trigger_type: "manual",
      trigger_config: {},
      steps: [
        { type: "agent", prompt: "Fetch the last 30 commits from the user-supplied repo and group them by type (feat/fix/chore/docs)." },
        { type: "agent", prompt: "Draft 1-2 paragraph release notes with grouped bullet points underneath." },
      ],
    },
  },
  {
    id: "spt-legal-research",
    plugin_type: "system-prompt-template",
    name: "Legal Research Assistant",
    author: "LocalMind",
    version: "1.0.0",
    description:
      "A persona tuned for legal research — precise quotations, source citations, neutral tone, and an emphasis on jurisdiction-aware caveats.",
    permissions: ["web_search", "memory_write"],
    payload: {
      persona: {
        name: "Legal Research",
        description: "Precise, citation-first research assistant for legal topics.",
      },
      blocks: [
        {
          block_type: "custom-static",
          block_name: "Citation rules",
          content:
            "When citing law, always include jurisdiction, statute name, section, and (if known) effective date. Never paraphrase a binding rule without quoting the original text in the same answer. If the source is uncertain, say so explicitly and propose what would resolve the uncertainty.",
        },
        {
          block_type: "custom-static",
          block_name: "Tone",
          content:
            "Stay neutral. Avoid advocacy. Distinguish facts, interpretations, and personal opinions in your output.",
        },
      ],
    },
  },
  {
    id: "spt-writing-coach",
    plugin_type: "system-prompt-template",
    name: "Creative Writing Coach",
    author: "LocalMind",
    version: "1.0.0",
    description: "A persona that gives detailed feedback on prose — line edits, structural notes, and craft observations.",
    permissions: [],
    payload: {
      persona: {
        name: "Writing Coach",
        description: "Patient creative-writing coach focused on craft, not output.",
      },
      blocks: [
        {
          block_type: "custom-static",
          block_name: "Feedback style",
          content:
            "When the user shares prose, respond in three sections: (1) what's working, (2) what to consider revising, (3) line-edit suggestions on at most 3 specific sentences. Ask before going line-by-line on long pieces.",
        },
      ],
    },
  },
  {
    id: "mcp-brave-search",
    plugin_type: "mcp-server",
    name: "Brave Search (MCP)",
    author: "community",
    version: "0.1.0",
    description:
      "Brave Search MCP server — privacy-respecting web search through Brave's API. Install via the MCP Servers settings page; coming soon to the in-app installer.",
    permissions: ["web_search"],
    network_domains: ["api.search.brave.com"],
    install_size_kb: 0,
  },
];

let memCache: Registry | null = null;

async function readCacheFile(): Promise<Registry | null> {
  try {
    if (!fsSync.existsSync(CACHE_PATH)) return null;
    const raw = await fs.readFile(CACHE_PATH, "utf8");
    return JSON.parse(raw) as Registry;
  } catch {
    return null;
  }
}

async function writeCacheFile(reg: Registry): Promise<void> {
  try {
    await fs.mkdir(path.dirname(CACHE_PATH), { recursive: true });
    await fs.writeFile(CACHE_PATH, JSON.stringify(reg, null, 2), "utf8");
  } catch {
    /* non-fatal */
  }
}

export async function getRegistry(opts: { refresh?: boolean } = {}): Promise<Registry> {
  if (memCache && !opts.refresh && Date.now() - memCache.fetched_at < CACHE_TTL_MS) {
    return memCache;
  }

  // Try remote first.
  try {
    const r = await fetch(REGISTRY_URL, {
      signal: AbortSignal.timeout(5000),
      headers: { Accept: "application/json" },
    });
    if (r.ok) {
      const j = (await r.json()) as { plugins: RegistryPlugin[] };
      if (Array.isArray(j.plugins)) {
        const reg: Registry = { fetched_at: Date.now(), plugins: j.plugins, source: "remote" };
        memCache = reg;
        void writeCacheFile(reg);
        return reg;
      }
    }
  } catch {
    /* fall through to cache / builtin */
  }

  const cached = await readCacheFile();
  if (cached && cached.plugins.length > 0) {
    cached.source = "cache";
    memCache = cached;
    return cached;
  }

  const fallback: Registry = { fetched_at: Date.now(), plugins: BUILTIN, source: "builtin" };
  memCache = fallback;
  return fallback;
}

export function findRegistryPlugin(reg: Registry, id: string): RegistryPlugin | null {
  return reg.plugins.find((p) => p.id === id) || null;
}
