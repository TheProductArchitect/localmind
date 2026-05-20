import { NextRequest, NextResponse } from "next/server";
import { listConnectedProviders, setApiKey, deleteApiKey } from "@/lib/db/apikeys";
import { getProviderByName } from "@/lib/providers";

export const runtime = "nodejs";

const PROVIDERS = ["ollama", "openai", "anthropic", "groq", "openrouter"];

export async function GET() {
  const connected = listConnectedProviders();
  return NextResponse.json({
    providers: PROVIDERS.map((p) => ({ name: p, connected: p === "ollama" || connected.includes(p) })),
  });
}

export async function POST(req: NextRequest) {
  const { provider, key, action } = await req.json();
  if (!PROVIDERS.includes(provider)) {
    return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
  }
  if (action === "save") {
    if (!key) return NextResponse.json({ error: "key required" }, { status: 400 });
    setApiKey(provider, key);
    return NextResponse.json({ ok: true });
  }
  if (action === "delete") {
    deleteApiKey(provider);
    return NextResponse.json({ ok: true });
  }
  if (action === "test") {
    if (key) setApiKey(provider, key);
    const result = await getProviderByName(provider).testConnection();
    return NextResponse.json(result);
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
