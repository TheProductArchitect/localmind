import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { getSettings } from "@/lib/db/queries";

export const runtime = "nodejs";

// Speaks text aloud on the host Mac via the built-in `say` command.
// Entirely local — no audio leaves the machine.
export async function POST(req: NextRequest) {
  const { text } = await req.json();
  if (!text || typeof text !== "string") {
    return NextResponse.json({ error: "text required" }, { status: 400 });
  }
  const voice = getSettings().tts_voice || null;
  const args = voice ? ["-v", voice, text.slice(0, 4000)] : [text.slice(0, 4000)];
  return new Promise<Response>((resolve) => {
    execFile("say", args, { timeout: 60000 }, (err) => {
      if (err) {
        resolve(NextResponse.json({ error: "TTS unavailable on this host" }, { status: 500 }));
      } else {
        resolve(NextResponse.json({ ok: true }));
      }
    });
  });
}
