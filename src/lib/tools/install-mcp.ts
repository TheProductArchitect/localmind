/**
 * install_mcp_server — Sora's interface for adding a new MCP server.
 *
 * What this lets her do
 * ----------------------
 * When a user asks "install the GitHub MCP" or "give yourself a calendar
 * MCP", Sora calls this tool with a package identifier + source. The tool
 * registers the launch command in the local MCP database; the server is
 * picked up on the next connection sweep.
 *
 * Supported sources (the four ways most MCP servers are distributed):
 *
 *   - "npm"     → command = "npx -y <package>"          (Node ecosystem)
 *   - "pipx"    → command = "pipx run <package>"        (Python, persistent isolated venv)
 *   - "uvx"     → command = "uvx <package>"             (Python, fast ephemeral)
 *   - "docker"  → command = "docker run --rm -i <image>" (containerised)
 *   - "manual"  → caller supplies the exact command + args (catch-all)
 *
 * Security contract
 * -----------------
 * - Action type is "install_mcp", which lives in the destructive floor in
 *   permission-guard.ts. That means EVERY install requires user confirmation
 *   — even in auto mode. The user has to vet the package name and source
 *   before the launch command is written.
 * - The tool never runs `npm install -g` / `pipx install` / similar with
 *   write side-effects by itself. It records the LAUNCH command (npx, pipx
 *   run, uvx, docker run) which the MCP host invokes at server-start time.
 *   First-run package fetch happens transparently in those tools' sandboxes.
 *   This keeps the audit trail "Sora registered X" rather than "Sora wrote
 *   to global node_modules", which the user can review later.
 * - Names are validated against a conservative regex (npm/PyPI/docker style).
 * - The tool stores its registration in mcp_servers with source field set so
 *   the UI knows where each entry came from.
 *
 * What we DON'T do here
 * ---------------------
 * - We don't run the install eagerly. The user controls when servers start.
 * - We don't fetch metadata from npm/PyPI registries to "verify" the package.
 *   That would require outbound network from the install path; instead we
 *   trust the user's confirmation step to be the verification.
 * - We don't connect-and-discover-tools synchronously; the existing MCP
 *   server-connect pipeline does that on next sweep.
 */

import { addMcpServer, listMcpServers, type Transport } from "../db/mcp";
import type { Tool } from "./types";

export const INSTALL_MCP_SOURCES = ["npm", "pipx", "uvx", "docker", "manual"] as const;
export type InstallSource = (typeof INSTALL_MCP_SOURCES)[number];

// Allow alphanumerics, dashes, underscores, dots, slashes (for scoped npm
// pkgs + docker image paths), and colons (for docker tags). Refuse anything
// shell-meaningful so the package string can never be misread as a flag.
const SAFE_PACKAGE_RE = /^[A-Za-z0-9_.\-/@:]+$/;

export type ResolvedLaunch = {
  command: string;
  args: string[];
  transport: Transport;
  /** Human-readable summary of the launch line for audit/UI. */
  preview: string;
};

/**
 * Build the launch command for a given source + package. Pure function so
 * unit tests can pin every case without touching the DB.
 */
export function resolveLaunch(input: {
  source: InstallSource;
  package?: string;
  command?: string;
  args?: string[];
}): { ok: true; launch: ResolvedLaunch } | { ok: false; error: string } {
  if (!INSTALL_MCP_SOURCES.includes(input.source)) {
    return { ok: false, error: `Unknown source: ${input.source}` };
  }
  if (input.source !== "manual") {
    if (!input.package || !input.package.trim()) {
      return { ok: false, error: `package is required when source='${input.source}'` };
    }
    if (!SAFE_PACKAGE_RE.test(input.package.trim())) {
      return {
        ok: false,
        error: `Package name '${input.package}' contains characters not allowed in a launch identifier. Use letters, digits, '-_./@:' only.`,
      };
    }
  }
  const pkg = (input.package ?? "").trim();
  switch (input.source) {
    case "npm":
      return {
        ok: true,
        launch: {
          command: "npx",
          args: ["-y", pkg],
          transport: "stdio",
          preview: `npx -y ${pkg}`,
        },
      };
    case "pipx":
      return {
        ok: true,
        launch: {
          command: "pipx",
          args: ["run", pkg],
          transport: "stdio",
          preview: `pipx run ${pkg}`,
        },
      };
    case "uvx":
      return {
        ok: true,
        launch: {
          command: "uvx",
          args: [pkg],
          transport: "stdio",
          preview: `uvx ${pkg}`,
        },
      };
    case "docker":
      return {
        ok: true,
        launch: {
          command: "docker",
          args: ["run", "--rm", "-i", pkg],
          transport: "stdio",
          preview: `docker run --rm -i ${pkg}`,
        },
      };
    case "manual": {
      if (!input.command || !input.command.trim()) {
        return { ok: false, error: "command is required when source='manual'" };
      }
      const args = Array.isArray(input.args) ? input.args.map(String) : [];
      // Manual command goes in as-is. The user confirmed it; we don't
      // second-guess. Still refuse shell metacharacters in the command path
      // itself — the args are passed without shell, so they're safe.
      if (!/^[A-Za-z0-9_./\\-]+$/.test(input.command.trim())) {
        return {
          ok: false,
          error: `Manual command '${input.command}' has shell-meaningful characters. Use a plain executable path.`,
        };
      }
      return {
        ok: true,
        launch: {
          command: input.command.trim(),
          args,
          transport: "stdio",
          preview: `${input.command} ${args.join(" ")}`.trim(),
        },
      };
    }
  }
}

function deriveDisplayName(input: { name?: string; source: InstallSource; package?: string; command?: string }): string {
  if (input.name && input.name.trim()) return input.name.trim();
  if (input.package) {
    // Strip scope/prefix so "@modelcontextprotocol/server-github" → "server-github".
    const last = input.package.split("/").pop() || input.package;
    return last;
  }
  if (input.command) return input.command;
  return `mcp-${input.source}`;
}

export const installMcpServerTool: Tool = {
  // Always destructive: even in auto mode, the user MUST confirm. The floor
  // in permission-guard.ts owns the enforcement; we just declare the type.
  actionType: "install_mcp",
  classify: () => "install_mcp",
  preview: (input) => {
    const src = String(input.source ?? "?");
    const pkg = String(input.package ?? input.command ?? "?");
    const name = String(input.name ?? "");
    return name
      ? `Install MCP server '${name}' via ${src}: ${pkg}`
      : `Install MCP server via ${src}: ${pkg}`;
  },
  version: "1",
  cacheable: () => false,
  definition: {
    name: "install_mcp_server",
    description:
      "Register an MCP server so its tools become available on the next connection sweep. Sources: npm, pipx, uvx, docker, or manual (caller supplies command + args). Requires user confirmation every time — even in auto mode.",
    parameters: {
      type: "object",
      properties: {
        source: {
          type: "string",
          enum: [...INSTALL_MCP_SOURCES],
          description:
            "Install style. npm/pipx/uvx/docker each map to a standard launch command; 'manual' takes a raw command + args.",
        },
        package: {
          type: "string",
          description:
            "Package name (npm/pipx/uvx) or image tag (docker). Omit when source='manual'.",
        },
        name: {
          type: "string",
          description:
            "Display label the user will see for this server in the MCP page. Defaults to the package's last segment if omitted.",
        },
        description: {
          type: "string",
          description: "One-line summary of what the server does (shown next to its name).",
        },
        env: {
          type: "object",
          additionalProperties: { type: "string" },
          description:
            "Env vars the server needs (API keys, etc.). Stored encrypted.",
        },
        command: {
          type: "string",
          description: "Required when source='manual'. The exact executable to run.",
        },
        args: {
          type: "array",
          items: { type: "string" },
          description: "Optional args for source='manual'. Ignored for other sources.",
        },
        default_tool_tier: {
          type: "string",
          enum: ["allow", "ask", "pin"],
          description:
            "Default tier for the server's child tools. Defaults to 'ask'.",
        },
      },
      required: ["source"],
    },
  },
  async execute(input) {
    const resolved = resolveLaunch({
      source: input.source as InstallSource,
      package: typeof input.package === "string" ? input.package : undefined,
      command: typeof input.command === "string" ? input.command : undefined,
      args: Array.isArray(input.args) ? (input.args as string[]) : undefined,
    });
    if (!resolved.ok) {
      return { ok: false, output: resolved.error };
    }

    const name = deriveDisplayName({
      name: typeof input.name === "string" ? input.name : undefined,
      source: input.source as InstallSource,
      package: typeof input.package === "string" ? input.package : undefined,
      command: typeof input.command === "string" ? input.command : undefined,
    });

    // Refuse duplicates by display name OR by command — same launch line
    // registered twice produces two parallel processes with overlapping
    // tools, which is almost never what the user wanted.
    const existing = listMcpServers().find(
      (s) => s.name === name || (s.command || "") === resolved.launch.preview
    );
    if (existing) {
      return {
        ok: false,
        output: `An MCP server with this ${existing.name === name ? "name" : "launch command"} is already registered (id=${existing.id}). Disable or remove it first if you want to replace it.`,
      };
    }

    const env =
      input.env && typeof input.env === "object" && !Array.isArray(input.env)
        ? (input.env as Record<string, string>)
        : undefined;
    const tier =
      typeof input.default_tool_tier === "string" &&
      ["allow", "ask", "pin"].includes(input.default_tool_tier)
        ? (input.default_tool_tier as string)
        : "ask";

    // For stdio servers the `url` column holds the launch preview — it's the
    // human-readable surface in the MCP page. `command` holds the same thing
    // (with args joined) for the actual spawn.
    const server = addMcpServer({
      name,
      url: resolved.launch.preview,
      description:
        typeof input.description === "string" ? input.description : `Installed via ${input.source}`,
      tier,
      transport: resolved.launch.transport,
      source: String(input.source),
      command: resolved.launch.preview,
      env,
      allowlist: [],
    });

    return {
      ok: true,
      output: JSON.stringify(
        {
          server_id: server.id,
          name: server.name,
          launch: resolved.launch.preview,
          transport: resolved.launch.transport,
          note: "Server registered. It will appear in the MCP page and connect on the next sweep. Tools will be discovered with the configured default tier.",
        },
        null,
        2
      ),
      summary: `Registered MCP server '${name}' (${resolved.launch.preview})`,
    };
  },
};
