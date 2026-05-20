import { NextRequest } from "next/server";

const TOKEN = process.env.LOCALMIND_INTERNAL_TOKEN || "localmind-internal";

// Verifies a request came from the local background worker (loopback only).
export function isInternalRequest(req: NextRequest): boolean {
  return req.headers.get("x-localmind-internal") === TOKEN;
}
