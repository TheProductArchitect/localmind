/**
 * request_tool_access — the escape hatch a subagent uses when its narrow
 * tool surface doesn't cover what it's been asked to do.
 *
 * Design choice: instead of pausing the subagent and bouncing a confirmation
 * up to the parent conversation (cross-conversation messaging is fiddly and
 * fragile), this tool returns a structured "I need X" payload. The subagent
 * is expected to use the payload as its FINAL output for the run — it gives
 * up cleanly with a request. The parent Sora reads the payload, decides
 * whether the ask is reasonable, and either:
 *
 *   (a) re-spawns the subagent with the broader tool set, OR
 *   (b) handles the work herself with her own tools, OR
 *   (c) tells the user why the work can't proceed.
 *
 * This keeps the subagent boundary clean: the subagent never gains access
 * mid-run; the parent always decides on tool surface.
 *
 * The tool is auto-added to every subagent's allowed surface by the engine
 * (see engine.ts where the allowedSet is constructed). The main Sora chat
 * sees it too but rarely needs to call it — she has the full registry.
 */

import type { Tool } from "./types";

export const requestToolAccessTool: Tool = {
  actionType: "memory_read",
  classify: () => "memory_read",
  preview: (i) =>
    `Ask the parent agent for access to: ${Array.isArray(i.tools) ? (i.tools as string[]).join(", ") : "(unspecified)"}`,
  version: "1",
  cacheable: () => false,
  definition: {
    name: "request_tool_access",
    description:
      "SUBAGENT ONLY. Call when you cannot finish the assigned goal with your current allowed_tools. Ends your run with a structured request for the parent. Never call this if you already have the tools you need, and never call it from the main assistant chat (you already have the full registry).",
    parameters: {
      type: "object",
      properties: {
        tools: {
          type: "array",
          items: { type: "string" },
          description: "Tool names you need. Be specific — e.g. [\"email\", \"calendar\"], not [\"everything\"].",
        },
        reason: {
          type: "string",
          description: "Concrete reason this tool is needed for the current task. 1-2 sentences. The parent uses this to decide whether to grant.",
        },
        suggested_followup: {
          type: "string",
          description: "Optional. Goal you'd recommend the parent give a re-spawned subagent if access is granted.",
        },
      },
      required: ["tools", "reason"],
      additionalProperties: false,
    },
  },
  async execute(input) {
    // Small models often stringify arrays as "['email', 'calendar']" or
    // "email, calendar". Accept those shapes so a valid ask isn't rejected.
    let tools: string[] = [];
    if (Array.isArray(input.tools)) {
      tools = (input.tools as unknown[])
        .map((t) => (typeof t === "string" ? t : String(t ?? "")))
        .map((t) => t.trim())
        .filter(Boolean);
    } else if (typeof input.tools === "string") {
      const raw = input.tools.trim();
      try {
        const parsed = JSON.parse(raw.replace(/'/g, '"'));
        if (Array.isArray(parsed)) {
          tools = parsed.map((t) => String(t).trim()).filter(Boolean);
        }
      } catch {
        tools = raw
          .replace(/^\[|\]$/g, "")
          .split(/[,;\s]+/)
          .map((t) => t.replace(/^['"]|['"]$/g, "").trim())
          .filter(Boolean);
      }
    }
    tools = [...new Set(tools)].slice(0, 8);
    const reason = typeof input.reason === "string" ? input.reason.slice(0, 800) : "";
    const followup = typeof input.suggested_followup === "string" ? input.suggested_followup.slice(0, 800) : "";

    if (tools.length === 0 || !reason.trim()) {
      return {
        ok: false,
        output:
          "request_tool_access requires both `tools` (non-empty array of tool name strings) and `reason`. Example: tools=[\"email\",\"calendar\"], reason=\"Need to create an event and draft an invite\".",
      };
    }

    // The structured payload the parent Sora reads. We render it as JSON
    // inside a clear envelope so her system-prompt rules tell her what to
    // do next.
    const payload = {
      kind: "tool_access_request",
      requested_tools: tools,
      reason,
      ...(followup ? { suggested_followup: followup } : {}),
    };

    const text =
      `<tool_access_request>\n` +
      JSON.stringify(payload, null, 2) +
      `\n</tool_access_request>\n\n` +
      `I'm stopping here. The work needs ${tools.length === 1 ? "the " + tools[0] + " tool" : "these tools: " + tools.join(", ")}, which I don't have. ` +
      `Parent agent: decide whether to grant + re-spawn, do this yourself, or tell the user we can't proceed.`;

    return {
      ok: true,
      output: text,
      summary: `Requested access to: ${tools.join(", ")}`,
    };
  },
};
