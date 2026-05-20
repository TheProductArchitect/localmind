import { NextRequest } from "next/server";
import { getUser, getOwner, type User } from "../db/users";

// Resolves the authenticated user from the headers the middleware sets.
// The "__localhost_owner__" sentinel (localhost auto-login) maps to the owner.
export function currentUser(req: NextRequest): User | null {
  const id = req.headers.get("x-user-id");
  if (!id) return null;
  if (id === "__localhost_owner__") return getOwner();
  return getUser(id);
}

export function currentRole(req: NextRequest): string {
  return req.headers.get("x-user-role") || "";
}

export function currentUserId(req: NextRequest): string | null {
  return currentUser(req)?.id ?? null;
}

export function isOwner(req: NextRequest): boolean {
  return currentRole(req) === "owner";
}
