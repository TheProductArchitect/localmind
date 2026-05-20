"use client";
import { useEffect, useRef, useState } from "react";
import { Button, Card, Input, Textarea, EmptyState, Badge } from "@/components/ui";
import { toast } from "@/components/toast";
import { NoteGraph } from "@/components/note-graph";

const TABS = ["Search", "Documents", "Notes"];

export default function KnowledgePage() {
  const [tab, setTab] = useState("Search");
  return (
    <div className="h-full overflow-y-auto p-6">
      <h1 className="text-xl font-semibold mb-3">Knowledge Base</h1>
      <div className="flex gap-2 mb-4">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`rounded-full px-3 py-1 text-sm border ${tab === t ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>
            {t}
          </button>
        ))}
      </div>
      {tab === "Search" && <SearchTab />}
      {tab === "Documents" && <DocsTab />}
      {tab === "Notes" && <NotesTab />}
    </div>
  );
}

function SearchTab() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  async function search() {
    if (!q.trim()) return;
    setBusy(true);
    const j = await (await fetch(`/api/knowledge/search?q=${encodeURIComponent(q)}`)).json();
    setResults(j.results || []);
    setBusy(false);
  }
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input placeholder="Search by meaning…" value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()} />
        <Button onClick={search} disabled={busy}>Search</Button>
      </div>
      {results.length === 0 && !busy && (
        <EmptyState title="Search your knowledge base"
          hint="Semantic search finds passages by meaning across ingested documents. Add documents in the Documents tab first." />
      )}
      {results.map((r) => (
        <Card key={r.chunkId} className="p-3">
          <div className="flex items-center gap-2">
            <Badge variant="outline">{r.documentName}</Badge>
            <span className="text-xs text-muted-foreground">{(r.score * 100).toFixed(0)}% match</span>
          </div>
          <p className="text-sm mt-1 whitespace-pre-wrap">{r.text}</p>
        </Card>
      ))}
    </div>
  );
}

const BINARY_EXT = ["pdf", "docx", "epub"];

function DocsTab() {
  const [docs, setDocs] = useState<any[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const load = () => fetch("/api/knowledge/documents").then((r) => r.json()).then((j) => setDocs(j.documents || []));
  useEffect(() => { load(); }, []);

  // Poll while any document is still processing.
  useEffect(() => {
    const active = docs.some((d) => d.status === "pending" || d.status === "indexing");
    if (!active) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [docs]);

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = (file.name.toLowerCase().split(".").pop() || "");
    const isBase64 = BINARY_EXT.includes(ext);
    let content: string;
    if (isBase64) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let bin = "";
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      content = btoa(bin);
    } else {
      content = await file.text();
    }
    const r = await fetch("/api/knowledge/documents", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ fileName: file.name, content, isBase64 }),
    });
    const j = await r.json();
    if (j.duplicate) {
      if (confirm(j.message)) {
        await fetch("/api/knowledge/documents", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ fileName: file.name, content, isBase64, confirmReingest: true }),
        });
        toast("Re-ingesting…");
      }
    } else {
      toast("Queued — embedding in the background", "success");
    }
    load();
  }
  async function del(id: string) {
    await fetch(`/api/knowledge/documents/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="space-y-3">
      <input ref={fileRef} type="file" accept=".txt,.md,.markdown,.html,.htm,.json,.pdf,.docx,.epub"
        onChange={upload} className="hidden" />
      <Button size="sm" onClick={() => fileRef.current?.click()}>Upload document</Button>
      <p className="text-xs text-muted-foreground">
        Supported: .txt, .md, .html, .json, .pdf, .docx, .epub. Documents are chunked and embedded
        by the background worker.
      </p>
      {docs.length === 0 ? (
        <EmptyState title="No documents indexed yet"
          hint="Upload a document to make it searchable by the assistant." />
      ) : (
        docs.map((d) => (
          <Card key={d.id} className="p-3 flex items-center gap-2">
            <div className="flex-1">
              <p className="text-sm font-medium">{d.file_name}</p>
              <p className="text-xs text-muted-foreground">
                {d.status === "indexed" ? `${d.chunk_count} chunks · indexed` :
                 d.status === "failed" ? `failed — ${d.error || "unknown error"}` :
                 `${d.status}…`}
              </p>
            </div>
            <Badge variant={d.status === "indexed" ? "success" : d.status === "failed" ? "destructive" : "outline"}>
              {d.status}
            </Badge>
            <Button size="sm" variant="ghost" onClick={() => del(d.id)} aria-label={`Delete ${d.file_name}`}>
              Delete
            </Button>
          </Card>
        ))
      )}
    </div>
  );
}

function NotesTab() {
  const [notes, setNotes] = useState<any[]>([]);
  const [active, setActive] = useState<any>(null);
  const [showGraph, setShowGraph] = useState(false);
  const load = () => fetch("/api/knowledge/notes").then((r) => r.json()).then((j) => setNotes(j.notes || []));
  useEffect(() => { load(); }, []);

  function openNote(id: string) {
    const n = notes.find((x) => x.id === id);
    if (n) { setActive(n); setShowGraph(false); }
  }

  async function create() {
    const j = await (await fetch("/api/knowledge/notes", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Untitled note" }),
    })).json();
    await load();
    setActive(j.note);
  }
  async function save() {
    if (!active) return;
    await fetch(`/api/knowledge/notes/${active.id}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: active.title, content: active.content }),
    });
    toast("Note saved", "success");
    load();
  }
  async function del(id: string) {
    await fetch(`/api/knowledge/notes/${id}`, { method: "DELETE" });
    if (active?.id === id) setActive(null);
    load();
  }

  return (
    <div className="flex gap-3">
      <div className="w-56 space-y-1">
        <Button size="sm" className="w-full" onClick={create}>+ New note</Button>
        <Button size="sm" variant="outline" className="w-full" onClick={() => setShowGraph((g) => !g)}>
          {showGraph ? "Hide graph" : "Graph view"}
        </Button>
        {notes.map((n) => (
          <div key={n.id}
            className={`flex items-center rounded px-2 py-1.5 text-sm cursor-pointer ${active?.id === n.id ? "bg-accent" : "hover:bg-accent/50"}`}
            onClick={() => { setActive(n); setShowGraph(false); }}>
            <span className="truncate flex-1">{n.title}</span>
            <button onClick={(e) => { e.stopPropagation(); del(n.id); }}
              aria-label={`Delete ${n.title}`} className="text-xs text-muted-foreground">✕</button>
          </div>
        ))}
      </div>
      <div className="flex-1">
        {showGraph ? (
          <Card className="p-3"><NoteGraph onOpenNote={openNote} /></Card>
        ) : active ? (
          <Card className="p-3 space-y-2">
            <Input value={active.title} onChange={(e) => setActive({ ...active, title: e.target.value })} />
            <Textarea value={active.content} rows={16}
              onChange={(e) => setActive({ ...active, content: e.target.value })}
              placeholder="Markdown supported. Link notes with [[Note title]]." />
            <Button size="sm" onClick={save}>Save</Button>
          </Card>
        ) : (
          <EmptyState title="No note selected" hint="Create a note or pick one from the list." />
        )}
      </div>
    </div>
  );
}
