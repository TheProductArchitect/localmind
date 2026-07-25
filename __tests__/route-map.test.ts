import { describe, it, expect } from "vitest";
import { requiredRoleFor, roleSatisfies } from "../src/lib/auth/route-map";

describe("route-map HIGH fixes", () => {
  it("requires owner for knowledge share-policy (not shadowed by /api/knowledge/*)", () => {
    expect(requiredRoleFor("/api/knowledge/share-policy", "GET")).toBe("owner");
    expect(requiredRoleFor("/api/knowledge/share-policy/doc-1", "PUT")).toBe("owner");
    expect(requiredRoleFor("/api/knowledge/share-policy/doc-1", "DELETE")).toBe("owner");
  });

  it("keeps peer-search and other knowledge routes authenticated", () => {
    expect(requiredRoleFor("/api/knowledge/peer-search", "POST")).toBe("authenticated");
    expect(requiredRoleFor("/api/knowledge/documents", "GET")).toBe("authenticated");
  });

  it("lets guest satisfy authenticated but not member/owner", () => {
    expect(roleSatisfies("guest", "authenticated")).toBe(true);
    expect(roleSatisfies("guest", "public")).toBe(true);
    expect(roleSatisfies("guest", "member")).toBe(false);
    expect(roleSatisfies("guest", "owner")).toBe(false);
  });

  it("requires authenticated for fleet chat relay and remote confirm decisions", () => {
    expect(requiredRoleFor("/api/fleet/peers/node-1/chat", "POST")).toBe("authenticated");
    expect(requiredRoleFor("/api/fleet/peers/node-1/confirm", "POST")).toBe("authenticated");
  });
});
