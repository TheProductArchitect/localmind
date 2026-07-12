// LocalMind background worker. Managed by PM2 alongside the Next.js process.
// Handles scheduled task timing and condition monitor timing. Heavy work
// (agent runs, embeddings) is delegated to the main app over localhost HTTP.
const Database = require("better-sqlite3");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const DATA_DIR = process.env.LOCALMIND_DATA_DIR || path.join(os.homedir(), ".localmind");
const CONFIG_DB = path.join(DATA_DIR, "config.db");
const PORT = process.env.PORT || 3000;
const BASE = `http://127.0.0.1:${PORT}`;

// Shared secret for /api/internal/* calls. Must match src/lib/internal-auth.ts:
// env var first, otherwise the per-install random secret persisted by whichever
// process touches it first. No guessable constant fallback.
function internalToken() {
  if (process.env.LOCALMIND_INTERNAL_TOKEN) return process.env.LOCALMIND_INTERNAL_TOKEN;
  const file = path.join(DATA_DIR, "internal-token");
  try {
    if (fs.existsSync(file)) {
      const t = fs.readFileSync(file, "utf8").trim();
      if (t) return t;
    }
  } catch {}
  const t = crypto.randomBytes(32).toString("hex");
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    // Exclusive create; if the app process won the race, re-read its token.
    fs.writeFileSync(file, t, { mode: 0o600, flag: "wx" });
    return t;
  } catch {
    try {
      const existing = fs.readFileSync(file, "utf8").trim();
      if (existing) return existing;
    } catch {}
  }
  return t;
}

const INTERNAL_TOKEN = internalToken();

function db() {
  const d = new Database(CONFIG_DB);
  d.pragma("journal_mode = WAL");
  return d;
}

// Minimal cron matcher: "min hour dom mon dow" with * and */n and lists.
function cronField(field, value) {
  if (field === "*") return true;
  for (const part of field.split(",")) {
    if (part.startsWith("*/")) {
      if (value % Number(part.slice(2)) === 0) return true;
    } else if (part.includes("-")) {
      const [a, b] = part.split("-").map(Number);
      if (value >= a && value <= b) return true;
    } else if (Number(part) === value) {
      return true;
    }
  }
  return false;
}

function cronMatches(expr, date) {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [min, hour, dom, mon, dow] = parts;
  return (
    cronField(min, date.getMinutes()) &&
    cronField(hour, date.getHours()) &&
    cronField(dom, date.getDate()) &&
    cronField(mon, date.getMonth() + 1) &&
    cronField(dow, date.getDay())
  );
}

async function post(route, body) {
  try {
    const r = await fetch(BASE + route, {
      method: "POST",
      headers: { "content-type": "application/json", "x-localmind-internal": INTERNAL_TOKEN },
      body: JSON.stringify(body || {}),
    });
    return r.ok;
  } catch (e) {
    return false;
  }
}

let lastTickMinute = -1;

async function tick() {
  const now = new Date();
  const minute = now.getHours() * 60 + now.getMinutes();
  const newMinute = minute !== lastTickMinute;
  lastTickMinute = minute;

  let d;
  try {
    d = db();
  } catch {
    return;
  }

  try {
    // Scheduled tasks — fire once per matching minute.
    if (newMinute) {
      const tasks = d.prepare("SELECT * FROM scheduled_tasks WHERE enabled=1").all();
      for (const t of tasks) {
        const ranThisMinute = t.last_run_at && new Date(t.last_run_at).getMinutes() === now.getMinutes()
          && Math.abs(Date.now() - t.last_run_at) < 90000;
        if (!ranThisMinute && cronMatches(t.cron, now)) {
          console.log(`[worker] running scheduled task: ${t.name}`);
          await post("/api/internal/run-task", { taskId: t.id });
        }
      }
    }

    // Condition monitors — fire when their frequency has elapsed.
    const monitors = d.prepare("SELECT * FROM monitors WHERE enabled=1").all();
    for (const m of monitors) {
      const due = !m.last_checked_at || Date.now() - m.last_checked_at >= (m.frequency_seconds || 3600) * 1000;
      if (due) {
        console.log(`[worker] checking monitor: ${m.name}`);
        await post("/api/internal/run-monitor", { monitorId: m.id });
      }
    }

    // Job queue — process pending embedding/ingestion jobs every tick.
    await post("/api/internal/process-jobs", {});

    // Critic queue — once per minute, review one pending subagent run.
    if (newMinute) {
      await post("/api/internal/process-critic", {});
    }

    // Idle self-improvement cycle — once per minute. The route returns fast
    // when the system isn't idle-eligible (opt-in + window + no active work),
    // so this is cheap to poll.
    if (newMinute) {
      await post("/api/internal/idle-tick", {});
    }
  } catch (e) {
    console.error("[worker] tick error:", e.message);
  } finally {
    d.close();
  }
}

console.log("[worker] LocalMind background worker started");
setInterval(tick, 5000);
tick();
