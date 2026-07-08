import { describe, it, expect } from "vitest";
import { isLoopbackRequest } from "../src/lib/auth/loopback";

function headersFrom(h: Record<string, string>) {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) lower[k.toLowerCase()] = v;
  return (name: string) => lower[name.toLowerCase()] ?? null;
}

describe("isLoopbackRequest", () => {
  it("accepts a direct localhost request with no proxy headers", () => {
    expect(isLoopbackRequest(headersFrom({ host: "localhost:3000" }))).toBe(true);
    expect(isLoopbackRequest(headersFrom({ host: "127.0.0.1:3000" }))).toBe(true);
    expect(isLoopbackRequest(headersFrom({ host: "[::1]:3000" }))).toBe(true);
  });

  it("accepts the x-forwarded-* headers Next.js injects for local requests", () => {
    // These are exactly what Next.js adds for a genuine 127.0.0.1 request.
    expect(
      isLoopbackRequest(
        headersFrom({
          host: "127.0.0.1:3000",
          "x-forwarded-for": "::ffff:127.0.0.1",
          "x-forwarded-host": "127.0.0.1:3000",
          "x-forwarded-proto": "http",
        })
      )
    ).toBe(true);
    expect(
      isLoopbackRequest(
        headersFrom({
          host: "localhost:3000",
          "x-forwarded-for": "127.0.0.1",
          "x-forwarded-host": "localhost:3000",
        })
      )
    ).toBe(true);
  });

  it("rejects look-alike hostnames the old startsWith check accepted", () => {
    expect(isLoopbackRequest(headersFrom({ host: "localhost.evil.com" }))).toBe(false);
    expect(isLoopbackRequest(headersFrom({ host: "127.0.0.1.attacker.net" }))).toBe(false);
  });

  it("rejects requests relayed through a proxy or tunnel even if Host says localhost", () => {
    expect(
      isLoopbackRequest(headersFrom({ host: "localhost:3000", "x-forwarded-for": "1.2.3.4" }))
    ).toBe(false);
    expect(
      isLoopbackRequest(headersFrom({ host: "localhost", "cf-connecting-ip": "1.2.3.4" }))
    ).toBe(false);
    expect(
      isLoopbackRequest(headersFrom({ host: "localhost", "x-forwarded-host": "app.example.com" }))
    ).toBe(false);
  });

  it("rejects a remote host", () => {
    expect(isLoopbackRequest(headersFrom({ host: "10.0.0.4:3000" }))).toBe(false);
    expect(isLoopbackRequest(headersFrom({}))).toBe(false);
  });
});
