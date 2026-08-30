import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { nextNavigationMock, setRoute, mockFetch, installBrowserShims } from "../helpers/ui";

vi.mock("next/navigation", () => nextNavigationMock());
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode; [k: string]: unknown }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock("@/components/orb", () => ({
  Orb: () => <span data-testid="orb" />,
}));

import FleetPage from "@/app/fleet/page";
import { ConfirmProvider } from "@/components/confirm-dialog";
import { Toaster } from "@/components/toast";

const NOW = 1_700_000_000_000;

function peer(overrides: Record<string, unknown> = {}) {
  return {
    peer_node_id: "abcdef0123456789peer01",
    label: "Lab Linux",
    primary_addr: "192.168.1.50:9443",
    paired_at: NOW - 86_400_000,
    last_seen_at: NOW - 10_000,
    trusted: 1,
    policy: {
      allow_self_actions: false,
      allowed_tools: [] as string[],
      advertise_capabilities: true,
      accept_chat_relay: false,
      accept_workspace_relay: false,
      accept_tool_relay: false,
      sync_conversations: true,
    },
    capabilities: {
      platform: "linux",
      gpu_available: true,
      models: [{ name: "llama3.2:3b", loaded: true }],
      tools: ["filesystem", "shell", "calendar"],
    },
    ...overrides,
  };
}

function renderPage() {
  return render(
    <ConfirmProvider>
      <Toaster />
      <FleetPage />
    </ConfirmProvider>
  );
}

describe("fleet page", () => {
  beforeEach(() => {
    installBrowserShims();
    setRoute("/fleet");
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(NOW);
    // jsdom has no clipboard; provide a resolving stub so copy handlers can finish.
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.resolve() },
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the empty state when there are no peers", async () => {
    mockFetch([{ match: "/api/fleet/peers", body: { peers: [] } }]);
    renderPage();
    await waitFor(() =>
      expect(
        screen.getByText(/No paired machines yet\. Pair another LocalMind install/)
      ).toBeInTheDocument()
    );
    expect(screen.getByRole("button", { name: /Sync chats/ })).toBeDisabled();
  });

  it("renders paired peers with address, models, tools, and GPU chip", async () => {
    mockFetch([{ match: "/api/fleet/peers", body: { peers: [peer()] } }]);
    renderPage();
    await waitFor(() => expect(screen.getByText("Lab Linux")).toBeInTheDocument());
    expect(screen.getByText("1 paired · 1 online")).toBeInTheDocument();
    expect(screen.getByText("192.168.1.50:9443")).toBeInTheDocument();
    expect(screen.getByText("llama3.2:3b")).toBeInTheDocument();
    expect(screen.getByText("3 registered")).toBeInTheDocument();
    expect(screen.getByText("linux")).toBeInTheDocument();
    expect(screen.getByText("GPU")).toBeInTheDocument();
    expect(screen.getByText(/last seen 10s ago/)).toBeInTheDocument();
  });

  it("shows hub tip and expands transport details", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockFetch([{ match: "/api/fleet/peers", body: { peers: [] } }]);
    renderPage();
    await waitFor(() => expect(screen.getByText(/Hub tip/)).toBeInTheDocument());
    expect(screen.getByText(/docs\/dgx-hub-wifi\.md/)).toBeInTheDocument();

    const transport = screen.getByRole("button", { name: /How they connect/ });
    expect(transport).toHaveAttribute("aria-expanded", "false");
    await user.click(transport);
    expect(transport).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/Fleet port/)).toBeInTheDocument();
    expect(screen.getByText(/mTLS with pinned keys/)).toBeInTheDocument();
  });

  it("starts pairing, copies the payload, and closes the panel", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const pairing = {
      payload: { v: 1 },
      payload_json: '{"v":1,"node_id":"abc"}',
      qr_svg: "<svg data-testid='qr'></svg>",
      window: {
        token_short: "tok123",
        issued_at: NOW,
        expires_at: NOW + 300_000,
        ttl_ms: 300_000,
      },
    };
    const { calls } = mockFetch([
      { match: "/api/fleet/peers", body: { peers: [] } },
      { match: "/api/fleet/pair/start", body: pairing },
    ]);
    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: /Pair new machine/ })).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /Pair new machine/ }));
    await waitFor(() => expect(screen.getByText("Pair a new device")).toBeInTheDocument());
    expect(JSON.parse(String(calls.find((c) => c.url.includes("/pair/start"))?.init?.body))).toEqual({});
    expect(screen.getByDisplayValue(pairing.payload_json)).toBeInTheDocument();
    expect(screen.getByText(/tok123/)).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    expect(screen.getByText(/4:\d{2} left|5:00 left|4:59 left/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Copy payload/ }));
    await waitFor(() =>
      expect(screen.getByText(/Payload copied/)).toBeInTheDocument()
    );

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByText("Pair a new device")).not.toBeInTheDocument();
  });

  it("sends a label hint when starting pair after typing one", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    // Pairing panel label is only editable AFTER start — the start body uses
    // pairingLabel state set before click. Type into… there is no pre-start
    // label field; label hint lives inside the panel after start. Re-start
    // after editing is not available; assert empty body on first start, then
    // that the panel exposes the label input for the next round via cancel+start.
    const pairing = {
      payload: {},
      payload_json: "{}",
      qr_svg: "<svg></svg>",
      window: { token_short: "x", issued_at: NOW, expires_at: NOW + 60_000, ttl_ms: 60_000 },
    };
    const { calls } = mockFetch([
      { match: "/api/fleet/peers", body: { peers: [] } },
      { match: "/api/fleet/pair/start", body: pairing },
    ]);
    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: /Pair new machine/ })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Pair new machine/ }));
    await waitFor(() => expect(screen.getByPlaceholderText("Label hint (optional)")).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText("Label hint (optional)"), "DGX Hub");
    // Label is kept in state; closing and pairing again includes it.
    await user.click(screen.getByRole("button", { name: "Close" }));
    await user.click(screen.getByRole("button", { name: /Pair new machine/ }));
    await waitFor(() =>
      expect(calls.filter((c) => c.url.includes("/pair/start")).length).toBe(2)
    );
    const second = calls.filter((c) => c.url.includes("/pair/start"))[1];
    expect(JSON.parse(String(second.init?.body))).toEqual({ label_hint: "DGX Hub" });
  });

  it("accepts a pairing invitation and reloads peers", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    let peers: unknown[] = [];
    const { calls } = mockFetch([
      {
        match: "/api/fleet/peers",
        body: () => ({ peers }),
      },
      {
        match: "/api/fleet/pair/accept",
        body: { peer: { label: "Spouse laptop" }, initiator_node_id: "init1" },
      },
    ]);
    renderPage();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Accept invitation/ })).toBeInTheDocument()
    );

    await user.click(screen.getByRole("button", { name: /Accept invitation/ }));
    expect(screen.getByText("Accept a pairing invitation")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pair" })).toBeDisabled();

    await user.click(screen.getByPlaceholderText(/\{"v":1/));
    await user.paste('{"v":1,"node_id":"peer99"}');

    await user.type(screen.getByPlaceholderText(/Label for that device/), "Spouse laptop");
    peers = [peer({ peer_node_id: "peer99", label: "Spouse laptop" })];
    await user.click(screen.getByRole("button", { name: "Pair" }));

    await waitFor(() =>
      expect(screen.getByText(/Paired with Spouse laptop/)).toBeInTheDocument()
    );
    const accept = calls.find((c) => c.url.includes("/pair/accept"));
    expect(JSON.parse(String(accept?.init?.body))).toEqual({
      payload_json: '{"v":1,"node_id":"peer99"}',
      label_for_initiator: "Spouse laptop",
    });
    await waitFor(() => expect(screen.getByText("Spouse laptop")).toBeInTheDocument());
  });

  it("surfaces a pairing accept error", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockFetch([
      { match: "/api/fleet/peers", body: { peers: [] } },
      { match: "/api/fleet/pair/accept", body: { error: "token expired" }, status: 400 },
    ]);
    renderPage();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Accept invitation/ })).toBeInTheDocument()
    );
    await user.click(screen.getByRole("button", { name: /Accept invitation/ }));
    await user.click(screen.getByPlaceholderText(/\{"v":1/));
    await user.paste("bad-payload");
    await user.click(screen.getByRole("button", { name: "Pair" }));
    await waitFor(() => expect(screen.getByText("token expired")).toBeInTheDocument());
  });

  it("refreshes peers from the header refresh button", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { calls } = mockFetch([{ match: "/api/fleet/peers", body: { peers: [peer()] } }]);
    renderPage();
    await waitFor(() => expect(screen.getByText("Lab Linux")).toBeInTheDocument());
    const before = calls.filter((c) => c.url.includes("/api/fleet/peers")).length;
    await user.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() =>
      expect(calls.filter((c) => c.url.includes("/api/fleet/peers")).length).toBeGreaterThan(before)
    );
  });

  it("syncs chats across peers", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { calls } = mockFetch([
      { match: "/api/fleet/peers", body: { peers: [peer()] } },
      { match: "/api/fleet/sync", body: { messages: 3, peers: 1 } },
    ]);
    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: /Sync chats/ })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: /Sync chats/ }));
    await waitFor(() =>
      expect(screen.getByText("Synced 3 messages from 1 peer")).toBeInTheDocument()
    );
    expect(calls.some((c) => c.url.includes("/api/fleet/sync") && c.init?.method === "POST")).toBe(true);
  });

  it("unpairs a peer after confirm", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    let peers = [peer()];
    const { calls } = mockFetch([
      { match: "/api/fleet/peers", body: () => ({ peers }) },
      { match: /\/api\/fleet\/peers\/abcdef/, body: { ok: true } },
    ]);
    renderPage();
    await waitFor(() => expect(screen.getByLabelText("Unpair")).toBeInTheDocument());

    await user.click(screen.getByLabelText("Unpair"));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveAccessibleName("Unpair this device?");
    peers = [];
    await user.click(within(dialog).getByRole("button", { name: "Unpair" }));

    await waitFor(() =>
      expect(
        calls.some((c) => c.url.includes("/api/fleet/peers/abcdef") && c.init?.method === "DELETE")
      ).toBe(true)
    );
    await waitFor(() =>
      expect(screen.getByText(/No paired machines yet\. Pair another/)).toBeInTheDocument()
    );
  });

  it("cancels unpair without deleting", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { calls } = mockFetch([{ match: "/api/fleet/peers", body: { peers: [peer()] } }]);
    renderPage();
    await waitFor(() => expect(screen.getByLabelText("Unpair")).toBeInTheDocument());
    await user.click(screen.getByLabelText("Unpair"));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(calls.every((c) => c.init?.method !== "DELETE")).toBe(true);
  });

  it("renames a peer via prompt and PATCHes the label", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    vi.spyOn(window, "prompt").mockReturnValue("Homelab");
    const { calls } = mockFetch([
      { match: "/api/fleet/peers", body: { peers: [peer()] } },
      { match: /\/api\/fleet\/peers\/abcdef/, body: { ok: true } },
    ]);
    renderPage();
    await waitFor(() => expect(screen.getByText("Lab Linux")).toBeInTheDocument());
    await user.click(screen.getByText("Lab Linux"));
    await waitFor(() =>
      expect(
        calls.some((c) => c.url.includes("/api/fleet/peers/abcdef") && c.init?.method === "PATCH")
      ).toBe(true)
    );
    const patch = calls.find((c) => c.init?.method === "PATCH");
    expect(JSON.parse(String(patch?.init?.body))).toEqual({ label: "Homelab" });
  });

  it("copies the peer fingerprint", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockFetch([{ match: "/api/fleet/peers", body: { peers: [peer()] } }]);
    renderPage();
    await waitFor(() => expect(screen.getByText(/abcdef012345/)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /abcdef012345/ }));
    await waitFor(() =>
      expect(screen.getByText(/Fingerprint copied/)).toBeInTheDocument()
    );
  });

  it("toggles peer policy controls including chat and tool relay", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const p = peer();
    const { calls } = mockFetch([
      { match: "/api/fleet/peers", body: { peers: [p] } },
      { match: /\/api\/fleet\/peers\/abcdef/, body: { ok: true } },
    ]);
    renderPage();
    await waitFor(() => expect(screen.getByText("Lab Linux")).toBeInTheDocument());

    await user.click(screen.getByText("Policy"));
    const chatRelay = screen.getByLabelText(/Allow this peer to drive chat on us/);
    await user.click(chatRelay);

    await waitFor(() =>
      expect(calls.some((c) => c.init?.method === "PATCH")).toBe(true)
    );
    const body = JSON.parse(String(calls.find((c) => c.init?.method === "PATCH")?.init?.body));
    expect(body.policy.accept_chat_relay).toBe(true);
    expect(body.policy.advertise_capabilities).toBe(true);

    await user.click(screen.getByLabelText(/Accept tool relay/));
    await waitFor(() =>
      expect(
        calls.filter((c) => c.init?.method === "PATCH").length
      ).toBeGreaterThanOrEqual(2)
    );
    const toolBody = JSON.parse(
      String(calls.filter((c) => c.init?.method === "PATCH").at(-1)?.init?.body)
    );
    expect(toolBody.policy.accept_tool_relay).toBe(true);

    await user.click(screen.getByLabelText(/Allow this device to auto-approve/));
    await user.click(screen.getByLabelText(/Advertise our capabilities/));
    await user.click(screen.getByLabelText(/Sync conversations/));
    await user.click(screen.getByLabelText(/Accept workspace relay/));
    await waitFor(() =>
      expect(calls.filter((c) => c.init?.method === "PATCH").length).toBeGreaterThanOrEqual(6)
    );
  });

  it("links to MCP, Models, and Plugins capability pages", async () => {
    mockFetch([{ match: "/api/fleet/peers", body: { peers: [] } }]);
    renderPage();
    await waitFor(() => expect(screen.getByRole("link", { name: /MCP servers/ })).toBeInTheDocument());
    expect(screen.getByRole("link", { name: /MCP servers/ })).toHaveAttribute("href", "/mcp");
    expect(screen.getByRole("link", { name: /^Models/ })).toHaveAttribute("href", "/models");
    expect(screen.getByRole("link", { name: /Plugins/ })).toHaveAttribute("href", "/plugins");
  });
});
