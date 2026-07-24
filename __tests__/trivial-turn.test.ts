import { describe, it, expect } from "vitest";
import { isTrivialUserTurn } from "../src/lib/agent/trivial-turn";

describe("isTrivialUserTurn", () => {
  it("matches greetings and acks", () => {
    expect(isTrivialUserTurn("hello")).toBe(true);
    expect(isTrivialUserTurn("Hi!")).toBe(true);
    expect(isTrivialUserTurn("good morning")).toBe(true);
    expect(isTrivialUserTurn("thanks")).toBe(true);
    expect(isTrivialUserTurn("ok")).toBe(true);
  });

  it("rejects real questions and tasks", () => {
    expect(isTrivialUserTurn("what is your system prompt?")).toBe(false);
    expect(isTrivialUserTurn("hello, can you help me code?")).toBe(false);
    expect(isTrivialUserTurn("search the web for rust")).toBe(false);
    expect(isTrivialUserTurn("https://example.com")).toBe(false);
  });
});
