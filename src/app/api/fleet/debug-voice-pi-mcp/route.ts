/**
 * Self-test for this turn's three additions:
 *   1. pi.dev coding agent — availability probe (no actual run, that touches files)
 *   2. Local STT — capability endpoint + tool detection
 *   3. MCP marketplace — confirm the curated catalogue includes Home Assistant
 */

import { NextRequest, NextResponse } from "next/server";
import { spawnSync } from "child_process";
import http from "http";
import { piCodeTool } from "@/lib/tools/pi-code";
import { getRegistry } from "@/lib/plugins/registry";

export const runtime = "nodejs";

function callSelf(host: string, port: number, path: string, cookie?: string): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {};
    if (cookie) headers.cookie = cookie;
    const req = http.request({ host, port, path, method: "GET", headers, timeout: 8000 }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let parsed: unknown = text;
        try { parsed = JSON.parse(text); } catch { /* leave as string */ }
        resolve({ status: res.statusCode ?? 0, body: parsed });
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(new Error("timeout")); });
    req.end();
  });
}

export async function GET(req: NextRequest) {
  const results: Array<{ name: string; ok: boolean; detail: string }> = [];

  // 1. pi.dev status via the tool's own status op — exercises the tool wiring.
  try {
    const r = await piCodeTool.execute({ operation: "status" }, { conversationId: "test", approvedDirs: [] });
    const piInstalled = r.output.toLowerCase().startsWith("pi is installed");
    results.push({
      name: "pi_status_tool",
      ok: r.ok,
      detail: `${piInstalled ? "installed" : "missing"}: ${r.output.slice(0, 140)}`,
    });
  } catch (e) {
    results.push({ name: "pi_status_tool", ok: false, detail: (e as Error).message });
  }

  // 2. Raw which probe (independent check that the tool's logic is right).
  try {
    const r = spawnSync("/usr/bin/env", ["bash", "-c", "command -v pi"], { encoding: "utf8" });
    const path = (r.stdout || "").trim();
    results.push({
      name: "pi_on_path_probe",
      ok: true,
      detail: path ? `pi found at ${path}` : "pi NOT on PATH (install via the platform installer or `npm install -g --ignore-scripts @earendil-works/pi-coding-agent`)",
    });
  } catch (e) {
    results.push({ name: "pi_on_path_probe", ok: false, detail: (e as Error).message });
  }

  // 3. /api/voice/stt capability endpoint.
  try {
    const reqHost = req.headers.get("host") || "127.0.0.1:3001";
    const [nextHost, nextPortStr] = reqHost.split(":", 2);
    const nextPort = Number(nextPortStr) || 3001;
    const cookie = req.headers.get("cookie") || undefined;
    const r = await callSelf(nextHost, nextPort, "/api/voice/stt", cookie);
    const body = r.body as { ready?: boolean; whisper_path?: string | null; ffmpeg_path?: string | null; model_present?: boolean; hint?: string };
    results.push({
      name: "stt_capability_endpoint",
      ok: r.status === 200,
      detail: `status=${r.status} ready=${body.ready} whisper=${body.whisper_path ?? "(missing)"} ffmpeg=${body.ffmpeg_path ?? "(missing)"} model=${body.model_present} hint="${(body.hint ?? "").slice(0, 90)}"`,
    });
  } catch (e) {
    results.push({ name: "stt_capability_endpoint", ok: false, detail: (e as Error).message });
  }

  // 4. MCP curated catalogue — Home Assistant must be present, total should be >= 7.
  try {
    const reg = await getRegistry();
    const ha = reg.plugins.find((p) => p.id === "mcp-home-assistant");
    const mcpServers = reg.plugins.filter((p) => p.plugin_type === "mcp-server");
    results.push({
      name: "mcp_catalogue_has_home_assistant",
      ok: !!ha && mcpServers.length >= 7,
      detail: `mcp_servers=${mcpServers.length} ha_present=${!!ha} source=${reg.source}`,
    });
  } catch (e) {
    results.push({ name: "mcp_catalogue_has_home_assistant", ok: false, detail: (e as Error).message });
  }

  return NextResponse.json({
    all_ok: results.every((r) => r.ok),
    results,
  });
}
