/**
 * Unipile webhook auth — secret required; unsigned rejected.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/lib/db/channels", () => ({
  getChannel: vi.fn(),
}));

vi.mock("../src/lib/channels/unipile", () => ({
  verifyUnipileSignature: vi.fn((secret: string, sig: string) => secret === "sekrit" && sig === "ok"),
  unipileProcessInbound: vi.fn(async () => {}),
}));

vi.mock("../src/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { getChannel } from "../src/lib/db/channels";
import { verifyUnipileSignature, unipileProcessInbound } from "../src/lib/channels/unipile";
import { POST } from "../src/app/api/channels/unipile/webhook/route";

function req(body: string, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/channels/unipile/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  }) as any;
}

describe("unipile webhook auth", () => {
  beforeEach(() => {
    vi.mocked(getChannel).mockReset();
    vi.mocked(verifyUnipileSignature).mockClear();
    vi.mocked(unipileProcessInbound).mockClear();
  });

  it("rejects when channel disabled", async () => {
    vi.mocked(getChannel).mockReturnValue({ enabled: false, config: {} });
    const r = await POST(req("{}"));
    expect(r.status).toBe(403);
  });

  it("rejects when enabled but webhookSecret missing", async () => {
    vi.mocked(getChannel).mockReturnValue({ enabled: true, config: { apiKey: "k" } });
    const r = await POST(req("{}"));
    expect(r.status).toBe(503);
    expect(unipileProcessInbound).not.toHaveBeenCalled();
  });

  it("rejects bad signature", async () => {
    vi.mocked(getChannel).mockReturnValue({
      enabled: true,
      config: { webhookSecret: "sekrit" },
    });
    const r = await POST(req("{}", { "x-unipile-signature": "bad" }));
    expect(r.status).toBe(401);
    expect(unipileProcessInbound).not.toHaveBeenCalled();
  });

  it("accepts valid signature", async () => {
    vi.mocked(getChannel).mockReturnValue({
      enabled: true,
      config: { webhookSecret: "sekrit" },
    });
    const r = await POST(req('{"data":{"text":"hi","chat_id":"c1"}}', { "x-unipile-signature": "ok" }));
    expect(r.status).toBe(200);
    expect(unipileProcessInbound).toHaveBeenCalled();
  });
});
