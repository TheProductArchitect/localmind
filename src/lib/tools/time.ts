/**
 * time — current date / time / timezone / platform.
 *
 * A compact clock also lives in the `date_context` system-prompt block.
 * Prefer that for ordinary turns; use this tool when the ask actually
 * depends on a fresh timestamp (explicit clock questions, scheduling).
 *
 * Always allowed (read-shaped action type).
 */

import type { Tool } from "./types";
import { describePlatform } from "../platform";

export const timeTool: Tool = {
  actionType: "read_time",
  classify: () => "read_time",
  preview: () => "Get the current date, time, and timezone",
  version: "1",
  // Cacheable only within a single turn — but we want fresh data every turn,
  // so we mark it non-cacheable to avoid stale "today" across conversations.
  cacheable: () => false,
  definition: {
    name: "time",
    description:
      "Current date, time, timezone, and platform. Contract: use when the user's ask depends on a precise/fresh clock (e.g. \"what time is it?\", scheduling). When a Context block already has local time and the ask does not need the clock, prefer answering without this tool. Example good: \"remind me in 20 minutes\". Example unnecessary: a greeting where time is already in context.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  async execute() {
    const now = new Date();
    const iso = now.toISOString();
    const local = now.toString();
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][now.getDay()];
    const hour = now.getHours();
    const part_of_day =
      hour < 5  ? "late night" :
      hour < 12 ? "morning"    :
      hour < 17 ? "afternoon"  :
      hour < 21 ? "evening"    : "night";
    const payload = {
      iso,
      local,
      timezone: tz,
      weekday,
      weekday_index: now.getDay(),
      hour_24: hour,
      part_of_day,
      platform: describePlatform(),
    };
    return {
      ok: true,
      output: JSON.stringify(payload, null, 2),
      summary: `${weekday} ${iso.slice(0, 10)} ${iso.slice(11, 16)} ${tz} · ${part_of_day}`,
    };
  },
};
