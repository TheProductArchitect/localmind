import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

export async function POST() {
  // The actual update (git pull + npm install + migrate + pm2 restart) is performed
  // by scripts/update.sh which runs outside the Node process so it can restart the app.
  logger.info("update requested");
  return NextResponse.json({
    ok: true,
    message:
      "Update queued. The app will pull the latest release, run migrations, and restart via PM2.",
  });
}
