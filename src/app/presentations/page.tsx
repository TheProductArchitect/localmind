"use client";
import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Button, EmptyState, Input, Textarea } from "@/components/ui";
import { PageHeader, PageShell } from "@/components/page-header";
import { toast } from "@/components/toast";

type Presentation = {
  id: string;
  title: string;
  status: string;
  slide_count: number;
  updated_at: number;
};
type Slide = { title: string; bullets: string[]; body: string };
type Deck = { title: string; slides: Slide[] };

function PresentationsInner() {
  const search = useSearchParams();
  const [list, setList] = useState<Presentation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(search.get("id"));
  const [deck, setDeck] = useState<Deck | null>(null);
  const [title, setTitle] = useState("");
  const [outline, setOutline] = useState("");

  async function loadList() {
    const j = await (await fetch("/api/presentations")).json();
    setList(j.presentations || []);
  }

  async function open(id: string) {
    setActiveId(id);
    const j = await (await fetch(`/api/presentations/${id}`)).json();
    setDeck(j.deck || null);
  }

  useEffect(() => {
    loadList();
    const id = search.get("id");
    if (id) open(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function create() {
    if (!title.trim()) return;
    const j = await (
      await fetch("/api/presentations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, outline }),
      })
    ).json();
    toast(j.presentation ? "Created" : j.error || "Failed", j.presentation ? "success" : "error");
    setTitle("");
    setOutline("");
    await loadList();
    if (j.presentation?.id) open(j.presentation.id);
  }

  async function exportFmt(format: string) {
    if (!activeId) return;
    const j = await (
      await fetch(`/api/presentations/${activeId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ format }),
      })
    ).json();
    toast(j.ok ? `Exported → ${j.path}` : j.error || "Export failed", j.ok ? "success" : "error");
    loadList();
  }

  return (
    <PageShell width="wide">
      <PageHeader
        eyebrow="Presentations"
        title="Decks"
        hint="Markdown-backed slides on this machine. Ask Sora to draft one, or outline below and export PPTX."
      />

      <div className="lm-panel space-y-2 mb-8">
        <p className="lm-micro mb-1">New presentation</p>
        <Input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <Textarea
          placeholder={"Outline (optional)\n# Agenda\n- Point one\n# Next steps"}
          rows={4}
          value={outline}
          onChange={(e) => setOutline(e.target.value)}
        />
        <button type="button" className="lm-action" onClick={create} data-pulse="true">Create</button>
      </div>

      <div className="grid gap-6 md:grid-cols-[240px_1fr]">
        <div className="space-y-2">
          <p className="lm-micro">Library</p>
          {list.length === 0 && (
            <EmptyState
              showOrb
              title="No decks yet"
              hint="Create one above, or ask Sora in chat."
            />
          )}
          {list.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => open(p.id)}
              className="block w-full text-left rounded-[10px] px-3 py-2 text-sm"
              style={{
                border: "1px solid hsl(0 0% 100% / 0.08)",
                background: activeId === p.id ? "hsl(0 0% 100% / 0.08)" : "transparent",
              }}
              data-pulse="true"
            >
              <div className="font-medium truncate">{p.title}</div>
              <div className="text-xs" style={{ color: "hsl(0 0% 100% / 0.45)" }}>
                {p.slide_count} slides · {p.status}
              </div>
            </button>
          ))}
        </div>

        <div>
          {!deck ? (
            <EmptyState title="Select a deck" hint="Pick from the library or create one." />
          ) : (
            <div className="space-y-4">
              <div className="flex gap-2 flex-wrap">
                <button type="button" className="lm-action" onClick={() => exportFmt("pptx")} data-pulse="true">
                  Export PPTX
                </button>
                <button type="button" className="lm-action lm-action--ghost" onClick={() => exportFmt("pdf")}>
                  Export printable HTML
                </button>
              </div>
              {deck.slides.map((s, i) => (
                <div key={i} className="lm-panel">
                  <p className="lm-micro mb-1">Slide {i + 1}</p>
                  <h2 className="text-xl font-medium mb-3" style={{ letterSpacing: "-0.02em" }}>{s.title}</h2>
                  {s.bullets?.length > 0 && (
                    <ul className="list-disc pl-5 space-y-1 text-sm" style={{ color: "hsl(0 0% 100% / 0.85)" }}>
                      {s.bullets.map((b, j) => (
                        <li key={j}>{b}</li>
                      ))}
                    </ul>
                  )}
                  {s.body ? (
                    <p className="text-sm mt-3 whitespace-pre-wrap" style={{ color: "hsl(0 0% 100% / 0.5)" }}>{s.body}</p>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </PageShell>
  );
}

export default function PresentationsPage() {
  return (
    <Suspense fallback={<div className="p-10 lm-body" style={{ color: "hsl(0 0% 100% / 0.4)" }}>Loading…</div>}>
      <PresentationsInner />
    </Suspense>
  );
}
