import { NextResponse } from "next/server";
import { listTables } from "@/lib/db/datastore";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ tables: listTables() });
}
