import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { internalToken, isInternalRequest } from "../src/lib/internal-auth";

function makeReq(headers: Record<string, string>): NextRequest {
  return new NextRequest("http://127.0.0.1:3000/api/internal/run-task", {
    method: "POST",
    headers,
  });
}

describe("isInternalRequest", () => {
  const prev = process.env.LOCALMIND_INTERNAL_TOKEN;

  beforeEach(() => {
    process.env.LOCALMIND_INTERNAL_TOKEN = "test-internal-secret";
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.LOCALMIND_INTERNAL_TOKEN;
    else process.env.LOCALMIND_INTERNAL_TOKEN = prev;
  });

  it("accepts loopback request with valid token", () => {
    const req = makeReq({
      host: "127.0.0.1:3000",
      "x-localmind-internal": internalToken(),
    });
    expect(isInternalRequest(req)).toBe(true);
  });

  it("rejects valid token from non-loopback host", () => {
    const req = makeReq({
      host: "app.example.com",
      "x-localmind-internal": internalToken(),
    });
    expect(isInternalRequest(req)).toBe(false);
  });

  it("rejects loopback request with wrong token", () => {
    const req = makeReq({
      host: "localhost:3000",
      "x-localmind-internal": "wrong",
    });
    expect(isInternalRequest(req)).toBe(false);
  });

  it("rejects proxied localhost (tunnel) even with valid token", () => {
    const req = makeReq({
      host: "localhost:3000",
      "x-forwarded-for": "203.0.113.1",
      "x-localmind-internal": internalToken(),
    });
    expect(isInternalRequest(req)).toBe(false);
  });
});
