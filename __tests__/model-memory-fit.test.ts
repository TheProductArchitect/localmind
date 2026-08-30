import { beforeEach, describe, expect, it, vi } from "vitest";
import { assessModelFit, isBlockingVerdict } from "../src/lib/models/fit";

const GB = 1024 ** 3;

/**
 * Regression cover for the reported hang: the active model was
 * nemotron-3-super:120b-a12b (86.8 GB on disk) on a 121 GB unified-memory box
 * that already had ~57 GB committed to another model server. Ollama does not
 * error in that situation — it swaps, and the chat request never returns.
 */
describe("local model memory fit", () => {
  it("rejects the model that caused the hang, with the real numbers", () => {
    const fit = assessModelFit({
      sizeBytes: 86.8 * GB,
      availableBytes: 64 * GB,
      totalBytes: 121 * GB,
      modelName: "nemotron-3-super:120b-a12b",
    });
    expect(fit.verdict).toBe("too_large");
    expect(isBlockingVerdict(fit.verdict)).toBe(true);
    expect(fit.required_gb).toBeGreaterThan(fit.available_gb);
    expect(fit.message).toContain("nemotron-3-super:120b-a12b");
    expect(fit.message).toMatch(/smaller model|Free up memory/);
  });

  it("also rejects gpt-oss:120b under the same conditions", () => {
    const fit = assessModelFit({
      sizeBytes: 65.4 * GB,
      availableBytes: 64 * GB,
      totalBytes: 121 * GB,
      modelName: "gpt-oss:120b",
    });
    expect(isBlockingVerdict(fit.verdict)).toBe(true);
  });

  it("accepts a model that comfortably fits", () => {
    const fit = assessModelFit({
      sizeBytes: 18 * GB,
      availableBytes: 64 * GB,
      totalBytes: 121 * GB,
      modelName: "gemma4:26b",
    });
    expect(fit.verdict).toBe("fits");
    expect(isBlockingVerdict(fit.verdict)).toBe(false);
  });

  it("warns without blocking when the fit is tight", () => {
    const fit = assessModelFit({
      sizeBytes: 51.7 * GB,
      availableBytes: 64 * GB,
      totalBytes: 121 * GB,
      modelName: "qwen3-coder-next:q4_K_M",
    });
    expect(fit.verdict).toBe("tight");
    expect(isBlockingVerdict(fit.verdict)).toBe(false);
    expect(fit.message).toMatch(/slow/);
  });

  it("separates 'never on this machine' from 'not right now'", () => {
    const impossible = assessModelFit({
      sizeBytes: 200 * GB,
      availableBytes: 100 * GB,
      totalBytes: 121 * GB,
      modelName: "huge",
    });
    expect(impossible.verdict).toBe("impossible");
    expect(impossible.message).toContain("in total");

    // Same model, plenty of RAM free on a bigger box: merely a current problem.
    const notNow = assessModelFit({
      sizeBytes: 90 * GB,
      availableBytes: 40 * GB,
      totalBytes: 512 * GB,
      modelName: "huge",
    });
    expect(notNow.verdict).toBe("too_large");
  });

  it("never blocks when the model size is unknown", () => {
    for (const sizeBytes of [0, null, undefined]) {
      const fit = assessModelFit({
        sizeBytes,
        availableBytes: 1 * GB,
        totalBytes: 2 * GB,
        modelName: "mystery",
      });
      expect(fit.verdict).toBe("fits");
      expect(isBlockingVerdict(fit.verdict)).toBe(false);
    }
  });
});

describe("ollama chat memory preflight", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  async function runChat(opts: { modelSizeBytes: number; freeBytes: number; totalBytes: number }) {
    vi.doMock("node:os", () => ({
      default: { freemem: () => opts.freeBytes, totalmem: () => opts.totalBytes },
      freemem: () => opts.freeBytes,
      totalmem: () => opts.totalBytes,
    }));

    const chatFetch = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/api/tags")) {
          return {
            ok: true,
            json: async () => ({
              models: [{ name: "big-model:latest", size: opts.modelSizeBytes }],
            }),
          };
        }
        chatFetch(url);
        return {
          ok: true,
          body: { getReader: () => ({ read: async () => ({ done: true, value: undefined }) }) },
        };
      })
    );

    const { ollamaProvider, clearOllamaSizeCache } = await import("../src/lib/providers/ollama");
    clearOllamaSizeCache();

    const out: unknown[] = [];
    let error: Error | null = null;
    try {
      for await (const d of ollamaProvider.chat({
        model: "big-model",
        messages: [{ role: "user", content: "hi" }],
        tools: [],
        signal: new AbortController().signal,
      } as any)) {
        out.push(d);
      }
    } catch (e) {
      error = e as Error;
    }
    return { error, chatFetch, out };
  }

  it("fails fast instead of hanging when the model cannot fit", async () => {
    const { error, chatFetch } = await runChat({
      modelSizeBytes: 86.8 * GB,
      freeBytes: 64 * GB,
      totalBytes: 121 * GB,
    });

    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toContain("Not enough memory");
    // The whole point: we never open the request that would hang.
    expect(chatFetch).not.toHaveBeenCalled();
  });

  it("proceeds normally when the model fits", async () => {
    const { error, chatFetch } = await runChat({
      modelSizeBytes: 18 * GB,
      freeBytes: 64 * GB,
      totalBytes: 121 * GB,
    });

    expect(error).toBeNull();
    expect(chatFetch).toHaveBeenCalled();
  });
});
