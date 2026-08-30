import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Pairing reported only "Fleet listener is not running", with a guessed cause,
 * and the accept path blamed "both devices" for a purely local check. The
 * reason was written to a log file and nowhere else, so the user had no way to
 * tell a missing openssl from an occupied port.
 */

const { opensslAvailable, getTlsMaterial, listen } = vi.hoisted(() => ({
  opensslAvailable: vi.fn(() => true),
  getTlsMaterial: vi.fn(() => ({
    cert_pem: "cert",
    key_pem: "key",
    fingerprint_sha256: "abc123",
  })),
  listen: vi.fn(),
}));

vi.mock("../src/lib/fleet/tls", () => ({ opensslAvailable, getTlsMaterial }));
vi.mock("node:https", () => ({
  default: {
    createServer: () => ({
      listen,
      once: vi.fn(),
      off: vi.fn(),
      close: vi.fn(),
    }),
  },
}));
vi.mock("https", () => ({
  default: {
    createServer: () => ({
      listen,
      once: vi.fn(),
      off: vi.fn(),
      close: vi.fn(),
    }),
  },
}));

async function freshServerModule() {
  // The listener singleton is pinned on globalThis to survive Next's module
  // boundaries, so it must be cleared between cases.
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("localmind.fleet.server")];
  vi.resetModules();
  return import("../src/lib/fleet/server");
}

describe("fleet listener failure reporting", () => {
  beforeEach(() => {
    opensslAvailable.mockReturnValue(true);
    listen.mockReset();
  });

  afterEach(() => {
    delete (globalThis as Record<symbol, unknown>)[Symbol.for("localmind.fleet.server")];
  });

  it("names missing openssl instead of guessing", async () => {
    opensslAvailable.mockReturnValue(false);
    const m = await freshServerModule();

    await expect(m.startFleetServer()).rejects.toThrow(/openssl is not installed/i);

    expect(m.isRunning()).toBe(false);
    const status = m.fleetListenerStatus();
    expect(status.running).toBe(false);
    expect(status.last_error?.message).toMatch(/openssl is not installed/i);
    expect(m.listenerDownMessage()).toMatch(/openssl is not installed/i);
  });

  it("explains an occupied port and how to change it", async () => {
    listen.mockImplementation(() => {
      throw Object.assign(new Error("listen EADDRINUSE"), { code: "EADDRINUSE" });
    });
    const m = await freshServerModule();

    await expect(m.startFleetServer({ port: 9443 })).rejects.toThrow(/already in use/i);
    expect(m.listenerDownMessage()).toMatch(/LOCALMIND_FLEET_PORT/);
  });

  it("does not report a listener as running after the bind fails", async () => {
    listen.mockImplementation(() => {
      throw Object.assign(new Error("listen EADDRINUSE"), { code: "EADDRINUSE" });
    });
    const m = await freshServerModule();

    await expect(m.startFleetServer({ port: 9443 })).rejects.toThrow();

    // Previously the server object was left assigned while port stayed null,
    // so isRunning() returned true for a socket that never listened.
    expect(m.isRunning()).toBe(false);
    expect(m.activeFleetPort()).toBeNull();
  });

  it("surfaces a permission failure distinctly from a busy port", async () => {
    listen.mockImplementation(() => {
      throw Object.assign(new Error("listen EACCES"), { code: "EACCES" });
    });
    const m = await freshServerModule();

    await expect(m.startFleetServer({ port: 443 })).rejects.toThrow(/permission denied/i);
  });

  it("clears the recorded failure once the listener comes up", async () => {
    listen.mockImplementationOnce(() => {
      throw Object.assign(new Error("listen EADDRINUSE"), { code: "EADDRINUSE" });
    });
    const m = await freshServerModule();
    await expect(m.startFleetServer({ port: 9443 })).rejects.toThrow();
    expect(m.fleetListenerStatus().last_error).not.toBeNull();

    listen.mockImplementation((_port: number, _host: string, cb: () => void) => cb());
    const ok = await m.startFleetServer({ port: 9444 });

    expect(ok.port).toBe(9444);
    expect(m.isRunning()).toBe(true);
    expect(m.fleetListenerStatus().last_error).toBeNull();
  });

  it("admits when it has no recorded reason rather than blaming openssl", async () => {
    const m = await freshServerModule();
    // Never started, so nothing failed yet.
    expect(m.isRunning()).toBe(false);
    const msg = m.listenerDownMessage();
    expect(msg).toMatch(/no startup error was recorded/i);
    expect(msg).not.toMatch(/openssl/i);
  });
});

/**
 * Pairing brings the listener up on demand, so a boot-time failure that has
 * since cleared (stale cert regenerated, port freed) no longer requires an
 * app restart before the user can pair.
 */
describe("ensureFleetListener", () => {
  beforeEach(() => {
    opensslAvailable.mockReturnValue(true);
    listen.mockReset();
    listen.mockImplementation((_p: number, _h: string, cb: () => void) => cb());
  });

  afterEach(() => {
    delete (globalThis as Record<symbol, unknown>)[Symbol.for("localmind.fleet.server")];
  });

  it("starts a listener that was not running", async () => {
    const m = await freshServerModule();
    expect(m.isRunning()).toBe(false);

    await expect(m.ensureFleetListener()).resolves.toEqual({ ok: true });
    expect(m.isRunning()).toBe(true);
  });

  it("is a no-op when the listener is already up", async () => {
    const m = await freshServerModule();
    await m.ensureFleetListener();
    const port = m.activeFleetPort();
    listen.mockClear();

    await expect(m.ensureFleetListener()).resolves.toEqual({ ok: true });

    expect(listen).not.toHaveBeenCalled();
    expect(m.activeFleetPort()).toBe(port);
  });

  it("returns the real reason instead of throwing", async () => {
    opensslAvailable.mockReturnValue(false);
    const m = await freshServerModule();

    const r = await m.ensureFleetListener();

    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/openssl is not installed/i);
    // The same reason must reach the message pairing shows the user.
    expect(m.listenerDownMessage()).toMatch(/openssl is not installed/i);
  });

  it("reports a busy port without leaving a half-open listener", async () => {
    listen.mockImplementation(() => {
      throw Object.assign(new Error("listen EADDRINUSE"), { code: "EADDRINUSE" });
    });
    const m = await freshServerModule();

    const r = await m.ensureFleetListener();

    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/already in use/i);
    expect(m.isRunning()).toBe(false);
  });
});
