import { NextRequest, NextResponse } from "next/server";
import { getRegistry } from "@/lib/plugins/registry";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const refresh = req.nextUrl.searchParams.get("refresh") === "1";
  const reg = await getRegistry({ refresh });
  return NextResponse.json(reg);
}
