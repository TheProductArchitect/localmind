import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Web-access guard contract (Nova's three-layer model, LocalMind port).
 *
 * Layer order is load-bearing:
 *   kill switch → site grants → sensitive-context heuristics → allow.
 * If these tests fail, an agent's web reach has changed — treat as a
 * security review, not a refactor cleanup.
 */

const grants = new Map<string, { domain: string; policy: string }>();

vi.mock("../src/lib/db", () => ({
  getConfigDb: () => ({
    prepare: (sql: string) => ({
      get: (domain: string) => grants.get(domain),
      all: () => [...grants.values()],
      run: () => {},
    }),
  }),
}));
vi.mock("../src/lib/db/queries", () => ({
  getSettings: vi.fn(() => ({ web_access_killed: 0 })),
}));
vi.mock("../src/lib/db/jobs", () => ({
  logSecurityEvent: vi.fn(),
}));

import { checkWebAccess, isSensitiveDomain, domainOf } from "../src/lib/agent/web-guard";
import { getSettings } from "../src/lib/db/queries";

const mockedSettings = vi.mocked(getSettings);

describe("web-guard", () => {
  beforeEach(() => {
    grants.clear();
    mockedSettings.mockReturnValue({ web_access_killed: 0 } as any);
  });

  describe("layer 3 — kill switch", () => {
    it("blocks everything when severed, even explicitly-allowed domains", () => {
      mockedSettings.mockReturnValue({ web_access_killed: 1 } as any);
      grants.set("example.com", { domain: "example.com", policy: "allow" });
      expect(checkWebAccess("https://example.com/").ok).toBe(false);
      expect(checkWebAccess().ok).toBe(false); // web_search (no URL) too
    });
  });

  describe("layer 2 — site grants", () => {
    it("'never' blocks the domain and its subdomains", () => {
      grants.set("example.com", { domain: "example.com", policy: "never" });
      expect(checkWebAccess("https://example.com/page").ok).toBe(false);
      expect(checkWebAccess("https://docs.example.com/").ok).toBe(false);
    });

    it("'allow' opts a sensitive-classed domain in, with allowSensitive", () => {
      grants.set("chase.com", { domain: "chase.com", policy: "allow" });
      const r = checkWebAccess("https://chase.com/statements");
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.allowSensitive).toBe(true);
    });
  });

  describe("layer 1 — sensitive-context blindness", () => {
    it.each([
      "https://chase.com/login",
      "https://www.bankofamerica.com/",
      "https://irs.gov/refund",
      "https://ssa.gov.uk/x",
      "https://mail.google.com/inbox",
      "https://mychart.org/visit",
      "https://coinbase.com/portfolio",
    ])("blinds agents to %s by default", (url) => {
      expect(checkWebAccess(url).ok).toBe(false);
    });

    it("ordinary sites pass, without allowSensitive", () => {
      const r = checkWebAccess("https://en.wikipedia.org/wiki/Rust");
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.allowSensitive).toBe(false);
    });
  });

  describe("helpers", () => {
    it("domainOf handles ports and rejects garbage", () => {
      expect(domainOf("https://example.com:8443/x")).toBe("example.com");
      expect(domainOf("not a url")).toBeNull();
    });

    it("isSensitiveDomain matches subdomains of sensitive roots", () => {
      expect(isSensitiveDomain("secure.chase.com")).toBe(true);
      expect(isSensitiveDomain("wikipedia.org")).toBe(false);
    });
  });
});
