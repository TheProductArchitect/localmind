import type { Tool } from "./types";
import {
  getBrowseSessionForConversation,
  browseNavigate,
  browseAction,
  browseSnapshot,
} from "../browse/session";

export const browseSessionTool: Tool = {
  actionType: "browser_automation",
  classify: (input) => (String(input.operation || "") === "snapshot" ? "read_web" : "browser_automation"),
  preview: (input) => {
    const op = String(input.operation || "snapshot");
    if (op === "navigate") return `Browse → ${input.url}`;
    if (op === "click") return `Browse click (${input.x}, ${input.y})`;
    if (op === "type") return `Browse type`;
    return `Browse ${op}`;
  },
  version: "1",
  definition: {
    name: "browse_session",
    description:
      "Control the user's interactive Browse tab. Operations: snapshot, navigate (url), click (x,y), type (text), scroll (deltaY), back, forward, press (key). Only when the user is on /browse with a linked session.",
    parameters: {
      type: "object",
      properties: {
        operation: { type: "string", enum: ["snapshot", "navigate", "click", "type", "scroll", "back", "forward", "press"] },
        url: { type: "string" },
        x: { type: "number" },
        y: { type: "number" },
        text: { type: "string" },
        deltaY: { type: "number" },
        key: { type: "string" },
      },
      required: ["operation"],
    },
  },
  async execute(input, ctx) {
    const linked = getBrowseSessionForConversation(ctx.conversationId);
    if (!linked) {
      return { ok: false, output: "No Browse session linked. User must chat from the Sora panel on /browse.", summary: "no session" };
    }
    const op = String(input.operation || "snapshot");

    if (op === "snapshot") {
      const snap = await browseSnapshot(linked.id);
      if (!snap) return { ok: false, output: "Browse session expired." };
      return { ok: true, output: `URL: ${snap.url}\nTitle: ${snap.title}\n\n${snap.text.slice(0, 4000)}`, summary: "snapshot" };
    }
    if (op === "navigate") {
      const url = String(input.url || "").trim();
      if (!url) return { ok: false, output: "url required." };
      const nav = await browseNavigate(linked.id, url);
      if (!nav.ok) return { ok: false, output: nav.error || "failed" };
      const snap = await browseSnapshot(linked.id);
      return { ok: true, output: snap ? `${snap.url}\n\n${snap.text.slice(0, 2000)}` : "ok", summary: "navigate" };
    }
    if (op === "click") {
      const x = Number(input.x), y = Number(input.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, output: "x,y required." };
      const act = await browseAction(linked.id, { type: "click", x, y });
      if (!act.ok) return { ok: false, output: act.error || "failed" };
      const snap = await browseSnapshot(linked.id);
      return { ok: true, output: snap?.text.slice(0, 1500) || "clicked", summary: "click" };
    }
    if (op === "type") {
      const act = await browseAction(linked.id, { type: "type", text: String(input.text ?? "") });
      if (!act.ok) return { ok: false, output: act.error || "failed" };
      return { ok: true, output: "Typed.", summary: "type" };
    }
    if (op === "scroll") {
      await browseAction(linked.id, { type: "scroll", deltaY: Number(input.deltaY ?? 400) });
      return { ok: true, output: "Scrolled.", summary: "scroll" };
    }
    if (op === "back" || op === "forward") {
      await browseAction(linked.id, { type: op });
      const snap = await browseSnapshot(linked.id);
      return { ok: true, output: snap?.url || "ok", summary: op };
    }
    if (op === "press") {
      await browseAction(linked.id, { type: "press", key: String(input.key || "Enter") });
      return { ok: true, output: "Pressed key.", summary: "press" };
    }
    return { ok: false, output: `Unknown: ${op}` };
  },
};
