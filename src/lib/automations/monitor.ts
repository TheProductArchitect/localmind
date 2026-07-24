import fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import { getMonitor, recordMonitorCheck, updateMonitorCheckConfig, type Monitor } from "../db/automations";
import { deliver } from "../workflow/deliver";
import { runWorkflow } from "../workflow/executor";
import { logger } from "../logger";
import { fetchPageContentHash, pageContentChangeResult } from "./page-content";

const exec = promisify(execFile);

// Returns true when the watched condition is currently met.
async function evaluate(monitor: Monitor): Promise<{
  triggered: boolean;
  detail: string;
  mtimeMs?: number;
  pageHash?: string;
  pageError?: boolean;
}> {
  const cfg = JSON.parse(monitor.check_config || "{}");
  switch (monitor.check_type) {
    case "url_reachable": {
      try {
        const r = await fetch(cfg.url, { signal: AbortSignal.timeout(8000) });
        return { triggered: r.ok, detail: `HTTP ${r.status}` };
      } catch {
        return { triggered: false, detail: "unreachable" };
      }
    }
    case "url_unreachable": {
      try {
        await fetch(cfg.url, { signal: AbortSignal.timeout(8000) });
        return { triggered: false, detail: "reachable" };
      } catch {
        return { triggered: true, detail: "unreachable" };
      }
    }
    case "file_change": {
      try {
        const stat = fs.statSync(cfg.path);
        const baseline = typeof cfg.lastMtime === "number" ? cfg.lastMtime : null;
        const changed = baseline !== null && stat.mtimeMs > baseline;
        return { triggered: changed, detail: `mtime ${stat.mtimeMs}`, mtimeMs: stat.mtimeMs };
      } catch {
        return { triggered: false, detail: "missing" };
      }
    }
    case "shell": {
      try {
        await exec("sh", ["-c", cfg.command], { timeout: 15000 });
        return { triggered: true, detail: "exit 0" };
      } catch (e: any) {
        return { triggered: false, detail: `exit ${e?.code ?? "?"}` };
      }
    }
    case "page_content_change": {
      const fetched = await fetchPageContentHash({
        url: cfg.url,
        selector: cfg.selector,
        hash: cfg.hash,
      });
      if (!fetched.ok) {
        return { triggered: false, detail: fetched.detail, pageError: true };
      }
      const { triggered } = pageContentChangeResult(cfg.hash, fetched.hash);
      return {
        triggered,
        detail: fetched.detail,
        pageHash: fetched.hash,
      };
    }
    default:
      return { triggered: false, detail: "unknown check type" };
  }
}

export async function runMonitor(monitorId: string): Promise<{ status: string }> {
  const monitor = getMonitor(monitorId);
  if (!monitor || !monitor.enabled) return { status: "skipped" };
  const cfg = JSON.parse(monitor.check_config || "{}");
  const { triggered, detail, mtimeMs, pageHash, pageError } = await evaluate(monitor);

  if (pageError) {
    recordMonitorCheck(monitorId, "error");
    logger.warn("monitor page_content_change error", { monitor: monitor.name, detail });
    return { status: "error" };
  }

  const status = triggered ? "triggered" : "ok";

  // Persist file mtime baseline after every check so file_change monitors work.
  if (monitor.check_type === "file_change" && typeof mtimeMs === "number") {
    updateMonitorCheckConfig(monitorId, { ...cfg, path: cfg.path, lastMtime: mtimeMs });
  }

  // Seed / update page content hash after every successful check.
  if (monitor.check_type === "page_content_change" && pageHash) {
    updateMonitorCheckConfig(monitorId, {
      ...cfg,
      url: cfg.url,
      selector: cfg.selector,
      hash: pageHash,
    });
  }

  // Fire only on a transition into the triggered state.
  if (triggered && monitor.last_status !== "triggered") {
    logger.info("monitor triggered", { monitor: monitor.name });
    if (monitor.trigger_workflow_id) {
      runWorkflow(monitor.trigger_workflow_id).catch(() => {});
    } else {
      await deliver("browser", `Monitor "${monitor.name}" triggered: ${detail}`);
    }
  }
  recordMonitorCheck(monitorId, status);
  return { status };
}
