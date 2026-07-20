import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../src/lib/agent/web-guard", () => ({
  checkWebAccess: () => ({ ok: true }),
}));

let provider = "auto";
vi.mock("../src/lib/db/queries", () => ({
  getSettings: () => ({ web_search_provider: provider }),
}));

let youKey: string | null = null;
vi.mock("../src/lib/db/apikeys", () => ({
  getApiKey: (p: string) => (p === "you" ? youKey : null),
}));

import { youSearch, websearchTool } from "../src/lib/tools/websearch";

const ctx = { conversationId: "c1", approvedDirs: [] };

function jsonResponse(body: any) {
  return { ok: true, status: 200, json: async () => body, text: async () => "" };
}

describe("youSearch mapping", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("maps you.com hits to the shared title/url/description shape", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        hits: [
          { title: "T1", url: "https://a.com", snippets: ["snip one"] },
          { title: "T2", url: "https://b.com", description: "desc two" },
        ],
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const hits = await youSearch("query", "key-123");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as any;
    expect(url).toBe("https://api.you.com/v1/search");
    expect((init.headers as any).Authorization).toBe("Bearer key-123");
    expect(hits).toEqual([
      { title: "T1", url: "https://a.com", description: "snip one" },
      { title: "T2", url: "https://b.com", description: "desc two" },
    ]);
  });

  it("throws on non-ok responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 429 })));
    await expect(youSearch("q", "k")).rejects.toThrow("you.com 429");
  });
});

describe("web_search provider routing", () => {
  const origBrave = process.env.BRAVE_API_KEY;
  beforeEach(() => {
    provider = "auto";
    youKey = null;
    delete process.env.BRAVE_API_KEY;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    if (origBrave === undefined) delete process.env.BRAVE_API_KEY;
    else process.env.BRAVE_API_KEY = origBrave;
  });

  it("uses you.com when provider=you and a key is set", async () => {
    provider = "you";
    youKey = "yk";
    const fetchMock = vi.fn(async () => jsonResponse({ hits: [{ title: "T", url: "https://x.com", description: "d" }] }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await websearchTool.execute({ query: "hello" }, ctx);
    expect(res.ok).toBe(true);
    expect((fetchMock.mock.calls[0] as any)[0]).toBe("https://api.you.com/v1/search");
    expect(res.output).toContain("https://x.com");
  });

  it("auto prefers you.com when a you key is present", async () => {
    provider = "auto";
    youKey = "yk";
    const fetchMock = vi.fn(async () => jsonResponse({ hits: [{ title: "T", url: "https://x.com", description: "d" }] }));
    vi.stubGlobal("fetch", fetchMock);
    await websearchTool.execute({ query: "hello" }, ctx);
    expect((fetchMock.mock.calls[0] as any)[0]).toBe("https://api.you.com/v1/search");
  });

  it("auto falls back to Brave when only a Brave key is present", async () => {
    provider = "auto";
    youKey = null;
    process.env.BRAVE_API_KEY = "bk";
    const fetchMock = vi.fn(async () =>
      jsonResponse({ web: { results: [{ title: "B", url: "https://brave.com", description: "d" }] } })
    );
    vi.stubGlobal("fetch", fetchMock);
    await websearchTool.execute({ query: "hello" }, ctx);
    expect((fetchMock.mock.calls[0] as any)[0]).toContain("api.search.brave.com");
  });
});
