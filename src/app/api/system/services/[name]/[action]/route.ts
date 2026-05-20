import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { logger } from "@/lib/logger";

const exec = promisify(execFile);
export const runtime = "nodejs";

const VALID_SERVICES = ["ollama", "localmind"];
const VALID_ACTIONS = ["start", "stop", "restart"];

async function sh(cmd: string, args: string[]) {
  try {
    await exec(cmd, args, { timeout: 20000 });
    return true;
  } catch {
    return false;
  }
}

export async function POST(_req: NextRequest, { params }: { params: { name: string; action: string } }) {
  const { name, action } = params;
  if (!VALID_SERVICES.includes(name) || !VALID_ACTIONS.includes(action)) {
    return NextResponse.json({ error: "Unknown service or action" }, { status: 400 });
  }
  logger.info(`service ${action} requested`, { service: name });

  let ok = false;
  if (name === "ollama") {
    if (action === "stop") ok = await sh("pkill", ["-f", "ollama serve"]);
    else if (action === "start") ok = await sh("sh", ["-c", "ollama serve >/dev/null 2>&1 &"]);
    else {
      await sh("pkill", ["-f", "ollama serve"]);
      ok = await sh("sh", ["-c", "ollama serve >/dev/null 2>&1 &"]);
    }
  } else {
    // localmind via PM2
    ok = await sh("pm2", [action, "localmind"]);
  }

  if (!ok) {
    return NextResponse.json(
      { error: `Could not ${action} ${name}. The service may not be managed in this environment.` },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true });
}
