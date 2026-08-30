import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  nextNavigationMock,
  setRoute,
  installBrowserShims,
  type FetchRoute,
} from "../helpers/ui";
import { ConfirmProvider } from "@/components/confirm-dialog";
import { invalidateSettingsCache } from "@/lib/client/settings-cache";

vi.mock("next/navigation", () => nextNavigationMock());

// next/dynamic must resolve in tests; MarkdownBody loader returns a component, not { default }.
vi.mock("next/dynamic", async () => {
  const ReactActual = await import("react");
  return {
    default: (importer: () => Promise<unknown>) => {
      const Lazy = ReactActual.lazy(async () => {
        const mod = await importer();
        if (typeof mod === "function") return { default: mod as React.ComponentType };
        const obj = mod as { default?: React.ComponentType };
        if (obj?.default) return { default: obj.default };
        return { default: mod as React.ComponentType };
      });
      return function Dynamic(props: Record<string, unknown>) {
        return ReactActual.createElement(
          ReactActual.Suspense,
          { fallback: null },
          ReactActual.createElement(Lazy, props)
        );
      };
    },
  };
});

vi.mock("@/lib/client/voice-ready", () => ({
  fetchVoiceReady: vi.fn(async () => ({ ready: true })),
}));

vi.mock("@/components/chat/tts", () => ({
  speak: vi.fn(() => ({ done: Promise.resolve(), cancel: vi.fn() })),
  SpeakerButton: () => <button type="button" aria-label="Read aloud">Speak</button>,
}));

vi.mock("@/components/orb", () => ({
  Orb: ({ ariaLabel }: { ariaLabel?: string }) => (
    <div role="img" aria-label={ariaLabel || "orb"} />
  ),
}));

vi.mock("@/components/toast", () => ({
  toast: vi.fn(),
  Toaster: () => null,
}));

import ChatPage from "@/app/page";

const CONV = {
  id: "c1",
  title: "First chat",
  updated_at: 1_700_000_000_000,
  starred: 0,
};
const CONV2 = {
  id: "c2",
  title: "Starred notes",
  updated_at: 1_700_000_000_100,
  starred: 1,
};

function sseBody(events: unknown[]): string {
  return events
    .map((ev, i) => `id: ${i + 1}\nevent: message\ndata: ${JSON.stringify(ev)}\n\n`)
    .join("");
}

function streamResponse(events: unknown[]): Response {
  return new Response(sseBody(events), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

/** Path match that does not let `/api/foo` swallow `/api/foo/bar`. */
function pathMatches(match: RegExp | string, url: string): boolean {
  if (typeof match !== "string") return match.test(url);
  const idx = url.indexOf(match);
  if (idx === -1) return false;
  const after = url.slice(idx + match.length);
  return after === "" || after.startsWith("?") || after.startsWith("#");
}

function baseRoutes(extra: FetchRoute[] = []): FetchRoute[] {
  return [
    {
      match: "/api/settings",
      body: (init: RequestInit | undefined) => {
        if (init?.method === "PATCH") return { ok: true };
        return {
          settings: {
            onboarded: 1,
            active_model: "llama3.2",
            provider: "ollama",
            agent_mode: "auto",
          },
        };
      },
    },
    // Specific conversation routes must be listed before the collection path.
    ...extra,
    { match: "/api/conversations", body: { conversations: [CONV, CONV2] } },
    { match: "/api/fleet/peers", body: { peers: [] } },
    { match: "/api/fleet/sync", body: { messages: 0 } },
    { match: "/api/voice/stt", body: { ready: true } },
    {
      match: /\/api\/models\/capabilities/,
      body: { vision: false },
    },
  ];
}

function installChatFetch(routes: FetchRoute[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input);
    calls.push({ url, init });
    const route = routes.find((r) => pathMatches(r.match, url));
    if (!route) throw new Error(`Unmocked fetch: ${url}`);
    const raw = typeof route.body === "function" ? route.body(init) : route.body;
    if (raw instanceof Response) return raw;
    // Sentinel for a Response-like object with no ReadableStream (triggers streamChat's "no stream").
    if (raw && typeof raw === "object" && (raw as { __noStream?: boolean }).__noStream) {
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({}),
        text: async () => "",
        body: null,
      } as unknown as Response;
    }
    const status = route.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => raw,
      text: async () => JSON.stringify(raw),
      body: null,
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { calls };
}

async function renderChat() {
  const view = render(
    <ConfirmProvider>
      <ChatPage />
    </ConfirmProvider>
  );
  await waitFor(() => expect(screen.getByPlaceholderText("Message Sora…")).toBeInTheDocument());
  return view;
}

function flushRaf() {
  return act(async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  });
}

/** Main chat screen — conversations, composer, stream, header chrome. */
describe("chat page", () => {
  beforeEach(() => {
    installBrowserShims();
    setRoute("/");
    localStorage.clear();
    sessionStorage.clear();
    invalidateSettingsCache();
    vi.stubGlobal(
      "requestAnimationFrame",
      (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 0) as unknown as number
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("renders conversations from /api/conversations", async () => {
    installChatFetch(baseRoutes());
    await renderChat();
    expect(screen.getByText("First chat")).toBeInTheDocument();
    expect(screen.getByText("Starred notes")).toBeInTheDocument();
  });

  it("shows an empty list state when there are no conversations", async () => {
    installChatFetch(baseRoutes([{ match: "/api/conversations", body: { conversations: [] } }]));
    await renderChat();
    expect(screen.getByText("No conversations.")).toBeInTheDocument();
    expect(screen.getByText("Ask anything.")).toBeInTheDocument();
  });

  it("enables Send only when the composer has non-whitespace text", async () => {
    const user = userEvent.setup();
    installChatFetch(baseRoutes());
    await renderChat();
    const send = screen.getByRole("button", { name: "Send" });
    expect(send).toBeDisabled();
    await user.type(screen.getByPlaceholderText("Message Sora…"), "   ");
    expect(send).toBeDisabled();
    await user.clear(screen.getByPlaceholderText("Message Sora…"));
    await user.type(screen.getByPlaceholderText("Message Sora…"), "Hello");
    expect(send).toBeEnabled();
  });

  it("sends on Enter and posts the expected /api/chat body; Shift+Enter inserts a newline", async () => {
    const user = userEvent.setup();
    let conversations = [CONV, CONV2];
    const routes: FetchRoute[] = [
      ...baseRoutes().filter((r) => r.match !== "/api/conversations"),
      {
        match: "/api/conversations",
        body: (init: RequestInit | undefined) => {
          if (init?.method === "POST") {
            const created = {
              id: "c-new",
              title: "New chat",
              updated_at: Date.now(),
              starred: 0,
            };
            conversations = [created, ...conversations];
            return { conversation: created };
          }
          return { conversations };
        },
      },
      {
        match: "/api/chat",
        body: () =>
          streamResponse([
            { type: "text_chunk", delta: "Hi " },
            { type: "text_chunk", delta: "there" },
            { type: "done" },
          ]),
      },
    ];
    const { calls } = installChatFetch(routes);
    await renderChat();

    const composer = screen.getByPlaceholderText("Message Sora…");
    await user.type(composer, "line1");
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    await user.type(composer, "line2");
    expect(composer).toHaveValue("line1\nline2");

    await user.clear(composer);
    await user.type(composer, "Hello Sora");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      const chatCall = calls.find(
        (c) => c.url.includes("/api/chat") && !c.url.includes("resume") && !c.url.includes("confirm")
      );
      expect(chatCall).toBeTruthy();
      const body = JSON.parse(String(chatCall!.init?.body));
      expect(body.message).toBe("Hello Sora");
      expect(body.persona).toBe("general");
      expect(body.conversationId).toBeTruthy();
    });

    await flushRaf();
    await waitFor(() => expect(screen.getByText(/Hi there/)).toBeInTheDocument());
  });

  it("creates a conversation via New and selects an existing one with mouse and keyboard", async () => {
    const user = userEvent.setup();
    let conversations = [CONV, CONV2];
    const routes: FetchRoute[] = [
      ...baseRoutes().filter((r) => r.match !== "/api/conversations"),
      {
        match: "/api/conversations",
        body: (init: RequestInit | undefined) => {
          if (init?.method === "POST") {
            const created = {
              id: "c-fresh",
              title: "New chat",
              updated_at: Date.now(),
              starred: 0,
            };
            conversations = [created, ...conversations.filter((c) => c.id !== "c-fresh")];
            return { conversation: created };
          }
          return { conversations };
        },
      },
      {
        match: /\/api\/conversations\/c1$/,
        body: {
          conversation: CONV,
          messages: [
            { id: "m1", role: "user", content: "Prior question" },
            { id: "m2", role: "assistant", content: "Prior answer" },
          ],
        },
      },
      {
        match: /\/api\/conversations\/c2$/,
        body: {
          conversation: CONV2,
          messages: [{ id: "m3", role: "user", content: "Starred turn" }],
        },
      },
      { match: "/api/chat/resume", body: { suspended: false } },
    ];
    installChatFetch(routes);
    await renderChat();

    await user.click(screen.getByRole("button", { name: /New/ }));
    await waitFor(() => expect(screen.getByText("New chat")).toBeInTheDocument());

    await user.click(screen.getByText("First chat"));
    await waitFor(() => expect(screen.getByText("Prior question")).toBeInTheDocument());
    expect(screen.getByText("Prior answer")).toBeInTheDocument();

    const starredRow = screen.getByText("Starred notes").closest('[role="button"]') as HTMLElement;
    starredRow.focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByText("Starred turn")).toBeInTheDocument());

    await user.click(screen.getByText("First chat"));
    await waitFor(() => expect(screen.getByText("Prior question")).toBeInTheDocument());
    const firstRow = screen.getByText("First chat").closest('[role="button"]') as HTMLElement;
    firstRow.focus();
    await user.keyboard(" ");
    await waitFor(() => expect(screen.getByText("Prior question")).toBeInTheDocument());
  });

  it("stars, unstars, and soft-deletes a conversation", async () => {
    const user = userEvent.setup();
    let conversations = [
      { ...CONV },
      { ...CONV2 },
    ];
    const patches: unknown[] = [];
    const routes: FetchRoute[] = [
      ...baseRoutes().filter((r) => r.match !== "/api/conversations"),
      {
        match: "/api/conversations",
        body: () => ({ conversations }),
      },
      {
        match: /\/api\/conversations\/c1$/,
        body: (init: RequestInit | undefined) => {
          if (init?.method === "PATCH") {
            const body = JSON.parse(String(init.body));
            patches.push(body);
            if (body.starred === 1) {
              conversations = conversations.map((c) =>
                c.id === "c1" ? { ...c, starred: 1 } : c
              );
            } else if (body.starred === 0) {
              conversations = conversations.map((c) =>
                c.id === "c1" ? { ...c, starred: 0 } : c
              );
            } else if (body.deleted) {
              conversations = conversations.filter((c) => c.id !== "c1");
            }
            return { ok: true };
          }
          return { conversation: CONV, messages: [] };
        },
      },
      { match: "/api/chat/resume", body: { suspended: false } },
    ];
    installChatFetch(routes);
    await renderChat();

    const firstRow = screen.getByText("First chat").closest('[role="button"]')!;
    await user.click(within(firstRow as HTMLElement).getByRole("button", { name: "Star" }));
    await waitFor(() => expect(patches).toContainEqual({ starred: 1 }));
    await waitFor(() =>
      expect(within(firstRow as HTMLElement).getByRole("button", { name: "Unstar" })).toBeInTheDocument()
    );

    await user.click(within(firstRow as HTMLElement).getByRole("button", { name: "Unstar" }));
    await waitFor(() => expect(patches).toContainEqual({ starred: 0 }));

    await user.click(within(firstRow as HTMLElement).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(patches).toContainEqual({ deleted: true }));
    await waitFor(() => expect(screen.queryByText("First chat")).not.toBeInTheDocument());
  });

  it("toggles Read, shows the model, and exports the active conversation", async () => {
    const user = userEvent.setup();
    installChatFetch(
      baseRoutes([
        {
          match: /\/api\/conversations\/c1$/,
          body: {
            conversation: CONV,
            messages: [
              { id: "m1", role: "user", content: "Hi" },
              { id: "m2", role: "assistant", content: "Hello" },
            ],
          },
        },
        { match: "/api/chat/resume", body: { suspended: false } },
      ])
    );
    await renderChat();
    await user.click(screen.getByText("First chat"));
    await waitFor(() => expect(screen.getByText("Hello")).toBeInTheDocument());

    expect(screen.getByRole("button", { name: /ollama\/llama3\.2/ })).toBeInTheDocument();

    const read = screen.getByRole("button", { name: "Read replies aloud" });
    expect(read).toHaveAttribute("aria-pressed", "false");
    await user.click(read);
    expect(read).toHaveAttribute("aria-pressed", "true");
    expect(read).toHaveAttribute("data-active", "true");

    const exportLink = screen.getByRole("link", { name: "Export conversation" });
    expect(exportLink).toHaveAttribute("href", "/api/conversations/c1/export");
  });

  it("clears the thread after confirming, and compacts when there are enough turns", async () => {
    const user = userEvent.setup();
    const messages = Array.from({ length: 10 }, (_, i) => ({
      id: `m${i}`,
      role: i % 2 === 0 ? "user" : "assistant",
      content: `Turn ${i}`,
    }));
    const { calls } = installChatFetch(
      baseRoutes([
        { match: /\/api\/conversations\/c1$/, body: { conversation: CONV, messages } },
        { match: "/api/chat/resume", body: { suspended: false } },
        { match: /\/api\/conversations\/c1\/clear$/, body: { ok: true } },
        { match: /\/api\/conversations\/c1\/compact$/, body: { compacted: true, dropped: 4 } },
      ])
    );
    await renderChat();
    await user.click(screen.getByText("First chat"));
    await waitFor(() => expect(screen.getByText("Turn 0")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Clear chat" }));
    expect(screen.getByRole("alertdialog")).toHaveAccessibleName("Clear this chat?");
    await user.click(screen.getByRole("button", { name: "Clear" }));
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes("/clear") && c.init?.method === "POST")).toBe(true)
    );
    await waitFor(() => expect(screen.queryByText("Turn 0")).not.toBeInTheDocument());

    const { calls: calls2 } = installChatFetch(
      baseRoutes([
        { match: /\/api\/conversations\/c1$/, body: { conversation: CONV, messages } },
        { match: "/api/chat/resume", body: { suspended: false } },
        { match: /\/api\/conversations\/c1\/compact$/, body: { compacted: true, dropped: 4 } },
      ])
    );
    await user.click(screen.getByText("First chat"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Compact chat" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Compact chat" }));
    expect(screen.getByRole("alertdialog")).toHaveAccessibleName("Compact this chat?");
    await user.click(screen.getByRole("button", { name: "Compact" }));
    await waitFor(() =>
      expect(calls2.some((c) => c.url.includes("/compact") && c.init?.method === "POST")).toBe(true)
    );
  });

  it("changes agent mode via the segmented control", async () => {
    const user = userEvent.setup();
    const { calls } = installChatFetch(baseRoutes());
    await renderChat();
    await user.click(screen.getByRole("button", { name: "plan" }));
    await waitFor(() => {
      const patch = calls.find(
        (c) => c.url.includes("/api/settings") && c.init?.method === "PATCH"
      );
      expect(patch).toBeTruthy();
      expect(JSON.parse(String(patch!.init?.body))).toEqual({ agent_mode: "plan" });
    });
    expect(screen.getByRole("button", { name: "plan" })).toHaveAttribute("data-active", "true");
  });

  it("surfaces a connection error on failed send and regenerates after a successful reply", async () => {
    const user = userEvent.setup();
    let chatMode: "fail" | "ok" = "fail";
    const { calls } = installChatFetch(
      baseRoutes([
        {
          match: "/api/conversations",
          body: (init: RequestInit | undefined) => {
            if (init?.method === "POST") {
              return { conversation: { id: "c1", title: "First chat", updated_at: 1, starred: 0 } };
            }
            return { conversations: [CONV] };
          },
        },
        { match: /\/api\/conversations\/c1$/, body: { conversation: CONV, messages: [] } },
        { match: "/api/chat/resume", body: { suspended: false } },
        {
          match: "/api/chat",
          body: (init: RequestInit | undefined) => {
            const body = JSON.parse(String(init?.body || "{}"));
            if (chatMode === "fail") return { __noStream: true };
            if (body.regenerate) {
              return streamResponse([
                { type: "text_chunk", delta: "Regenerated reply" },
                { type: "done" },
              ]);
            }
            return streamResponse([
              { type: "text_chunk", delta: "First reply" },
              { type: "done" },
            ]);
          },
        },
      ])
    );

    // Collapse only the 1s reconnect backoff inside streamChat — leave RTL timers alone.
    const realSetTimeout = globalThis.setTimeout.bind(globalThis);
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout").mockImplementation(((
      fn: TimerHandler,
      ms?: number,
      ...args: unknown[]
    ) => {
      if (ms === 1000 && typeof fn === "function") {
        queueMicrotask(() => (fn as (...a: unknown[]) => void)(...args));
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }
      return realSetTimeout(fn as never, ms as never, ...(args as never[]));
    }) as unknown as typeof setTimeout);

    try {
      await renderChat();
      await user.click(screen.getByText("First chat"));
      await waitFor(() => expect(screen.getByPlaceholderText("Message Sora…")).toBeInTheDocument());

      await user.type(screen.getByPlaceholderText("Message Sora…"), "Ping");
      await user.click(screen.getByRole("button", { name: "Send" }));
      await waitFor(() => expect(screen.getByText(/Connection lost/)).toBeInTheDocument());
      expect(document.querySelector(".lm-error")).toBeInTheDocument();

      chatMode = "ok";
      await user.clear(screen.getByPlaceholderText("Message Sora…"));
      await user.type(screen.getByPlaceholderText("Message Sora…"), "Again");
      await user.click(screen.getByRole("button", { name: "Send" }));
      await flushRaf();
      await waitFor(() => expect(screen.getByText("First reply")).toBeInTheDocument());

      const regen = screen.getByRole("button", { name: /Regenerate/ });
      expect(regen).toHaveClass("lm-regen");
      await user.click(regen);
      await flushRaf();
      await waitFor(() => expect(screen.getByText("Regenerated reply")).toBeInTheDocument());
      const regenCall = calls.find((c) => {
        if (!pathMatches("/api/chat", c.url)) return false;
        try {
          return JSON.parse(String(c.init?.body)).regenerate === true;
        } catch {
          return false;
        }
      });
      expect(regenCall).toBeTruthy();
    } finally {
      timeoutSpy.mockRestore();
    }
  });

  it("shows Resume when a conversation is suspended and posts /api/chat/resume", async () => {
    const user = userEvent.setup();
    const { calls } = installChatFetch(
      baseRoutes([
        {
          match: /\/api\/conversations\/c1$/,
          body: {
            conversation: CONV,
            messages: [{ id: "m1", role: "user", content: "loop" }],
          },
        },
        {
          match: "/api/chat/resume",
          body: (init: RequestInit | undefined) => {
            if (init?.method === "POST") return { ok: true };
            return { suspended: true, reason: "Repeated tool calls", tool: "shell" };
          },
        },
      ])
    );
    await renderChat();
    await user.click(screen.getByText("First chat"));
    await waitFor(() => expect(screen.getByText("Repeated tool calls")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Resume/ }));
    await waitFor(() => {
      const post = calls.find(
        (c) => c.url.includes("/api/chat/resume") && c.init?.method === "POST"
      );
      expect(post).toBeTruthy();
      expect(JSON.parse(String(post!.init?.body))).toEqual({ conversation_id: "c1" });
    });
  });

  it("shows the attach control for vision models and removes a staged file", async () => {
    const user = userEvent.setup();
    installChatFetch(
      baseRoutes([
        {
          match: "/api/settings",
          body: {
            settings: {
              onboarded: 1,
              active_model: "llava",
              provider: "ollama",
              agent_mode: "auto",
            },
          },
        },
        { match: /\/api\/models\/capabilities/, body: { vision: true } },
      ])
    );
    await renderChat();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Attach image or document" })).toBeInTheDocument()
    );

    const file = new File(["hello"], "note.txt", { type: "text/plain" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => {
      Object.defineProperty(input, "files", { value: [file], configurable: true });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await waitFor(() => expect(screen.getByText("note.txt")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Remove attachment" }));
    expect(screen.queryByText("note.txt")).not.toBeInTheDocument();
  });
});
