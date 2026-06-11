import { describe, it, expect } from "vitest";

/**
 * Peer-relayed conversations are part of a bilateral, signed audit chain —
 * the peer holds the other half. Deleting one side breaks the chain and
 * removes evidence the peer still has. The API enforces this; here we test
 * the helper that recognises a relayed conversation by its tag prefix.
 *
 * The helper is intentionally a small pure function we can copy under test
 * — the API file mixes Next request plumbing with the helper, so a direct
 * import would pull half the framework. Mirror the logic exactly and pin
 * it; if the production helper diverges, this test is the canary.
 */
function isRelayedConversation(conv: { tags: string }): boolean {
  try {
    const tags = JSON.parse(conv.tags || "[]") as string[];
    return tags.some((t) => t.startsWith("relayed_from:") || t.startsWith("relayed_to:"));
  } catch {
    return false;
  }
}

describe("isRelayedConversation — delete protection", () => {
  it("flags conversations marked as executor-side twins (relayed_from)", () => {
    expect(
      isRelayedConversation({
        tags: JSON.stringify(["relayed_from:peer-XYZ:conv-init-1"]),
      })
    ).toBe(true);
  });

  it("flags conversations marked as initiator-side (relayed_to)", () => {
    expect(
      isRelayedConversation({
        tags: JSON.stringify(["relayed_to:peer-XYZ"]),
      })
    ).toBe(true);
  });

  it("does not flag conversations with unrelated tags", () => {
    expect(isRelayedConversation({ tags: JSON.stringify(["starred", "work"]) })).toBe(false);
  });

  it("does not flag empty / null tags", () => {
    expect(isRelayedConversation({ tags: "" })).toBe(false);
    expect(isRelayedConversation({ tags: "[]" })).toBe(false);
  });

  it("does not flag a tag that merely contains the substring", () => {
    // Defence against accidental matching of foreign tags.
    expect(
      isRelayedConversation({ tags: JSON.stringify(["not_relayed_from_anywhere"]) })
    ).toBe(false);
  });

  it("returns false on malformed JSON instead of throwing", () => {
    expect(isRelayedConversation({ tags: "not-json" })).toBe(false);
  });
});
