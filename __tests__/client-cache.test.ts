/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("settings-cache", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("dedupes concurrent fetches and serves TTL cache", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ settings: { assistant_name: "Sora", agent_mode: "auto" } }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const { fetchSettings, peekSettings, patchSettingsCache, invalidateSettingsCache } =
      await import("../src/lib/client/settings-cache");

    invalidateSettingsCache();
    const [a, b] = await Promise.all([fetchSettings(), fetchSettings()]);
    expect(a.assistant_name).toBe("Sora");
    expect(b.assistant_name).toBe("Sora");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(peekSettings()?.assistant_name).toBe("Sora");

    patchSettingsCache({ agent_mode: "plan" });
    expect(peekSettings()?.agent_mode).toBe("plan");

    await fetchSettings();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("pulse-store", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.useFakeTimers();
  });

  it("shares one poller across subscribers", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        state: "thinking",
        processes: 1,
        graphs: 0,
        subagents: 0,
        suspended: false,
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const { subscribePulse } = await import("../src/lib/client/pulse-store");
    const seenA: string[] = [];
    const seenB: string[] = [];
    const ua = subscribePulse((p) => seenA.push(p.state));
    const ub = subscribePulse((p) => seenB.push(p.state));

    await Promise.resolve();
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(seenA).toContain("thinking");
    expect(seenB).toContain("thinking");

    ua();
    ub();
    vi.useRealTimers();
  });
});
