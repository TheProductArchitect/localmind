import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { listPersonas, createPersona } from "@/lib/db/personas";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ personas: listPersonas() });
}

const CreateBody = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(500).nullish(),
  model_name: z.string().max(120).nullish(),
  enabled_tools: z.array(z.string()).optional(),
  permission_profile_id: z.string().max(80).nullish(),
});

export async function POST(req: NextRequest) {
  const parsed = CreateBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid persona payload." }, { status: 400 });
  }
  const persona = createPersona(parsed.data);
  return NextResponse.json({ persona });
}
