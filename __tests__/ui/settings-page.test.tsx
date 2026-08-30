import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  nextNavigationMock,
  setRoute,
  mockFetch,
  installBrowserShims,
  routerMock,
} from "../helpers/ui";

vi.mock("next/navigation", () => nextNavigationMock());
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    [k: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/orb", () => ({
  Orb: () => <span data-testid="orb" />,
}));
vi.mock("@/components/branding-sync", () => ({
  notifyAssistantName: vi.fn(),
}));

import SettingsPage from "@/app/settings/page";
import { SettingsSidebar } from "@/components/settings-sidebar";
import { ConfirmProvider } from "@/components/confirm-dialog";
import { Toaster } from "@/components/toast";

const NOW_SAFE = 1_700_000_000_000;

const SETTINGS = {
  assistant_name: "Sora",
  personality: "Friendly",
  theme: "dark",
  chat_font_size: 17,
  context_window: 0,
  code_server_enabled: 0,
  code_server_url: "http://127.0.0.1:8080",
  approved_dirs: '["/home/me/Documents"]',
  pin_set: false,
  agent_mode: "auto",
  lan_enabled: 0,
  port: 3001,
  https_enabled: 0,
  web_access_killed: 0,
};

function alwaysOn(installed = false) {
  return {
    installed,
    plan: {
      platform: "linux" as const,
      service_path: "/etc/systemd/user/localmind.service",
      activate_commands: ["systemctl --user enable --now localmind"],
      deactivate_commands: ["systemctl --user disable --now localmind"],
    },
  };
}

function baseRoutes(extra: Parameters<typeof mockFetch>[0] = []) {
  // More-specific /api/settings/* routes must win over /api/settings.
  return mockFetch([
    ...extra,
    { match: /\/api\/settings$/, body: { settings: SETTINGS } },
    { match: "/api/memory", body: { memory: [{ id: "m1", key: "city", value: "London" }] } },
    { match: "/api/system/always-on", body: alwaysOn(false) },
    { match: "/api/system/health", body: { ok: true } },
    { match: "/api/web-guard/grants", body: { grants: [] } },
  ]);
}

function renderSettings() {
  return render(
    <ConfirmProvider>
      <Toaster />
      <SettingsPage />
    </ConfirmProvider>
  );
}

async function go(section: string) {
  setRoute("/settings", `section=${encodeURIComponent(section)}`);
  renderSettings();
}

describe("settings page", () => {
  beforeEach(() => {
    installBrowserShims();
    setRoute("/settings", "section=General");
    routerMock.push.mockClear();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /* ---------- section navigation ---------- */

  it("defaults to General and switches section from the sidebar URL", async () => {
    baseRoutes();
    setRoute("/settings");
    render(
      <ConfirmProvider>
        <Toaster />
        <SettingsSidebar />
        <SettingsPage />
      </ConfirmProvider>
    );
    await waitFor(() => expect(screen.getByText("How Sora behaves")).toBeInTheDocument());

    const nav = screen.getByRole("navigation", { name: "In-page sections" });
    expect(within(nav).getByRole("link", { name: /General/ })).toHaveAttribute(
      "href",
      "/settings?section=General"
    );
    expect(within(nav).getByRole("link", { name: /Reach/ })).toHaveAttribute(
      "href",
      "/settings?section=Reach"
    );
    expect(within(nav).getByRole("link", { name: /Network/ })).toHaveAttribute(
      "href",
      "/settings?section=Network"
    );
    expect(within(nav).getByRole("link", { name: /Providers/ })).toHaveAttribute(
      "href",
      "/settings?section=Providers"
    );
    expect(within(nav).getByRole("link", { name: /Communications/ })).toHaveAttribute(
      "href",
      "/settings?section=Communications"
    );
    expect(within(nav).getByRole("link", { name: /Integrations/ })).toHaveAttribute(
      "href",
      "/settings?section=Integrations"
    );
    expect(within(nav).getByRole("link", { name: /Data & Privacy/ })).toHaveAttribute(
      "href",
      "/settings?section=Data%20%26%20Privacy"
    );
    expect(within(nav).getByRole("link", { name: /Backup/ })).toHaveAttribute(
      "href",
      "/settings?section=Backup"
    );
  });

  it.each([
    ["General", "How Sora behaves"],
    ["Reach", "What Sora can reach"],
    ["Tools", "What Sora is allowed to do"],
    ["Network", "Where Sora can be reached"],
    ["Providers", "External model providers"],
    ["Communications", "Channels and notifications"],
    ["Integrations", "Open source you're standing on"],
    ["Data & Privacy", "Your data, your rules"],
    ["Backup", "Save and restore"],
  ] as const)("renders %s from ?section=", async (section, title) => {
    const extras: Parameters<typeof mockFetch>[0] = [];
    if (section === "Integrations") {
      extras.push({
        match: "/api/integrations",
        body: {
          system: [],
          npm: [],
          summary: {
            total: 0,
            detected: 0,
            outdated_count: 0,
            checked_for_updates: false,
            checked_at: null,
          },
        },
      });
    }
    if (section === "Providers") {
      extras.push({ match: "/api/providers", body: { providers: [] } });
    }
    if (section === "Communications" || section === "Reach") {
      extras.push(
        { match: "/api/channels?type=telegram", body: { enabled: false, config: {} } },
        { match: "/api/channels?type=twilio", body: { enabled: false, config: {} } },
        { match: "/api/channels?type=whatsapp", body: { enabled: false, config: {} } },
        { match: "/api/channels?type=unipile", body: { enabled: false, config: {} } }
      );
    }
    if (section === "Tools" || section === "Reach") {
      extras.push(
        { match: "/api/tools", body: { tools: [] } },
        { match: "/api/permissions", body: { profiles: [], active: null } },
        { match: "/api/mcp/servers", body: { servers: [] } }
      );
    }
    if (section === "Backup") {
      extras.push({ match: "/api/backup", body: { snapshots: [] } });
    }
    baseRoutes(extras);
    await go(section);
    await waitFor(() => expect(screen.getByText(title)).toBeInTheDocument());
  });

  /* ---------- General ---------- */

  it("saves agent mode tiles", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { calls } = baseRoutes();
    await go("General");
    await waitFor(() => expect(screen.getByText("Ask")).toBeInTheDocument());

    await user.click(screen.getByText("Ask"));
    await waitFor(() =>
      expect(
        calls.some((c) => c.url.includes("/api/settings") && c.init?.method === "PATCH")
      ).toBe(true)
    );
    expect(
      JSON.parse(String(calls.find((c) => c.init?.method === "PATCH")?.init?.body))
    ).toEqual({ agent_mode: "ask" });
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
  });

  it("saves assistant name, personality, theme, font size, and context window", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { calls } = baseRoutes();
    await go("General");
    await waitFor(() => expect(screen.getByLabelText(/Assistant name/)).toBeInTheDocument());

    const name = screen.getByLabelText(/Assistant name/);
    await user.clear(name);
    await user.type(name, "Nova");
    await user.tab();
    await waitFor(() =>
      expect(
        calls.some((c) => {
          if (c.init?.method !== "PATCH") return false;
          const b = JSON.parse(String(c.init.body));
          return b.assistant_name === "Nova";
        })
      ).toBe(true)
    );

    await user.selectOptions(screen.getByLabelText(/Personality/), "Concise");
    await waitFor(() =>
      expect(
        calls.some((c) => JSON.parse(String(c.init?.body || "{}")).personality === "Concise")
      ).toBe(true)
    );

    await user.selectOptions(screen.getByLabelText(/^Theme/), "light");
    await waitFor(() =>
      expect(
        calls.some((c) => JSON.parse(String(c.init?.body || "{}")).theme === "light")
      ).toBe(true)
    );

    const font = screen.getByLabelText(/App font size/);
    await user.clear(font);
    await user.type(font, "20");
    await user.tab();
    await waitFor(() =>
      expect(
        calls.some((c) => JSON.parse(String(c.init?.body || "{}")).chat_font_size === 20)
      ).toBe(true)
    );

    await user.selectOptions(screen.getByDisplayValue(/Auto \(based on model\)/), "32768");
    await waitFor(() =>
      expect(
        calls.some((c) => JSON.parse(String(c.init?.body || "{}")).context_window === 32768)
      ).toBe(true)
    );
  });

  it("keeps typed input when a save fails and shows an error toast", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { calls } = mockFetch([
      { match: /\/api\/settings$/, body: { settings: SETTINGS } },
      { match: "/api/memory", body: { memory: [] } },
      { match: "/api/system/always-on", body: alwaysOn() },
    ]);
    const inner = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : String(input);
      if (url.includes("/api/settings") && init?.method === "PATCH") {
        calls.push({ url, init });
        return {
          ok: false,
          status: 500,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({ error: "disk locked" }),
          text: async () => '{"error":"disk locked"}',
          body: null,
        } as unknown as Response;
      }
      return inner(input, init);
    }) as unknown as typeof fetch;

    await go("General");
    await waitFor(() => expect(screen.getByLabelText(/Assistant name/)).toBeInTheDocument());
    const name = screen.getByLabelText(/Assistant name/);
    await user.clear(name);
    await user.type(name, "KeepMe");
    await user.tab();
    await waitFor(() => expect(screen.getByText("disk locked")).toBeInTheDocument());
    expect(name).toHaveValue("KeepMe");
  });

  it("toggles code-server and saves URL and approved dirs", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { calls } = baseRoutes();
    await go("General");
    await waitFor(() => expect(screen.getByText(/code-server coding window/)).toBeInTheDocument());

    const codeCard = screen.getByText(/code-server coding window/).closest(".p-4")!;
    const codeToggle = within(codeCard as HTMLElement).getByRole("checkbox");
    await user.click(codeToggle);
    await waitFor(() =>
      expect(
        calls.some((c) => JSON.parse(String(c.init?.body || "{}")).code_server_enabled === 1)
      ).toBe(true)
    );

    const url = within(codeCard as HTMLElement).getByDisplayValue("http://127.0.0.1:8080");
    await user.clear(url);
    await user.type(url, "http://127.0.0.1:9090");
    await user.tab();
    await waitFor(() =>
      expect(
        calls.some((c) => JSON.parse(String(c.init?.body || "{}")).code_server_url === "http://127.0.0.1:9090")
      ).toBe(true)
    );

    const dirs = screen.getByDisplayValue("/home/me/Documents");
    await user.clear(dirs);
    await user.type(dirs, "/tmp/work, /home/me/code");
    await user.tab();
    await waitFor(() =>
      expect(
        calls.some((c) => {
          const b = JSON.parse(String(c.init?.body || "{}"));
          return Array.isArray(b.approved_dirs) && b.approved_dirs.includes("/tmp/work");
        })
      ).toBe(true)
    );
  });

  it("sets a PIN and forgets a memory fact", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { calls } = baseRoutes([
      { match: "/api/memory/m1", body: { ok: true } },
    ]);
    await go("General");
    await waitFor(() => expect(screen.getByText("city")).toBeInTheDocument());

    const pin = screen.getByPlaceholderText(/New 4\+ digit PIN/);
    await user.type(pin, "1234");
    await user.click(screen.getByRole("button", { name: "Set PIN" }));
    await waitFor(() =>
      expect(
        calls.some((c) => JSON.parse(String(c.init?.body || "{}")).pin === "1234")
      ).toBe(true)
    );

    await user.click(screen.getByRole("button", { name: "Forget" }));
    await waitFor(() =>
      expect(
        calls.some((c) => c.url.includes("/api/memory/m1") && c.init?.method === "DELETE")
      ).toBe(true)
    );
    expect(screen.queryByText("city")).not.toBeInTheDocument();
  });

  it("installs and removes the always-on service", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    let installed = false;
    const { calls } = mockFetch([
      { match: "/api/settings", body: { settings: SETTINGS } },
      { match: "/api/memory", body: { memory: [] } },
      {
        match: "/api/system/always-on",
        body: (init) => {
          if (init?.method === "POST") {
            installed = true;
            return { ok: true, ...alwaysOn(true) };
          }
          if (init?.method === "DELETE") {
            installed = false;
            return { ok: true };
          }
          return alwaysOn(installed);
        },
      },
    ]);
    await go("General");
    await waitFor(() => expect(screen.getByRole("button", { name: "Install" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Install" }));
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes("/always-on") && c.init?.method === "POST")).toBe(true)
    );
    await waitFor(() => expect(screen.getByText(/Service file written/)).toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes("/always-on") && c.init?.method === "DELETE")).toBe(true)
    );
  });

  it("shows the auth prompt and continues on localhost after logout", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    let authed = false;
    const { calls } = mockFetch([
      {
        match: "/api/settings",
        body: () => (authed ? { settings: SETTINGS } : { error: "Unauthorized" }),
        status: 401,
      },
      { match: "/api/auth/logout", body: { ok: true } },
      { match: "/api/memory", body: { memory: [] } },
      { match: "/api/system/always-on", body: alwaysOn() },
    ]);
    // First load 401 — but mockFetch status is fixed. Custom fetch:
    const inner = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : String(input);
      calls.push({ url, init });
      if (url.includes("/api/auth/logout")) {
        authed = true;
        return {
          ok: true, status: 200,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({ ok: true }), text: async () => "{}", body: null,
        } as unknown as Response;
      }
      if (url.includes("/api/settings") && !authed) {
        return {
          ok: false, status: 401,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({ error: "Unauthorized" }), text: async () => "{}", body: null,
        } as unknown as Response;
      }
      if (url.includes("/api/settings")) {
        return {
          ok: true, status: 200,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({ settings: SETTINGS }), text: async () => "{}", body: null,
        } as unknown as Response;
      }
      return inner(input, init);
    }) as unknown as typeof fetch;

    await go("General");
    await waitFor(() => expect(screen.getByText("Unauthorized")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue on localhost" }));
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes("/api/auth/logout") && c.init?.method === "POST")).toBe(true)
    );
    await waitFor(() => expect(screen.getByText("How Sora behaves")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText("Agent mode")).toBeInTheDocument());
  });

  /* ---------- Network ---------- */

  it("toggles LAN/HTTPS and saves the port", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { calls } = baseRoutes();
    await go("Network");
    await waitFor(() => expect(screen.getByText(/Local network access/)).toBeInTheDocument());

    const lan = screen.getByLabelText(/Local network access/);
    await user.click(lan);
    await waitFor(() =>
      expect(
        calls.some((c) => JSON.parse(String(c.init?.body || "{}")).lan_enabled === 1)
      ).toBe(true)
    );

    const https = screen.getByLabelText(/HTTPS/);
    await user.click(https);
    await waitFor(() =>
      expect(
        calls.some((c) => JSON.parse(String(c.init?.body || "{}")).https_enabled === 1)
      ).toBe(true)
    );

    const port = screen.getByLabelText(/Custom port/);
    await user.clear(port);
    await user.type(port, "9443");
    await user.tab();
    await waitFor(() =>
      expect(
        calls.some((c) => JSON.parse(String(c.init?.body || "{}")).port === 9443)
      ).toBe(true)
    );
  });

  /* ---------- Providers ---------- */

  it("saves, tests, and activates a provider API key", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { calls } = baseRoutes([
      {
        match: "/api/providers",
        body: (init) => {
          if (init?.method === "POST") return { ok: true };
          return {
            providers: [
              { name: "ollama", connected: true },
              { name: "openai", connected: false },
              { name: "mindstudio", connected: false },
            ],
          };
        },
      },
    ]);
    await go("Providers");
    await waitFor(() => expect(screen.getByText("openai")).toBeInTheDocument());
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.getByText("Cloud — opt-in")).toBeInTheDocument();

    const openaiCard = screen.getByText("openai").closest(".p-4")!;
    const key = within(openaiCard as HTMLElement).getByPlaceholderText("API key");
    await user.type(key, "sk-test");
    await user.click(within(openaiCard as HTMLElement).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(
        calls.some((c) => {
          if (!c.url.includes("/api/providers") || c.init?.method !== "POST") return false;
          const b = JSON.parse(String(c.init.body));
          return b.provider === "openai" && b.action === "save" && b.key === "sk-test";
        })
      ).toBe(true)
    );

    await user.click(within(openaiCard as HTMLElement).getByRole("button", { name: "Test" }));
    await waitFor(() =>
      expect(
        calls.some((c) => {
          if (c.init?.method !== "POST") return false;
          const b = JSON.parse(String(c.init.body || "{}"));
          return b.action === "test" && b.provider === "openai";
        })
      ).toBe(true)
    );

    await user.click(within(openaiCard as HTMLElement).getByRole("button", { name: "Set as active" }));
    await waitFor(() =>
      expect(
        calls.some((c) => {
          if (!c.url.includes("/api/settings") || c.init?.method !== "PATCH") return false;
          return JSON.parse(String(c.init.body)).provider === "openai";
        })
      ).toBe(true)
    );
    await waitFor(() =>
      expect(screen.getByText(/openai set as active provider/)).toBeInTheDocument()
    );
  });

  /* ---------- Tools / Reach ---------- */

  it("filters tools, changes permission tiers, verifies Mac tools, and toggles MCP", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { calls } = baseRoutes([
      { match: "/api/tools/verify", body: { verified: true } },
      { match: "/api/mcp/servers/srv1", body: { ok: true } },
      {
        match: /\/api\/tools$/,
        body: {
          tools: [
            { name: "filesystem", description: "Read and write files", action_type: "read_files" },
            { name: "calendar", description: "Calendar access", action_type: "read_calendar" },
            { name: "shell", description: "Run shell", action_type: "destructive_shell" },
            { name: "mcp:github", description: "GitHub MCP", action_type: "mcp_call" },
          ],
        },
      },
      {
        match: "/api/permissions",
        body: {
          active: "default",
          profiles: [{ id: "default", tiers: { read_files: "ask", read_calendar: "ask", destructive_shell: "ask" } }],
        },
      },
      {
        match: /\/api\/mcp\/servers$/,
        body: {
          servers: [
            {
              id: "srv1",
              name: "github",
              description: "GitHub tools",
              enabled: 1,
              transport: "stdio",
              source: "npm",
              command: "npx github-mcp",
              url: "",
            },
          ],
        },
      },
      { match: "/api/channels?type=telegram", body: { enabled: false, config: {} } },
      { match: "/api/channels?type=twilio", body: { enabled: false, config: {} } },
      { match: "/api/channels?type=whatsapp", body: { enabled: false, config: {} } },
      { match: "/api/channels?type=unipile", body: { enabled: false, config: {} } },
    ]);
    await go("Tools");
    await waitFor(() => expect(screen.getByText("filesystem")).toBeInTheDocument());
    expect(screen.getByText("destructive")).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("Filter…"), "calendar");
    expect(screen.getByText("calendar")).toBeInTheDocument();
    expect(screen.queryByText("filesystem")).not.toBeInTheDocument();
    await user.clear(screen.getByPlaceholderText("Filter…"));

    const fsTier = screen.getByLabelText("Permission tier for filesystem");
    await user.selectOptions(fsTier, "allow");
    await waitFor(() =>
      expect(
        calls.some((c) => {
          if (!c.url.includes("/api/permissions") || c.init?.method !== "PATCH") return false;
          const b = JSON.parse(String(c.init.body));
          return b.id === "default" && b.tiers.read_files === "allow";
        })
      ).toBe(true)
    );

    const shellTier = screen.getByLabelText("Permission tier for shell") as HTMLSelectElement;
    expect(Array.from(shellTier.options).map((o) => o.value)).toEqual(["ask", "pin"]);

    await user.click(screen.getByRole("button", { name: "Verify" }));
    await waitFor(() =>
      expect(
        calls.some((c) => {
          if (!c.url.includes("/api/tools/verify")) return false;
          return JSON.parse(String(c.init?.body)).tool === "calendar";
        })
      ).toBe(true)
    );
    await waitFor(() => expect(screen.getByText("verified")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Disable" }));
    await waitFor(() =>
      expect(
        calls.some((c) => {
          if (!c.url.includes("/api/mcp/servers/srv1") || c.init?.method !== "PATCH") return false;
          return JSON.parse(String(c.init.body)).enabled === false;
        })
      ).toBe(true)
    );
  });

  /* ---------- Communications ---------- */

  it("saves channel configs and generates an API token", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { calls } = baseRoutes([
      { match: "/api/channels?type=telegram", body: { enabled: false, config: {} } },
      { match: "/api/channels?type=twilio", body: { enabled: false, config: {} } },
      { match: "/api/channels?type=whatsapp", body: { enabled: false, config: {} } },
      { match: "/api/channels?type=unipile", body: { enabled: false, config: {} } },
      { match: "/api/channels", body: { ok: true } },
      { match: "/api/settings/api-token", body: { token: "tok_abc123" } },
      { match: "/api/comms/twilio", body: { ok: true } },
      { match: "/api/comms/tunnel", body: { ok: true, url: "https://tunnel.example" } },
    ]);
    await go("Communications");
    await waitFor(() => expect(screen.getByRole("button", { name: "Save Telegram" })).toBeInTheDocument());

    await user.type(screen.getByPlaceholderText(/Bot token/), "bot:1");
    await user.type(screen.getByPlaceholderText(/Default chat ID/), "99");
    await user.click(screen.getByRole("button", { name: "Save Telegram" }));
    await waitFor(() =>
      expect(
        calls.some((c) => {
          if (!c.url.endsWith("/api/channels") || c.init?.method !== "POST") return false;
          const b = JSON.parse(String(c.init.body));
          return b.type === "telegram" && b.config.botToken === "bot:1";
        })
      ).toBe(true)
    );

    await user.type(screen.getByPlaceholderText("Account SID"), "ACxxx");
    await user.type(screen.getByPlaceholderText("Auth token"), "auth");
    await user.type(screen.getByPlaceholderText(/Your authorised phone/), "+15551212");
    await user.type(screen.getByPlaceholderText(/Public tunnel URL/), "https://pub.example");
    await user.click(screen.getByRole("button", { name: "Save Twilio" }));
    await waitFor(() =>
      expect(
        calls.some((c) => JSON.parse(String(c.init?.body || "{}")).type === "twilio")
      ).toBe(true)
    );

    await user.click(screen.getByRole("button", { name: /1\. Verify credentials/ }));
    await waitFor(() =>
      expect(
        calls.some((c) => {
          if (!c.url.includes("/api/comms/twilio")) return false;
          return JSON.parse(String(c.init?.body || "{}")).action === "verify";
        })
      ).toBe(true)
    );

    await user.click(screen.getByRole("button", { name: /2\. Start tunnel/ }));
    await waitFor(() =>
      expect(screen.getByText(/https:\/\/tunnel\.example\/api\/channels\/twilio\/sms/)).toBeInTheDocument()
    );

    await user.click(screen.getByRole("button", { name: /4\. Test call/ }));
    await waitFor(() =>
      expect(
        calls.some((c) => JSON.parse(String(c.init?.body || "{}")).action === "test-call")
      ).toBe(true)
    );

    await user.type(screen.getByPlaceholderText(/WhatsApp 'from' number/), "whatsapp:+1");
    await user.type(screen.getByPlaceholderText(/Your authorised WhatsApp/), "+1me");
    await user.click(screen.getByRole("button", { name: "Save WhatsApp" }));
    await waitFor(() =>
      expect(
        calls.some((c) => JSON.parse(String(c.init?.body || "{}")).type === "whatsapp")
      ).toBe(true)
    );

    await user.type(screen.getByPlaceholderText(/^DSN/), "api1.unipile.com:13111");
    await user.type(screen.getByPlaceholderText(/API key \(X-API-KEY\)/), "up-key");
    await user.type(screen.getByPlaceholderText(/Webhook secret/), "whsec");
    // enable checkbox then save
    const unipileCard = screen.getByText("Unipile").closest(".p-4")!;
    await user.click(within(unipileCard as HTMLElement).getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Save Unipile" }));
    await waitFor(() =>
      expect(
        calls.some((c) => {
          const b = JSON.parse(String(c.init?.body || "{}"));
          return b.type === "unipile" && b.enabled === true && b.config.webhookSecret === "whsec";
        })
      ).toBe(true)
    );

    await user.click(screen.getByRole("button", { name: "Generate new token" }));
    await waitFor(() => expect(screen.getByText(/tok_abc123/)).toBeInTheDocument());
  });

  it("blocks enabling Unipile without a webhook secret", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    baseRoutes([
      { match: "/api/channels?type=telegram", body: { enabled: false, config: {} } },
      { match: "/api/channels?type=twilio", body: { enabled: false, config: {} } },
      { match: "/api/channels?type=whatsapp", body: { enabled: false, config: {} } },
      { match: "/api/channels?type=unipile", body: { enabled: false, config: {} } },
    ]);
    await go("Communications");
    await waitFor(() => expect(screen.getByText("Unipile")).toBeInTheDocument());
    const unipileCard = screen.getByText("Unipile").closest(".p-4")!;
    await user.click(within(unipileCard as HTMLElement).getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Save Unipile" }));
    await waitFor(() =>
      expect(screen.getByText("Webhook secret is required to enable Unipile")).toBeInTheDocument()
    );
  });

  it("polls for an inbound SMS reply after a test SMS", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    let inboundPolls = 0;
    mockFetch([
      { match: "/api/settings", body: { settings: SETTINGS } },
      { match: "/api/memory", body: { memory: [] } },
      { match: "/api/system/always-on", body: alwaysOn() },
      { match: "/api/channels?type=telegram", body: { enabled: false, config: {} } },
      { match: "/api/channels?type=twilio", body: { enabled: false, config: {} } },
      { match: "/api/channels?type=whatsapp", body: { enabled: false, config: {} } },
      { match: "/api/channels?type=unipile", body: { enabled: false, config: {} } },
      {
        match: "/api/comms/twilio",
        body: (init) => {
          if (init?.method === "POST") return { ok: true };
          inboundPolls += 1;
          if (inboundPolls < 2) return { last: null };
          return { last: { at: Date.now(), body: "pong from phone" } };
        },
      },
    ]);
    await go("Communications");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /3\. Send test SMS/ })).toBeInTheDocument()
    );
    await user.click(screen.getByRole("button", { name: /3\. Send test SMS/ }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4500);
    });
    await waitFor(() =>
      expect(screen.getByText(/Inbound reply received: “pong from phone”/)).toBeInTheDocument()
    );
  });

  /* ---------- Integrations ---------- */

  it("lists integrations with repo aria-labels and checks for updates", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { calls } = mockFetch([
      { match: "/api/settings", body: { settings: SETTINGS } },
      {
        match: "/api/integrations",
        body: (init) => {
          const check = String((init as RequestInit | undefined) ? "" : "");
          void check;
          return {
            system: [
              {
                name: "Ollama",
                purpose: "Local models",
                license: "MIT",
                repo: "https://github.com/ollama/ollama",
                source: "system",
                version: "0.1.0",
                detected: true,
              },
            ],
            npm: [
              {
                name: "next",
                purpose: "App framework",
                license: "MIT",
                repo: "https://github.com/vercel/next.js",
                source: "npm",
                version: "15.0.0",
                latest: "15.1.0",
                outdated: true,
                detected: true,
              },
            ],
            summary: {
              total: 2,
              detected: 2,
              outdated_count: 1,
              checked_for_updates: String(globalThis.fetch).includes("unused") ? false : true,
              checked_at: Date.now(),
            },
          };
        },
      },
    ]);
    // Distinguish check=1 via URL in a wrapper for accurate summary flags
    const inner = globalThis.fetch;
    let checked = false;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : String(input);
      if (url.includes("/api/integrations")) {
        calls.push({ url, init });
        const isCheck = url.includes("check=1");
        if (isCheck) checked = true;
        return {
          ok: true,
          status: 200,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({
            system: [
              {
                name: "Ollama",
                purpose: "Local models",
                license: "MIT",
                repo: "https://github.com/ollama/ollama",
                source: "system",
                version: "0.1.0",
                detected: true,
              },
            ],
            npm: [
              {
                name: "next",
                purpose: "App framework",
                license: "MIT",
                repo: "https://github.com/vercel/next.js",
                source: "npm",
                version: "15.0.0",
                latest: "15.1.0",
                outdated: checked,
                detected: true,
              },
            ],
            summary: {
              total: 2,
              detected: 2,
              outdated_count: checked ? 1 : 0,
              checked_for_updates: checked,
              checked_at: checked ? Date.now() : null,
            },
          }),
          text: async () => "{}",
          body: null,
        } as unknown as Response;
      }
      return inner(input, init);
    }) as unknown as typeof fetch;

    await go("Integrations");
    await waitFor(() => expect(screen.getByText("Ollama")).toBeInTheDocument());
    expect(screen.getByLabelText("Open Ollama repository")).toHaveAttribute(
      "href",
      "https://github.com/ollama/ollama"
    );
    expect(screen.getByLabelText("Open next repository")).toHaveAttribute(
      "href",
      "https://github.com/vercel/next.js"
    );
    expect(screen.getAllByLabelText("Detected").length).toBeGreaterThanOrEqual(1);

    await user.click(screen.getByRole("button", { name: "Check for updates" }));
    await waitFor(() => expect(screen.getByText("update available")).toBeInTheDocument());
    expect(calls.some((c) => c.url.includes("check=1"))).toBe(true);
  });

  /* ---------- Data & Privacy ---------- */

  it("deletes conversations through confirm and runs factory reset", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { calls } = baseRoutes([
      { match: "/api/data", body: { ok: true } },
    ]);
    await go("Data & Privacy");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Delete all conversations" })).toBeInTheDocument()
    );

    expect(screen.getByRole("link", { name: /Download ZIP archive/ }).closest("a")).toHaveAttribute(
      "href",
      "/api/settings/export"
    );

    await user.click(screen.getByRole("button", { name: "Delete all conversations" }));
    expect(screen.getByRole("alertdialog")).toHaveAccessibleName("Delete all conversations?");
    await user.click(screen.getByRole("button", { name: "Delete all" }));
    await waitFor(() =>
      expect(
        calls.some((c) => {
          if (!c.url.includes("/api/data")) return false;
          return JSON.parse(String(c.init?.body)).action === "delete-conversations";
        })
      ).toBe(true)
    );

    const resetBtn = screen.getByRole("button", { name: "Factory reset" });
    expect(resetBtn).toBeDisabled();
    await user.type(screen.getByPlaceholderText("Type RESET to confirm"), "RESET");
    expect(resetBtn).toBeEnabled();
    await user.click(resetBtn);
    await waitFor(() =>
      expect(
        calls.some((c) => JSON.parse(String(c.init?.body || "{}")).action === "factory-reset")
      ).toBe(true)
    );
  });

  it("toggles the web kill switch and manages site grants", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    let grants: { domain: string; policy: string; note: string | null }[] = [];
    let killed = 0;
    const { calls } = mockFetch([
      {
        match: "/api/settings",
        body: (init) => {
          if (init?.method === "PATCH") {
            const b = JSON.parse(String(init.body));
            if ("web_access_killed" in b) killed = b.web_access_killed;
            return { ok: true };
          }
          return { settings: { ...SETTINGS, web_access_killed: killed } };
        },
      },
      {
        match: "/api/web-guard/grants",
        body: (init) => {
          if (init?.method === "POST") {
            const b = JSON.parse(String(init.body));
            grants = [...grants, { domain: b.domain, policy: b.policy, note: null }];
            return { grants };
          }
          if (init?.method === "DELETE") {
            const b = JSON.parse(String(init.body));
            grants = grants.filter((g) => g.domain !== b.domain);
            return { grants };
          }
          return { grants };
        },
      },
      { match: "/api/memory", body: { memory: [] } },
      { match: "/api/system/always-on", body: alwaysOn() },
    ]);
    await go("Data & Privacy");
    await waitFor(() => expect(screen.getByRole("button", { name: "Kill switch" })).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Kill switch" }));
    await waitFor(() =>
      expect(
        calls.some((c) => JSON.parse(String(c.init?.body || "{}")).web_access_killed === 1)
      ).toBe(true)
    );
    await waitFor(() => expect(screen.getByText(/All agent web access is severed/)).toBeInTheDocument());

    await user.type(screen.getByPlaceholderText("example.com"), "bank.example");
    await user.selectOptions(screen.getByDisplayValue("never"), "allow");
    await user.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(screen.getByText("bank.example")).toBeInTheDocument());
    expect(
      JSON.parse(String(calls.find((c) => c.url.includes("/web-guard/grants") && c.init?.method === "POST")?.init?.body))
    ).toEqual({ domain: "bank.example", policy: "allow" });

    await user.click(screen.getByRole("button", { name: "remove" }));
    await waitFor(() => expect(screen.queryByText("bank.example")).not.toBeInTheDocument());
  });

  /* ---------- Backup ---------- */

  it("creates a backup and restores a snapshot through confirm", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const reload = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, reload },
    });
    let snapshots = [{ name: "snap-1", timestamp: NOW_SAFE }];
    const { calls } = mockFetch([
      { match: /\/api\/backup\/restore$/, body: { ok: true } },
      {
        match: /\/api\/backup$/,
        body: (init) => {
          if (init?.method === "POST") {
            snapshots = [...snapshots, { name: "snap-2", timestamp: NOW_SAFE + 1 }];
            return { ok: true };
          }
          return { snapshots };
        },
      },
      { match: /\/api\/settings$/, body: { settings: SETTINGS } },
      { match: "/api/health", body: { ok: true } },
    ]);
    await go("Backup");
    await waitFor(() => expect(screen.getByText("snap-1")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Backup now" }));
    await waitFor(() => expect(screen.getByText("Backup created")).toBeInTheDocument());
    expect(calls.some((c) => c.url.includes("/api/backup") && c.init?.method === "POST")).toBe(true);

    const snapRow = screen.getByText("snap-1").closest("div")!;
    await user.click(within(snapRow as HTMLElement).getByRole("button", { name: "Restore" }));
    expect(screen.getByRole("alertdialog")).toHaveAccessibleName('Restore "snap-1"?');
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Restore" }));
    await waitFor(() =>
      expect(
        calls.some((c) => {
          if (!c.url.includes("/api/backup/restore")) return false;
          return JSON.parse(String(c.init?.body)).snapshot === "snap-1";
        })
      ).toBe(true)
    );
    expect(screen.getByText(/Restoring backup/)).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3500);
    });
    expect(reload).toHaveBeenCalled();
  });
});
