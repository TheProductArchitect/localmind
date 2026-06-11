import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getTable, listRecords, putRecord, dropTable, ensureTable } from "@/lib/db/datastore";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params: paramsPromise }: { params: Promise<{ name: string }> }) {
  const params = await paramsPromise;
  const t = getTable(params.name);
  if (!t) return NextResponse.json({ error: "Table not found." }, { status: 404 });
  const sp = req.nextUrl.searchParams;
  const limit = Math.min(Number(sp.get("limit") || 100), 1000);
  const offset = Math.max(Number(sp.get("offset") || 0), 0);
  const records = listRecords(params.name, { limit, offset });
  return NextResponse.json({ table: t, records });
}

const PostBody = z.object({
  data: z.record(z.unknown()),
  schema: z.record(z.unknown()).optional(),
});

export async function POST(req: NextRequest, { params: paramsPromise }: { params: Promise<{ name: string }> }) {
  const params = await paramsPromise;
  const parsed = PostBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload — expected { data }." }, { status: 400 });
  try {
    if (parsed.data.schema) ensureTable(params.name, parsed.data.schema);
    const rec = putRecord(params.name, parsed.data.data);
    return NextResponse.json({ record: rec });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, { params: paramsPromise }: { params: Promise<{ name: string }> }) {
  const params = await paramsPromise;
  const ok = dropTable(params.name);
  return NextResponse.json({ ok });
}
