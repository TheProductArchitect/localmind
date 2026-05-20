import fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import { getMonitor, recordMonitorCheck, type Monitor } from "../db/automations";
import { deliver } from "../workflow/deliver";
import { runWorkflow } from "../workflow/executor";
import { logger } from "../logger";

const exec = promisify(execFile);

// Returns true when the watched condition is currently met.
async function evaluate(monitor: Monitor): Promise<{ triggered: boolean; detail: string }> {
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
        const changed = cfg.lastMtime && stat.mtimeMs > cfg.lastMtime;
        return { triggered: !!changed, detail: `mtime ${stat.mtimeMs}` };
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
    default:
      return { triggered: false, detail: "unknown check type" };
  }
}

export async function runMonitor(monitorId: string): Promise<{ status: string }> {
  const monitor = getMonitor(monitorId);
  if (!monitor || !monitor.enabled) return { status: "skipped" };
  const { triggered, detail } = await evaluate(monitor);
  const status = triggered ? "triggered" : "ok";

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
