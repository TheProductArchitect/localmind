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
