import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPeer, unpairPeer, updatePeerLabel, updatePeerPolicy } from "@/lib/db/fleet";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;
  const peer = getPeer(params.id);
  if (!peer) return NextResponse.json({ error: "Peer not found." }, { status: 404 });
  return NextResponse.json({ peer });
}

const PatchBody = z
  .object({
    label: z.string().min(1).max(80).nullable().optional(),
    policy: z
      .object({
        allow_self_actions: z.boolean().optional(),
        allowed_tools: z.array(z.string()).optional(),
        advertise_capabilities: z.boolean().optional(),
        accept_chat_relay: z.boolean().optional(),
        accept_workspace_relay: z.boolean().optional(),
        accept_tool_relay: z.boolean().optional(),
        chat_relay_rate_per_min: z.number().int().min(1).max(600).optional(),
        sync_conversations: z.boolean().optional(),
      })
      .optional(),
  })
  .strict();

export async function PATCH(req: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;
  const peer = getPeer(params.id);
  if (!peer) return NextResponse.json({ error: "Peer not found." }, { status: 404 });
  const parsed = PatchBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload." }, { status: 400 });

  if (parsed.data.label !== undefined) {
    updatePeerLabel(params.id, parsed.data.label);
  }
  if (parsed.data.policy) {
    updatePeerPolicy(params.id, parsed.data.policy);
  }
  return NextResponse.json({ peer: getPeer(params.id) });
}

export async function DELETE(_req: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;
  const ok = unpairPeer(params.id);
  return NextResponse.json({ ok });
}
