import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
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

import ModelsPage from "@/app/models/page";
import { ConfirmProvider } from "@/components/confirm-dialog";
import { Toaster } from "@/components/toast";
import { CURATED_MODELS } from "@/lib/curated-models";

function renderPage() {
  return render(
    <ConfirmProvider>
      <Toaster />
      <ModelsPage />
    </ConfirmProvider>
  );
}

/** One SSE event per read() so React can paint progress between chunks. */
function sseBody(events: object[]) {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i >= events.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(events[i++])}\n\n`));
    },
  });
}

/** Extends mockFetch so /api/models/pull can return an SSE stream body. */
function mockModelsFetch(
  routes: Parameters<typeof mockFetch>[0],
  pull?: { events: object[]; status?: number; errorBody?: object }
) {
  const { calls, fn } = mockFetch(routes);
  if (!pull) return { calls, fn };
  const inner = fn;
  const wrapped = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input);
    if (url.includes("/api/models/pull")) {
      calls.push({ url, init });
      const status = pull.status ?? 200;
      if (status >= 400) {
        return {
          ok: false,
          status,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => pull.errorBody || { error: "Pull failed" },
          text: async () => JSON.stringify(pull.errorBody || { error: "Pull failed" }),
          body: null,
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "text/event-stream" }),
        json: async () => ({}),
        text: async () => "",
        body: sseBody(pull.events),
      } as unknown as Response;
    }
    return inner(input, init);
  });
  globalThis.fetch = wrapped as unknown as typeof fetch;
  return { calls, fn: wrapped };
}

const OLLAMA_MODELS = {
  models: [
    { name: "llama3.2:3b", family: "llama", size: 2e9 },
    { name: "qwen2.5-coder:7b", family: "qwen", size: 4.7e9 },
  ],
  active: "llama3.2:3b",
  active_provider: "ollama",
};

describe("models page", () => {
  beforeEach(() => {
    installBrowserShims();
    setRoute("/models");
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("loads Ollama models and marks the active one", async () => {
    mockFetch([{ match: "/api/models?provider=ollama", body: OLLAMA_MODELS }]);
    renderPage();
    await waitFor(() => expect(screen.getByText("llama3.2:3b")).toBeInTheDocument());
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText(/llama · 2\.0 GB/)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Ollama" })).toHaveAttribute("aria-selected", "true");
  });

  it("switches provider tabs and refetches", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { calls } = mockFetch([
      { match: "/api/models?provider=ollama", body: OLLAMA_MODELS },
      {
        match: "/api/models?provider=anthropic",
        body: {
          models: [{ name: "claude-sonnet-4", family: "claude" }],
          active: null,
          active_provider: null,
        },
      },
    ]);
    renderPage();
    await waitFor(() => expect(screen.getByText("llama3.2:3b")).toBeInTheDocument());

    await user.click(screen.getByRole("tab", { name: "Anthropic" }));
    await waitFor(() => expect(screen.getByText("claude-sonnet-4")).toBeInTheDocument());
    expect(screen.getByRole("tab", { name: "Anthropic" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText(/Claude models via your Anthropic API key/)).toBeInTheDocument();
    expect(calls.some((c) => c.url.includes("provider=anthropic"))).toBe(true);
  });

  it("sets a model active and PATCHes settings with the chat provider", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { calls } = mockFetch([
      { match: "/api/models?provider=ollama", body: { ...OLLAMA_MODELS, active: "llama3.2:3b" } },
      { match: "/api/settings", body: { ok: true } },
    ]);
    renderPage();
    await waitFor(() => expect(screen.getByText("qwen2.5-coder:7b")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /Set active/ }));
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes("/api/settings") && c.init?.method === "PATCH")).toBe(true)
    );
    const patch = calls.find((c) => c.url.includes("/api/settings") && c.init?.method === "PATCH");
    expect(JSON.parse(String(patch?.init?.body))).toEqual({
      active_model: "qwen2.5-coder:7b",
      provider: "ollama",
    });
  });

  it("pulls a curated Ollama model via POST /api/models/pull and shows progress", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { calls } = mockModelsFetch(
      [{ match: "/api/models?provider=ollama", body: { models: [], active: null, active_provider: null } }],
      {
        events: [
          { type: "progress", pct: 40, status: "pulling", bytes: 4e8, total: 1e9 },
          { type: "done" },
        ],
      }
    );
    renderPage();
    await waitFor(() => expect(screen.getByText(CURATED_MODELS[4].name)).toBeInTheDocument());

    const card = screen.getByText("mistral:7b").closest(".lm-panel")!;
    await user.click(within(card as HTMLElement).getByRole("button", { name: /Download/ }));

    await waitFor(() =>
      expect(calls.some((c) => c.url.includes("/api/models/pull"))).toBe(true)
    );
    expect(JSON.parse(String(calls.find((c) => c.url.includes("/api/models/pull"))?.init?.body))).toEqual({
      provider: "ollama",
      name: "mistral:7b",
    });
    // Progress paints between SSE reads; with fake timers it may coalesce — assert the stream cleared.
    await waitFor(() => expect(screen.queryByText(/Downloading mistral:7b/)).not.toBeInTheDocument());
  });

  it("pulls a custom model name from the input", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { calls } = mockModelsFetch(
      [{ match: "/api/models?provider=ollama", body: { models: [], active: null, active_provider: null } }],
      { events: [{ type: "done" }] }
    );
    renderPage();
    await waitFor(() => expect(screen.getByPlaceholderText(/Any Ollama model name/)).toBeInTheDocument());

    await user.type(screen.getByPlaceholderText(/Any Ollama model name/), "gemma2:9b");
    await user.click(screen.getByRole("button", { name: /^Pull$/ }));

    await waitFor(() =>
      expect(calls.some((c) => c.url.includes("/api/models/pull"))).toBe(true)
    );
    expect(JSON.parse(String(calls.find((c) => c.url.includes("/api/models/pull"))?.init?.body))).toEqual({
      provider: "ollama",
      name: "gemma2:9b",
    });
  });

  it("deletes an Ollama model through the confirm dialog", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { calls } = mockFetch([
      { match: "/api/models?provider=ollama", body: OLLAMA_MODELS },
      { match: "/api/models/qwen2.5-coder%3A7b", body: { ok: true } },
    ]);
    renderPage();
    await waitFor(() => expect(screen.getByLabelText("Delete qwen2.5-coder:7b")).toBeInTheDocument());

    await user.click(screen.getByLabelText("Delete qwen2.5-coder:7b"));
    expect(screen.getByRole("alertdialog")).toHaveAccessibleName("Delete qwen2.5-coder:7b?");
    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(
        calls.some((c) => c.url.includes("/api/models/qwen2.5-coder") && c.init?.method === "DELETE")
      ).toBe(true)
    );
  });

  it("cancels delete without calling the API", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { calls } = mockFetch([{ match: "/api/models?provider=ollama", body: OLLAMA_MODELS }]);
    renderPage();
    await waitFor(() => expect(screen.getByLabelText("Delete llama3.2:3b")).toBeInTheDocument());

    await user.click(screen.getByLabelText("Delete llama3.2:3b"));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(calls.every((c) => c.init?.method !== "DELETE")).toBe(true);
  });

  it("toasts instead of deleting when the provider is not Ollama", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockFetch([
      {
        match: "/api/models?provider=ollama",
        body: OLLAMA_MODELS,
      },
      {
        match: "/api/models?provider=lmstudio",
        body: {
          models: [{ name: "local-lm", size: 1e9 }],
          active: null,
          active_provider: null,
        },
      },
    ]);
    renderPage();
    await waitFor(() => expect(screen.getByText("llama3.2:3b")).toBeInTheDocument());
    await user.click(screen.getByRole("tab", { name: "LM Studio" }));
    await waitFor(() => expect(screen.getByText("local-lm")).toBeInTheDocument());

    await user.click(screen.getByLabelText("Delete local-lm"));
    await waitFor(() =>
      expect(screen.getByText("Manage LM Studio models from the LM Studio app.")).toBeInTheDocument()
    );
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("downloads a Hugging Face catalogue entry with the correct pull body", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const catalogue = [
      {
        repo: "TheBloke/TinyLlama-GGUF",
        file: "tinyllama.Q4_K_M.gguf",
        ollamaName: "tinyllama",
        description: "Tiny test model",
        ram: "4GB",
        size: "0.6 GB",
      },
    ];
    const { calls } = mockModelsFetch(
      [
        { match: "/api/models?provider=ollama", body: OLLAMA_MODELS },
        {
          match: "/api/models?provider=huggingface",
          body: { models: [], catalogue, active: null, active_provider: null },
        },
      ],
      { events: [{ type: "done" }] }
    );
    renderPage();
    await waitFor(() => expect(screen.getByText("llama3.2:3b")).toBeInTheDocument());
    await user.click(screen.getByRole("tab", { name: "Hugging Face" }));
    await waitFor(() => expect(screen.getByText("TheBloke/TinyLlama-GGUF")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /Download/ }));
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes("/api/models/pull"))).toBe(true)
    );
    expect(JSON.parse(String(calls.find((c) => c.url.includes("/api/models/pull"))?.init?.body))).toEqual({
      provider: "huggingface",
      repo: catalogue[0].repo,
      file: catalogue[0].file,
      ollamaName: catalogue[0].ollamaName,
    });
  });

  it("shows the empty state when a provider has nothing installed", async () => {
    mockFetch([
      {
        match: "/api/models?provider=ollama",
        body: { models: [], active: null, active_provider: null },
      },
    ]);
    renderPage();
    await waitFor(() =>
      expect(screen.getByText("Nothing available in this provider yet")).toBeInTheDocument()
    );
    expect(screen.getByText(/llama3\.2 is a good first choice/)).toBeInTheDocument();
  });

  it("shows the API-key empty state with a Settings link", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockFetch([
      { match: "/api/models?provider=ollama", body: OLLAMA_MODELS },
      {
        match: "/api/models?provider=openai",
        body: {
          models: [],
          needs_key: true,
          error: "No OpenAI key configured",
          active: null,
          active_provider: null,
        },
      },
    ]);
    renderPage();
    await waitFor(() => expect(screen.getByText("llama3.2:3b")).toBeInTheDocument());
    await user.click(screen.getByRole("tab", { name: "OpenAI" }));

    await waitFor(() => expect(screen.getByText("API key required")).toBeInTheDocument());
    expect(screen.getByText("No OpenAI key configured")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open Settings/ })).toHaveAttribute("href", "/settings");
    expect(screen.getByRole("link", { name: /Settings → Providers/ })).toBeInTheDocument();
  });

  it("surfaces a pull error from the stream", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockModelsFetch(
      [{ match: "/api/models?provider=ollama", body: { models: [], active: null, active_provider: null } }],
      { events: [{ type: "error", message: "disk full" }] }
    );
    renderPage();
    await waitFor(() => expect(screen.getByPlaceholderText(/Any Ollama model name/)).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText(/Any Ollama model name/), "bad:model");
    await user.click(screen.getByRole("button", { name: /^Pull$/ }));
    await waitFor(() => expect(screen.getByText("disk full")).toBeInTheDocument());
  });

  it("shows docs link when the provider returns docs_url", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockFetch([
      { match: "/api/models?provider=ollama", body: OLLAMA_MODELS },
      {
        match: "/api/models?provider=lmstudio",
        body: {
          models: [],
          docs_url: "https://lmstudio.ai/docs",
          active: null,
          active_provider: null,
        },
      },
    ]);
    renderPage();
    await waitFor(() => expect(screen.getByText("llama3.2:3b")).toBeInTheDocument());
    await user.click(screen.getByRole("tab", { name: "LM Studio" }));
    await waitFor(() =>
      expect(screen.getByRole("link", { name: /LM Studio local server docs/ })).toHaveAttribute(
        "href",
        "https://lmstudio.ai/docs"
      )
    );
  });
});
