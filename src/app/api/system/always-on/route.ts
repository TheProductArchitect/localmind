/**
 * GET    /api/system/always-on  — current plan (platform, paths, commands, installed?)
 * POST   /api/system/always-on  — write the unit file (does NOT activate)
 * DELETE /api/system/always-on  — remove the unit file
 *
 * Activation/deactivation commands are surfaced for the user to run from a
 * terminal. We don't shell them out here — installing a system service is the
 * textbook action that should require an explicit, deliberate user step.
 */

import { NextResponse } from "next/server";
import { planInstall, writeUnitFile, isInstalled, removeUnitFile } from "@/lib/always-on";

export const runtime = "nodejs";

export async function GET() {
  const plan = planInstall();
  const installed = await isInstalled();
  return NextResponse.json({ plan, installed });
}

export async function POST() {
  const plan = planInstall();
  if (plan.platform === "unsupported") {
    return NextResponse.json({ error: plan.reason }, { status: 400 });
  }
  try {
    await writeUnitFile(plan);
    return NextResponse.json({ ok: true, service_path: plan.service_path });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE() {
  await removeUnitFile();
  return NextResponse.json({ ok: true });
}
