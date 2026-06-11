import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth/identity";
import { getPersona } from "@/lib/db/personas";
import { assembleSystemPrompt } from "@/lib/agent/assemble-system-prompt";

export const runtime = "nodejs";

const Body = z.object({ message: z.string().min(1).max(4000) });

// V5 stub. Returns the assembled prompt + token estimate so the composer page
// can show "what the model would see" before a real one-shot call is wired up.
// TODO(V5.1): hand off to the provider router for a single non-streaming
// completion using the persona's model_name (or the global active model).
export async function POST(req: NextRequest, { params: paramsPromise }: { params: Promise<{ personaId: string }> }) {
  const params = await paramsPromise;
  const persona = getPersona(params.personaId);
  if (!persona) return NextResponse.json({ error: "Persona not found." }, { status: 404 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload." }, { status: 400 });

  const user = currentUser(req);
  const result = await assembleSystemPrompt(params.personaId, {
    userId: user?.id,
    userName: user?.display_name,
  });

  return NextResponse.json({
    assembled: result.assembled,
    tokenEstimate: result.tokenEstimate,
    response: "(Test runner is stubbed in V5. The system prompt above is what the model would receive; live test responses arrive in V5.1.)",
    userMessage: parsed.data.message,
  });
}
