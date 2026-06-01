// Node-only startup hardening. Imported by instrumentation.ts only on the
// Node.js runtime so its node-builtin imports never reach the edge bundle.
import { logger } from "./lib/logger";
import { closeAllDbs, integrityCheck } from "./lib/db";

// Startup integrity check — never refuses to start, only warns.
try {
  for (const r of integrityCheck()) {
    if (!r.ok) logger.error(`database integrity warning: ${r.db}`, { detail: r.detail });
  }
} catch {}

// Reap zombie agent_processes that never completed (crashed run, kill -9, etc.).
try {
  const { reaper } = require("./lib/db/agent-processes") as typeof import("./lib/db/agent-processes");
  const cleaned = reaper();
  if (cleaned > 0) logger.info(`reaped ${cleaned} stale agent process row(s)`);
} catch (e) {
  logger.warn("agent_processes reaper skipped", { error: (e as Error).message });
}

// Re-enqueue any long-running jobs that were running when the app last shut down.
try {
  const { bootResumeOrphanedJobs } = require("./lib/agent/job-executor") as typeof import("./lib/agent/job-executor");
  const { enqueueJob } = require("./lib/db/jobs") as typeof import("./lib/db/jobs");
  const resumed = bootResumeOrphanedJobs(enqueueJob);
  if (resumed > 0) logger.info(`re-enqueued ${resumed} long-running job(s) for resume`);
} catch (e) {
  logger.warn("long-running job resume skipped", { error: (e as Error).message });
}

// Catch any promise rejection or exception that escapes normal handling.
process.on("unhandledRejection", (reason: any) => {
  logger.error("unhandledRejection", { reason: reason?.message || String(reason) });
});
process.on("uncaughtException", (err: any) => {
  logger.error("uncaughtException", { error: err?.message || String(err) });
});

// Graceful shutdown on SIGTERM (PM2 stop/restart, updates).
let shuttingDown = false;
process.once("SIGTERM", () => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("SIGTERM received — shutting down gracefully");
  try { closeAllDbs(); } catch {}
  setTimeout(() => process.exit(0), 800);
});
