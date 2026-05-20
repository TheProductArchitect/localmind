import { NextResponse } from "next/server";
import { listNotes } from "@/lib/db/knowledge";

export const runtime = "nodejs";

// Returns the note graph: nodes plus wiki-style [[link]] edges.
export async function GET() {
  const notes = listNotes();
  const byTitle = new Map(notes.map((n) => [n.title.toLowerCase(), n.id]));
  const links: { source: string; target: string }[] = [];
  const inbound: Record<string, number> = {};

  for (const note of notes) {
    const matches = note.content.matchAll(/\[\[([^\]]+)\]\]/g);
    for (const m of matches) {
      const targetId = byTitle.get(m[1].trim().toLowerCase());
      if (targetId && targetId !== note.id) {
        links.push({ source: note.id, target: targetId });
        inbound[targetId] = (inbound[targetId] || 0) + 1;
      }
    }
  }

  return NextResponse.json({
    nodes: notes.map((n) => ({ id: n.id, title: n.title, inbound: inbound[n.id] || 0 })),
    links,
  });
}
