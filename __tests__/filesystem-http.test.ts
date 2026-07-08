import { describe, it, expect } from "vitest";
import { filesystemTool } from "../src/lib/tools/filesystem";

describe("filesystem URL rejection", () => {
  it("refuses http(s) paths and points at read_secure_webpage", async () => {
    const result = await filesystemTool.execute(
      { operation: "read", path: "https://report.technation.io/" },
      { conversationId: "t", approvedDirs: ["/tmp"] }
    );
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/read_secure_webpage/);
    expect(result.summary).toMatch(/rejected http/i);
  });
});
