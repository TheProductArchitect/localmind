import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth/identity";
import { getPersona } from "@/lib/db/personas";
import { listBlocks, replaceBlocks, type BlockInput } from "@/lib/db/system-prompt-blocks";
import { assembleSystemPrompt } from "@/lib/agent/assemble-system-prompt";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: { personaId: string } }) {
  const persona = getPersona(params.personaId);
  if (!persona) return NextResponse.json({ error: "Persona not found." }, { status: 404 });

  if (req.nextUrl.searchParams.get("preview") === "1") {
    const user = currentUser(req);
    const result = await assembleSystemPrompt(params.personaId, {
      userId: user?.id,
      userName: user?.display_name,
    });
    return NextResponse.json(result);
  }

  return NextResponse.json({ persona, blocks: listBlocks(params.personaId) });
}

const BlockSchema = z.object({
  block_id: z.string().optional(),
  block_type: z.enum(["builtin", "custom-static", "custom-conditional"]),
  block_name: z.string().min(1).max(80),
  content: z.string().max(20000).optional(),
  enabled: z.boolean().optional(),
  sort_order: z.number().int().optional(),
  condition_json: z.string().max(2000).nullable().optional(),
});

const PatchBody = z.object({
  blocks: z.array(BlockSchema).max(64),
});

export async function PATCH(req: NextRequest, { params }: { params: { personaId: string } }) {
  if (!getPersona(params.personaId)) {
    return NextResponse.json({ error: "Persona not found." }, { status: 404 });
  }

  const parsed = PatchBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid blocks payload." }, { status: 400 });
  }

  // Reject custom-conditional blocks whose condition_json is unparseable —
  // catch it here rather than silently dropping the block at assembly time.
  for (const b of parsed.data.blocks) {
    if (b.block_type === "custom-conditional" && b.condition_json) {
      try {
        JSON.parse(b.condition_json);
      } catch {
        return NextResponse.json(
          { error: `Block "${b.block_name}" has invalid condition_json — must be valid JSON.` },
          { status: 400 }
        );
      }
    }
  }

  replaceBlocks(params.personaId, parsed.data.blocks as BlockInput[]);
  return NextResponse.json({ ok: true, blocks: listBlocks(params.personaId) });
}
