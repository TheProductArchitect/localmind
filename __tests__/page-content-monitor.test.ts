import { describe, it, expect } from "vitest";
import {
  pageContentChangeResult,
  normalizePageText,
  hashPageText,
} from "../src/lib/automations/page-content";
import { stepsNeedConfirm } from "../src/lib/tools/manage-workflow";
import { WORKFLOW_TEMPLATES } from "../src/lib/workflow/templates";

describe("page_content_change monitor logic", () => {
  it("does not trigger on first seed", () => {
    expect(pageContentChangeResult(undefined, "abc")).toEqual({ triggered: false, seeded: true });
    expect(pageContentChangeResult(null, "abc")).toEqual({ triggered: false, seeded: true });
  });

  it("does not trigger when hash unchanged", () => {
    expect(pageContentChangeResult("abc", "abc")).toEqual({ triggered: false, seeded: false });
  });

  it("triggers when hash changes", () => {
    expect(pageContentChangeResult("abc", "def")).toEqual({ triggered: true, seeded: false });
  });

  it("hashes normalized text stably", () => {
    const a = hashPageText(normalizePageText("Hello   world\n\n"));
    const b = hashPageText(normalizePageText("Hello world"));
    expect(a).toBe(b);
  });
});

describe("manage_workflow confirm classification", () => {
  it("flags email notify and browser tool steps", () => {
    expect(stepsNeedConfirm([{ type: "notify", channel: "email", message: "hi" } as any])).toBe(true);
    expect(stepsNeedConfirm([{ type: "tool", tool: "browser", input: {} } as any])).toBe(true);
    expect(stepsNeedConfirm([{ type: "agent", prompt: "hello" } as any])).toBe(false);
  });
});

describe("workflow templates", () => {
  it("includes v3 personal-assistant templates", () => {
    const ids = WORKFLOW_TEMPLATES.map((t) => t.id);
    expect(ids).toContain("url-watch-digest");
    expect(ids).toContain("daily-scrape-digest");
    expect(ids).toContain("email-reminder");
    expect(ids).toContain("morning-ops-brief");
  });
});
