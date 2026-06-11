import { describe, it, expect, vi, beforeEach } from "vitest";

const servers: any[] = [];

vi.mock("../src/lib/db/mcp", () => ({
  listMcpServers: vi.fn(() => servers),
  addMcpServer: vi.fn((opts: any) => {
    const row = {
      id: `mcp-${servers.length + 1}`,
      enabled: 1,
      created_at: Date.now(),
      env_encrypted: null,
      last_connected_at: null,
      allowlist: "[]",
      description: opts.description ?? null,
      tier: opts.tier ?? "ask",
      transport: opts.transport ?? "stdio",
      source: opts.source ?? "manual",
      command: opts.command ?? null,
      ...opts,
    };
    servers.push(row);
    return row;
  }),
}));

import { resolveLaunch, installMcpServerTool, INSTALL_MCP_SOURCES } from "../src/lib/tools/install-mcp";

const ctx = { conversationId: "c1", approvedDirs: [] };

describe("install_mcp_server", () => {
  beforeEach(() => {
    servers.length = 0;
  });

  describe("destructive contract", () => {
    it("declares install_mcp as its action type so the floor in permission-guard catches it", () => {
      expect(installMcpServerTool.actionType).toBe("install_mcp");
      expect(installMcpServerTool.classify?.({})).toBe("install_mcp");
    });
  });

  describe("resolveLaunch — launch command shape per source", () => {
    it("npm → npx -y <package> (stdio)", () => {
      const r = resolveLaunch({ source: "npm", package: "@modelcontextprotocol/server-github" });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.launch.command).toBe("npx");
        expect(r.launch.args).toEqual(["-y", "@modelcontextprotocol/server-github"]);
        expect(r.launch.transport).toBe("stdio");
        expect(r.launch.preview).toBe("npx -y @modelcontextprotocol/server-github");
      }
    });

    it("pipx → pipx run <package>", () => {
      const r = resolveLaunch({ source: "pipx", package: "mcp-server-fetch" });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.launch.args).toEqual(["run", "mcp-server-fetch"]);
    });

    it("uvx → uvx <package>", () => {
      const r = resolveLaunch({ source: "uvx", package: "mcp-server-time" });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.launch.command).toBe("uvx");
    });

    it("docker → docker run --rm -i <image>", () => {
      const r = resolveLaunch({ source: "docker", package: "ghcr.io/mcp/foo:latest" });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.launch.args).toEqual(["run", "--rm", "-i", "ghcr.io/mcp/foo:latest"]);
      }
    });

    it("manual → caller-supplied command + args", () => {
      const r = resolveLaunch({ source: "manual", command: "/usr/local/bin/my-mcp", args: ["--stdio"] });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.launch.command).toBe("/usr/local/bin/my-mcp");
        expect(r.launch.args).toEqual(["--stdio"]);
      }
    });
  });

  describe("input validation — defence against shell injection", () => {
    it("rejects shell metacharacters in package names", () => {
      const cases = [
        "foo; rm -rf /",
        "foo && curl evil",
        "foo|cat",
        "foo`whoami`",
        "foo$(id)",
        "foo > /etc/passwd",
      ];
      for (const pkg of cases) {
        const r = resolveLaunch({ source: "npm", package: pkg });
        expect(r.ok, `should reject ${pkg}`).toBe(false);
      }
    });

    it("rejects manual command with shell metacharacters", () => {
      const r = resolveLaunch({ source: "manual", command: "rm -rf /; bash" });
      expect(r.ok).toBe(false);
    });

    it("requires package for non-manual sources", () => {
      for (const src of INSTALL_MCP_SOURCES) {
        if (src === "manual") continue;
        const r = resolveLaunch({ source: src });
        expect(r.ok, `${src} should require package`).toBe(false);
      }
    });

    it("requires command for manual source", () => {
      const r = resolveLaunch({ source: "manual" });
      expect(r.ok).toBe(false);
    });

    it("accepts legitimate scoped npm packages", () => {
      expect(resolveLaunch({ source: "npm", package: "@modelcontextprotocol/server-everything" }).ok).toBe(true);
      expect(resolveLaunch({ source: "npm", package: "@org/pkg.with.dots-and-dashes" }).ok).toBe(true);
    });

    it("accepts docker image refs with registries and tags", () => {
      expect(resolveLaunch({ source: "docker", package: "ghcr.io/org/img:v1.2.3" }).ok).toBe(true);
    });
  });

  describe("execute — duplicate detection", () => {
    it("registers a server when none matches", async () => {
      const result = await installMcpServerTool.execute(
        { source: "npm", package: "@mcp/foo", name: "Foo MCP" },
        ctx
      );
      expect(result.ok).toBe(true);
      expect(servers).toHaveLength(1);
      expect(servers[0].name).toBe("Foo MCP");
    });

    it("refuses to re-register the same launch command", async () => {
      await installMcpServerTool.execute(
        { source: "npm", package: "@mcp/foo", name: "First" },
        ctx
      );
      const second = await installMcpServerTool.execute(
        { source: "npm", package: "@mcp/foo", name: "Second" },
        ctx
      );
      expect(second.ok).toBe(false);
      expect(second.output).toMatch(/already registered/i);
      expect(servers).toHaveLength(1);
    });

    it("refuses to re-register the same display name", async () => {
      await installMcpServerTool.execute(
        { source: "npm", package: "@mcp/foo", name: "Reused name" },
        ctx
      );
      const second = await installMcpServerTool.execute(
        { source: "uvx", package: "different-pkg", name: "Reused name" },
        ctx
      );
      expect(second.ok).toBe(false);
      expect(servers).toHaveLength(1);
    });

    it("derives a display name from the package's last segment when none given", async () => {
      await installMcpServerTool.execute(
        { source: "npm", package: "@modelcontextprotocol/server-github" },
        ctx
      );
      expect(servers[0].name).toBe("server-github");
    });
  });
});
