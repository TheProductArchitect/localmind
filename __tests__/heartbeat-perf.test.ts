import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Guards the fixes for the hang reported after a chat turn started: the
 * heartbeat endpoints were doing blocking or O(rows) work on the same event
 * loop as the SSE stream.
 */

const { countActive, countRunningGraphs, currentUser, isOwner, prepare } = vi.hoisted(() => ({
  countActive: vi.fn(() => ({ total: 0, subagents: 0 })),
  countRunningGraphs: vi.fn(() => 0),
  currentUser: vi.fn(() => null as null | { id: string }),
  isOwner: vi.fn(() => true),
  prepare: vi.fn(() => ({ get: () => ({ n: 0, name: "conversation_loop_state" }) })),
}));

vi.mock("../src/lib/db/agent-processes", () => ({ countActive }));
vi.mock("../src/lib/db/task-graphs", () => ({ countRunningGraphs }));
vi.mock("../src/lib/auth/identity", () => ({ currentUser, isOwner }));
vi.mock("../src/lib/db", () => ({ getConvDb: () => ({ prepare }) }));

// Any synchronous child_process call in a request handler blocks the whole
// event loop, so the tests below assert these are never reached.
const sync = vi.hoisted(() => ({
  execSync: vi.fn(() => ""),
  spawnSync: vi.fn(() => ({ status: 1, stdout: "", stderr: "" })),
  execFileSync: vi.fn(() => ""),
}));

vi.mock("node:child_process", async (orig) => ({
  ...(await orig<typeof import("node:child_process")>()),
  ...sync,
}));
vi.mock("child_process", async (orig) => ({
  ...(await orig<typeof import("child_process")>()),
  ...sync,
}));

const pulseReq = () => ({}) as any;

describe("/api/pulse heartbeat cost", () => {
  beforeEach(() => {
    vi.resetModules();
    countActive.mockClear();
    countRunningGraphs.mockClear();
  });

  it("uses count queries rather than fetching process and graph rows", async () => {
    const { GET } = await import("../src/app/api/pulse/route");
    const res = await GET(pulseReq());
    const body = await res.json();

    expect(countActive).toHaveBeenCalledTimes(1);
    expect(countRunningGraphs).toHaveBeenCalledTimes(1);
    expect(body).toMatchObject({ state: "idle", processes: 0, graphs: 0, subagents: 0 });
  });

  it("collapses rapid polls from multiple windows onto one DB read", async () => {
    const { GET } = await import("../src/app/api/pulse/route");
    await GET(pulseReq());
    await GET(pulseReq());
    await GET(pulseReq());

    expect(countActive).toHaveBeenCalledTimes(1);
    expect(countRunningGraphs).toHaveBeenCalledTimes(1);
  });

  it("reports spawn state from the subagent count without loading rows", async () => {
    countActive.mockReturnValue({ total: 3, subagents: 2 });
    const { GET } = await import("../src/app/api/pulse/route");
    const body = await (await GET(pulseReq())).json();
    expect(body.state).toBe("spawn");
    expect(body.subagents).toBe(2);
  });

  it("does not cap the subagent count, since the Rail label shows the real number", async () => {
    countActive.mockReturnValue({ total: 9, subagents: 9 });
    const { GET } = await import("../src/app/api/pulse/route");
    const body = await (await GET(pulseReq())).json();
    expect(body.subagents).toBe(9);
  });

  it("caches per identity scope so one user's poll cannot serve another", async () => {
    countActive.mockReturnValue({ total: 1, subagents: 0 });
    currentUser.mockReturnValue({ id: "user-a" });
    isOwner.mockReturnValue(false);

    const { GET } = await import("../src/app/api/pulse/route");
    await GET(pulseReq());
    expect(countActive).toHaveBeenLastCalledWith("user-a");

    currentUser.mockReturnValue({ id: "user-b" });
    await GET(pulseReq());
    expect(countActive).toHaveBeenLastCalledWith("user-b");
    expect(countActive).toHaveBeenCalledTimes(2);

    currentUser.mockReturnValue(null);
    isOwner.mockReturnValue(true);
  });
});

describe("/api/system/health blocking work", () => {
  beforeEach(() => {
    vi.resetModules();
    sync.execSync.mockClear();
    sync.spawnSync.mockClear();
    sync.execFileSync.mockClear();
  });

  it("reports disk usage without a synchronous subprocess", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ models: [] }) })));

    const { GET } = await import("../src/app/api/system/health/route");
    const body = await (await GET()).json();

    // execSync("df …") froze the event loop for the whole subprocess,
    // stalling the chat stream and every concurrent poll behind it.
    expect(sync.execSync).not.toHaveBeenCalled();
    expect(sync.spawnSync).not.toHaveBeenCalled();
    expect(sync.execFileSync).not.toHaveBeenCalled();
    expect(body.disk.total).toBeGreaterThan(0);
    expect(body.disk.used).toBeGreaterThan(0);

    vi.unstubAllGlobals();
  });

  it("serves concurrent pollers from one snapshot", async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({ models: [] }) }));
    vi.stubGlobal("fetch", fetchSpy);

    const { GET } = await import("../src/app/api/system/health/route");
    const [a, b, c] = await Promise.all([GET(), GET(), GET()]);
    const bodies = await Promise.all([a.json(), b.json(), c.json()]);

    // One Ollama probe, and identical timestamps prove a shared snapshot.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(bodies[0].timestamp).toBe(bodies[1].timestamp);
    expect(bodies[1].timestamp).toBe(bodies[2].timestamp);
    expect(bodies[0].disk.total).toBeGreaterThan(0);

    vi.unstubAllGlobals();
  });
});

describe("cached binary lookup", () => {
  it("resolves from PATH without spawning a shell, and memoizes", async () => {
    const { which, whichSync, clearWhichCache } = await import("../src/lib/sys/which");
    clearWhichCache();

    // `sh` exists on every POSIX box the app supports.
    const found = await which("sh");
    expect(found).toMatch(/\/sh$/);
    // Second call is a cache hit and must agree.
    expect(await which("sh")).toBe(found);
    expect(whichSync("sh")).toBe(found);

    expect(await which("definitely-not-a-real-binary-xyz")).toBeNull();
  });

  it("probes voice capabilities without a synchronous subprocess", async () => {
    vi.resetModules();
    sync.spawnSync.mockClear();

    const { GET } = await import("../src/app/api/voice/stt/route");
    const body = await (await GET()).json();

    // Each `which()` used to spawn a bash shell, twice per probe and again
    // per transcription request.
    expect(sync.spawnSync).not.toHaveBeenCalled();
    expect(body).toHaveProperty("ready");
    expect(body).toHaveProperty("ffmpeg_path");
  });
});
