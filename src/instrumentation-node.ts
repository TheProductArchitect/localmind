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

// V6 fleet foundation: lazily generates the node Ed25519 keypair on first boot,
// loads it on subsequent boots, and caches the KeyObjects so signed envelopes
// don't touch disk per call. A failure here is non-fatal but loud — federation
// won't work without an identity, but single-machine LocalMind still does.
try {
  const { getNodeIdentity } = require("./lib/fleet/identity") as typeof import("./lib/fleet/identity");
  const id = getNodeIdentity();
  logger.info(`fleet identity ready (node_id=${id.node_id})`);
} catch (e) {
  logger.error("fleet identity init failed", { error: (e as Error).message });
}

// V6.1 transport: start the fleet HTTPS sidecar + heartbeat loop. Both gated
// on openssl being available (we shell out to generate the TLS cert on first
// boot). If it's missing, the rest of LocalMind still runs in single-node mode.
try {
  const { startFleetServer } = require("./lib/fleet/server") as typeof import("./lib/fleet/server");
  const { startHeartbeat } = require("./lib/fleet/heartbeat") as typeof import("./lib/fleet/heartbeat");
  // Fire and forget — server boots in <50ms once the cert is on disk.
  startFleetServer().then((r) => {
    logger.info(`fleet listener up on :${r.port} (cert ${r.cert_fingerprint.slice(0, 16)}…)`);
    startHeartbeat();
  }).catch((e) => {
    logger.warn("fleet listener could not start", { error: (e as Error).message });
  });
} catch (e) {
  logger.warn("fleet transport init skipped", { error: (e as Error).message });
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
