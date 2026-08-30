"use client";

/**
 * /knowledge — unified hub for everything Sora knows.
 *
 * Six tabs share a single layout shell: search bar at the top, hairline
 * segmented tabs, then the active surface. All existing functionality
 * (semantic search, documents, notes + note graph, sharing policy, peer
 * search, memory) is preserved — only the visual layer was rebuilt for v2.
 *
 * Honors ?tab=<id> so /memory (redirected) lands on the Memory tab.
 */

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { onActivate } from "@/lib/client/keyboard";
import { toast } from "@/components/toast";
import { useConfirm } from "@/components/confirm-dialog";
import { NoteGraph } from "@/components/note-graph";
import { ContextGraphView } from "@/components/context-graph-view";
import { Search, Plus, RefreshCw, Trash2, Upload, FileText, StickyNote, Share2, Wifi, Brain, Waypoints } from "lucide-react";

type TabId = "search" | "documents" | "notes" | "memory" | "context" | "sharing" | "peer";

const TABS: { id: TabId; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "search",    label: "Search",     Icon: Search },
  { id: "documents", label: "Documents",  Icon: FileText },
  { id: "notes",     label: "Notes",      Icon: StickyNote },
  { id: "memory",    label: "Memory",     Icon: Brain },
  { id: "context",   label: "About you",  Icon: Waypoints },
  { id: "sharing",   label: "Sharing",    Icon: Share2 },
  { id: "peer",      label: "Peer search", Icon: Wifi },
];

function KnowledgeInner() {
  const params = useSearchParams();
  const router = useRouter();
  const initial = (params.get("tab") as TabId | null) ?? "search";
  const [tab, setTab] = useState<TabId>(
    initial && TABS.some((x) => x.id === initial) ? initial : "search"
  );

  useEffect(() => {
    const t = params.get("tab") as TabId | null;
    if (t && TABS.some((x) => x.id === t)) setTab(t);
  }, [params]);

  function selectTab(id: TabId) {
    setTab(id);
    // Keep the URL in sync so sidebar links, ⌘K, and shareable deep-links
    // stay mapped to the visible surface.
    const qs = id === "search" ? "/knowledge" : `/knowledge?tab=${id}`;
    router.replace(qs, { scroll: false });
  }

  return (
    <div className="mx-auto max-w-4xl px-5 sm:px-10 py-10 sm:py-16">
      <header className="mb-12">
        <p className="lm-micro mb-2">Knowledge</p>
        <h1 className="lm-display">What Sora knows</h1>
        <p className="lm-body mt-3 max-w-xl" style={{ color: "hsl(0 0% 100% / 0.5)" }}>
          Semantic search across documents, your notes, agent memory, and — if you&apos;ve paired
          peers — the knowledge they&apos;ve chosen to share.
        </p>
      </header>

      <nav className="lm-tabs">
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => selectTab(t.id)}
              className={`lm-tab ${active ? "is-active" : ""}`}
              data-pulse="true"
            >
              <t.Icon className="h-3.5 w-3.5" />
              <span>{t.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="mt-10">
        {tab === "search"    && <SearchTab />}
        {tab === "documents" && <DocsTab />}
        {tab === "notes"     && <NotesTab />}
        {tab === "memory"    && <MemoryTab />}
        {tab === "context"   && <ContextGraphView />}
        {tab === "sharing"   && <SharingTab />}
        {tab === "peer"      && <PeerSearchTab />}
      </div>

      <style jsx>{`
        .lm-tabs {
          display: flex; flex-wrap: wrap; gap: 2px;
          padding: 4px;
          border: 1px solid hsl(0 0% 100% / 0.08);
          border-radius: var(--lm-radius-control);
          background: hsl(0 0% 100% / 0.03);
          width: fit-content;
        }
        .lm-tab {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 8px 14px;
          border-radius: 10px;
          font-size: 12px; letter-spacing: -0.005em;
          color: hsl(0 0% 100% / 0.55);
          transition: background var(--lm-dur-micro) var(--lm-ease-micro),
                      color      var(--lm-dur-micro) var(--lm-ease-micro);
        }
        .lm-tab:hover { color: hsl(0 0% 100% / 0.9); }
        .lm-tab.is-active {
          background: hsl(0 0% 100% / 0.08);
          color: hsl(0 0% 100%);
          box-shadow: 0 0 0 1px hsl(0 0% 100% / 0.06) inset;
        }
      `}</style>
    </div>
  );
}

export default function KnowledgePage() {
  return (
    <Suspense fallback={<div className="p-10 lm-body" style={{ color: "hsl(0 0% 100% / 0.5)" }}>Loading…</div>}>
      <KnowledgeInner />
    </Suspense>
  );
}

/* ============================================================ */
/* Search                                                       */
/* ============================================================ */

type SearchResult = { chunkId: string; documentName: string; score: number; text: string };

function SearchTab() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState(false);

  async function search() {
    if (!q.trim()) return;
    setBusy(true);
    setSearched(true);
    const j = await (await fetch(`/api/knowledge/search?q=${encodeURIComponent(q)}`)).json();
    setResults(j.results || []);
    setBusy(false);
  }

  return (
    <div>
      <BigSearch
        value={q}
        onChange={setQ}
        placeholder="Search by meaning…"
        onSubmit={search}
        busy={busy}
      />
      {!searched && (
        <p className="lm-body mt-8 text-center" style={{ color: "hsl(0 0% 100% / 0.35)" }}>
          Semantic search across every ingested document.
        </p>
      )}
      <div className="mt-8 space-y-3">
        {results.map((r) => (
          <article key={r.chunkId} className="lm-result">
            <header className="flex items-center justify-between mb-2">
              <span className="lm-chip">{r.documentName}</span>
              <span className="lm-micro">{(r.score * 100).toFixed(0)}% match</span>
            </header>
            <p className="lm-body" style={{ color: "hsl(0 0% 100% / 0.85)", whiteSpace: "pre-wrap" }}>{r.text}</p>
          </article>
        ))}
        {searched && !busy && results.length === 0 && (
          <p className="lm-body py-12 text-center" style={{ color: "hsl(0 0% 100% / 0.35)" }}>
            No matches. Try a different phrasing.
          </p>
        )}
      </div>
      <SharedStyles />
    </div>
  );
}

/* ============================================================ */
/* Documents                                                    */
/* ============================================================ */

const BINARY_EXT = ["pdf", "docx", "epub"];

function DocsTab() {
  const confirm = useConfirm();
  const [docs, setDocs] = useState<any[]>([]);
  const [filter, setFilter] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const load = () => fetch("/api/knowledge/documents").then((r) => r.json()).then((j) => setDocs(j.documents || []));
  useEffect(() => { load(); }, []);

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
      const ok = await confirm({
        title: "Document already indexed",
        message: typeof j.message === "string" ? j.message : "Re-ingest this document?",
        confirmLabel: "Re-ingest",
      });
      if (ok) {
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

  const visible = docs.filter((d) => !filter || (d.file_name || "").toLowerCase().includes(filter.toLowerCase()));

  return (
    <div>
      <input ref={fileRef} type="file" accept=".txt,.md,.markdown,.html,.htm,.json,.pdf,.docx,.epub"
        onChange={upload} className="hidden" />

      <div className="flex items-center gap-3 mb-8">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter documents…"
          className="lm-input flex-1"
        />
        <button onClick={() => fileRef.current?.click()} className="lm-action" data-pulse="true">
          <Upload className="h-3.5 w-3.5" /> Upload
        </button>
        <button onClick={load} className="lm-icon-btn" aria-label="Refresh" data-pulse="true">
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      <p className="lm-micro mb-6">.txt · .md · .html · .json · .pdf · .docx · .epub</p>

      {visible.length === 0 ? (
        <p className="lm-body py-16 text-center" style={{ color: "hsl(0 0% 100% / 0.4)" }}>
          {docs.length === 0 ? "No documents indexed yet. Upload one to begin." : "No documents match your filter."}
        </p>
      ) : (
        visible.map((d) => (
          <div key={d.id} className="lm-row">
            <span className="lm-row__icon"><FileText className="h-4 w-4" /></span>
            <div className="lm-row__main">
              <p className="lm-row__title">{d.file_name}</p>
              <p className="lm-micro" style={{ textTransform: "none", letterSpacing: 0 }}>
                {d.status === "indexed" ? `${d.chunk_count} chunks · indexed` :
                 d.status === "failed" ? `failed — ${d.error || "unknown error"}` :
                 `${d.status}…`}
              </p>
            </div>
            <span className="lm-row__status" data-status={d.status}>{d.status}</span>
            <button onClick={() => del(d.id)} className="lm-row__del" aria-label={`Delete ${d.file_name}`} data-pulse="true">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))
      )}
      <SharedStyles />
    </div>
  );
}

/* ============================================================ */
/* Notes                                                        */
/* ============================================================ */

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
    <div className="grid gap-8 grid-cols-1 md:grid-cols-[200px_1fr]">
      <aside className="space-y-1">
        <button onClick={create} className="lm-action w-full justify-center" data-pulse="true">
          <Plus className="h-3.5 w-3.5" /> New note
        </button>
        <button onClick={() => setShowGraph((g) => !g)} className="lm-action lm-action--ghost w-full justify-center" data-pulse="true">
          {showGraph ? "Hide graph" : "Graph view"}
        </button>
        <div className="mt-4 space-y-0.5">
          {notes.map((n) => (
            <div key={n.id}
              className={`lm-note-item ${active?.id === n.id ? "is-active" : ""}`}
              onClick={() => { setActive(n); setShowGraph(false); }}
              onKeyDown={onActivate(() => { setActive(n); setShowGraph(false); })}
              role="button"
              tabIndex={0}
              aria-current={active?.id === n.id || undefined}
              data-pulse="true"
            >
              <span className="lm-note-item__title">{n.title}</span>
              <button onClick={(e) => { e.stopPropagation(); del(n.id); }} aria-label={`Delete ${n.title}`} className="lm-note-item__del">
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      </aside>

      <section>
        {showGraph ? (
          <div className="lm-surface-1" style={{ padding: 16, borderRadius: 14 }}>
            <NoteGraph onOpenNote={openNote} />
          </div>
        ) : active ? (
          <div className="space-y-3">
            <input
              value={active.title}
              onChange={(e) => setActive({ ...active, title: e.target.value })}
              className="lm-input lm-input--title"
            />
            <textarea
              value={active.content}
              rows={18}
              onChange={(e) => setActive({ ...active, content: e.target.value })}
              placeholder="Markdown supported. Link notes with [[Note title]]."
              className="lm-input lm-input--textarea"
            />
            <div className="flex justify-end">
              <button onClick={save} className="lm-action" data-pulse="true">Save</button>
            </div>
          </div>
        ) : (
          <p className="lm-body py-16 text-center" style={{ color: "hsl(0 0% 100% / 0.4)" }}>
            Pick a note from the left, or create a new one.
          </p>
        )}
      </section>
      <SharedStyles />
      <style jsx>{`
        .lm-note-item {
          display: flex; align-items: center; gap: 8px;
          padding: 8px 10px;
          border-radius: 10px;
          font-size: 13px;
          color: hsl(0 0% 100% / 0.7);
          cursor: pointer;
        }
        .lm-note-item:hover { background: hsl(0 0% 100% / 0.04); }
        .lm-note-item.is-active { background: hsl(0 0% 100% / 0.07); color: hsl(0 0% 100% / 0.96); }
        .lm-note-item__title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .lm-note-item__del { opacity: 0; color: hsl(0 0% 100% / 0.4); }
        .lm-note-item:hover .lm-note-item__del { opacity: 1; }
      `}</style>
    </div>
  );
}

/* ============================================================ */
/* Memory                                                       */
/* ============================================================ */

type MemoryEntry = { id: string; key: string; value: string; content?: string; updated_at?: number };

function MemoryTab() {
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState("");

  async function load() {
    const j = await fetch("/api/memory").then((r) => r.json()).catch(() => ({ memory: [] }));
    const list: MemoryEntry[] = Array.isArray(j.memory) ? j.memory : Array.isArray(j.entries) ? j.entries : [];
    setEntries(list);
    setLoaded(true);
  }
  useEffect(() => { load(); }, []);

  async function del(id: string) {
    await fetch(`/api/memory/${id}`, { method: "DELETE" }).catch(() => null);
    setEntries((cur) => cur.filter((e) => e.id !== id));
  }

  const text = (e: MemoryEntry) => `${e.key ?? ""} ${e.value ?? e.content ?? ""}`.toLowerCase();
  const visible = entries.filter((e) => !filter || text(e).includes(filter.toLowerCase()));

  return (
    <div>
      <div className="flex items-center gap-3 mb-8">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter memory…"
          className="lm-input flex-1"
        />
        <button onClick={load} className="lm-icon-btn" aria-label="Refresh" data-pulse="true">
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>
      {!loaded ? (
        <p className="lm-body" style={{ color: "hsl(0 0% 100% / 0.4)" }}>Loading…</p>
      ) : visible.length === 0 ? (
        <p className="lm-body py-16 text-center" style={{ color: "hsl(0 0% 100% / 0.4)" }}>
          {entries.length === 0
            ? "No memory entries yet. Sora will add what she learns about you here."
            : "No entries match your filter."}
        </p>
      ) : (
        visible.map((m) => (
          <div key={m.id} className="lm-row">
            <span className="lm-row__icon"><Brain className="h-4 w-4" /></span>
            <div className="lm-row__main">
              <p className="lm-row__title">{m.key}</p>
              <p className="lm-micro" style={{ textTransform: "none", letterSpacing: 0, whiteSpace: "pre-wrap" }}>{m.value ?? m.content}</p>
            </div>
            <button onClick={() => del(m.id)} className="lm-row__del" aria-label="Delete entry" data-pulse="true">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))
      )}
      <SharedStyles />
    </div>
  );
}

/* ============================================================ */
/* Sharing                                                      */
/* ============================================================ */

type SharePolicy = "private" | "fleet-readable" | "fleet-queryable";
type PolicyRow = { document_id: string; policy: SharePolicy; granted_peers: string[]; updated_at: number };
type SharingItem = { id: string; kind: "document" | "note"; title: string; policy: SharePolicy; granted_peers: string[] };

function SharingTab() {
  const [items, setItems] = useState<SharingItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState("");

  async function load() {
    setLoaded(false);
    const [docsR, notesR, polR] = await Promise.all([
      fetch("/api/knowledge/documents").then((r) => r.json()),
      fetch("/api/knowledge/notes").then((r) => r.json()),
      fetch("/api/knowledge/share-policy").then((r) => r.json()),
    ]);
    const policies = new Map<string, PolicyRow>(((polR.policies as PolicyRow[]) || []).map((p) => [p.document_id, p]));
    const out: SharingItem[] = [];
    for (const d of docsR.documents || []) {
      const p = policies.get(d.id);
      out.push({ id: d.id, kind: "document", title: d.file_name || d.id, policy: (p?.policy as SharePolicy) || "private", granted_peers: p?.granted_peers || [] });
    }
    for (const n of notesR.notes || []) {
      const p = policies.get(n.id);
      out.push({ id: n.id, kind: "note", title: n.title || n.id, policy: (p?.policy as SharePolicy) || "private", granted_peers: p?.granted_peers || [] });
    }
    setItems(out);
    setLoaded(true);
  }
  useEffect(() => { load(); }, []);

  async function updatePolicy(item: SharingItem, policy: SharePolicy) {
    if (policy === "private") {
      const r = await fetch(`/api/knowledge/share-policy/${item.id}`, { method: "DELETE" });
      if (!r.ok) { toast("Could not revert to private", "error"); return; }
    } else {
      const r = await fetch(`/api/knowledge/share-policy/${item.id}`, {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ policy, granted_peers: item.granted_peers }),
      });
      if (!r.ok) { toast("Could not update policy", "error"); return; }
    }
    setItems((cur) => cur.map((i) => (i.id === item.id ? { ...i, policy } : i)));
  }

  async function updateGranted(item: SharingItem, csv: string) {
    const granted = csv.split(",").map((s) => s.trim()).filter(Boolean);
    if (item.policy === "private") return;
    const r = await fetch(`/api/knowledge/share-policy/${item.id}`, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ policy: item.policy, granted_peers: granted }),
    });
    if (!r.ok) { toast("Could not update granted peers", "error"); return; }
    setItems((cur) => cur.map((i) => (i.id === item.id ? { ...i, granted_peers: granted } : i)));
  }

  const visible = items.filter(
    (i) => !filter || i.title.toLowerCase().includes(filter.toLowerCase()) || i.id.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter…"
          className="lm-input flex-1"
        />
        <button onClick={load} className="lm-icon-btn" aria-label="Refresh" data-pulse="true">
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>
      <p className="lm-micro mb-8" style={{ textTransform: "none", letterSpacing: 0 }}>
        Per-document sharing. Paired peers can search <em>queryable</em> items (snippets only),
        or fetch full content of <em>readable</em> items. Every cross-machine query is audited on both sides.
      </p>
      {!loaded ? (
        <p className="lm-body" style={{ color: "hsl(0 0% 100% / 0.4)" }}>Loading…</p>
      ) : visible.length === 0 ? (
        <p className="lm-body py-16 text-center" style={{ color: "hsl(0 0% 100% / 0.4)" }}>
          {items.length === 0 ? "No documents or notes yet." : "Nothing matches your filter."}
        </p>
      ) : (
        <div className="lm-surface-1" style={{ borderRadius: 14, overflow: "hidden" }}>
          <table className="w-full">
            <thead>
              <tr style={{ borderBottom: "1px solid hsl(0 0% 100% / 0.08)" }}>
                <th className="lm-th text-left">Title</th>
                <th className="lm-th text-left">Kind</th>
                <th className="lm-th text-left">Policy</th>
                <th className="lm-th text-left">Granted peers (comma-separated; blank = any)</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => (
                <tr key={item.id} style={{ borderBottom: "1px solid hsl(0 0% 100% / 0.04)" }}>
                  <td className="lm-td">
                    <div className="lm-body" style={{ color: "hsl(0 0% 100% / 0.92)" }}>{item.title}</div>
                    <div className="lm-micro" style={{ fontFamily: "ui-monospace,monospace", textTransform: "none" }}>{item.id}</div>
                  </td>
                  <td className="lm-td"><span className="lm-chip">{item.kind}</span></td>
                  <td className="lm-td">
                    <select
                      value={item.policy}
                      onChange={(e) => updatePolicy(item, e.target.value as SharePolicy)}
                      className="lm-select"
                    >
                      <option value="private">private</option>
                      <option value="fleet-queryable">fleet-queryable</option>
                      <option value="fleet-readable">fleet-readable</option>
                    </select>
                  </td>
                  <td className="lm-td" style={{ minWidth: 280 }}>
                    <input
                      defaultValue={item.granted_peers.join(", ")}
                      onBlur={(e) => updateGranted(item, e.target.value)}
                      placeholder="(any paired peer)"
                      disabled={item.policy === "private"}
                      className="lm-input"
                      style={{ fontSize: 12, fontFamily: "ui-monospace,monospace", padding: "4px 8px" }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <SharedStyles />
    </div>
  );
}

/* ============================================================ */
/* Peer search                                                  */
/* ============================================================ */

type PeerSnippet = {
  document_id: string; kind: "document" | "note"; title: string; snippet: string; score: number;
  policy: string; peer_node_id: string; peer_label: string | null;
};

function PeerSearchTab() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PeerSnippet[]>([]);
  const [perPeer, setPerPeer] = useState<Array<{ peer_node_id: string; peer_label: string | null; ok: boolean; reason?: string; results: unknown[] }>>([]);
  const [busy, setBusy] = useState(false);
  const [fetched, setFetched] = useState<Record<string, string>>({});

  async function search() {
    if (!q.trim()) return;
    setBusy(true);
    setResults([]);
    setFetched({});
    try {
      const r = await fetch("/api/knowledge/peer-search", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: q.trim(), limit_per_peer: 10 }),
      });
      const j = await r.json();
      setResults((j.merged as PeerSnippet[]) || []);
      setPerPeer(j.per_peer || []);
    } finally {
      setBusy(false);
    }
  }

  async function fetchOne(snippet: PeerSnippet) {
    const key = `${snippet.peer_node_id}:${snippet.document_id}`;
    setFetched((cur) => ({ ...cur, [key]: "Full-fetch via the peer_knowledge agent tool: operation=fetch." }));
  }

  return (
    <div>
      <BigSearch
        value={q}
        onChange={setQ}
        placeholder="Search across paired peers…"
        onSubmit={search}
        busy={busy}
      />
      <p className="lm-micro mt-4" style={{ textTransform: "none", letterSpacing: 0 }}>
        Fans out with a 5-second timeout per peer. Snippets only — full content requires fetch. Both sides&apos; audit logs record every query.
      </p>

      {perPeer.length > 0 && (
        <div className="mt-8 lm-surface-1" style={{ padding: 14, borderRadius: 14 }}>
          <p className="lm-micro mb-3">Peer responses · {perPeer.length}</p>
          <div className="space-y-1.5">
            {perPeer.map((p) => (
              <div key={p.peer_node_id} className="flex items-center gap-3 lm-body">
                <span className="lm-chip" data-tone={p.ok ? "ok" : "fail"}>{p.ok ? "ok" : "fail"}</span>
                <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 11, color: "hsl(0 0% 100% / 0.7)" }}>
                  {p.peer_node_id.slice(0, 16)}…
                </span>
                <span style={{ color: "hsl(0 0% 100% / 0.5)", fontSize: 12 }}>{p.peer_label ?? ""}</span>
                <span className="ml-auto" style={{ color: "hsl(0 0% 100% / 0.7)", fontSize: 12 }}>
                  {p.ok ? `${p.results.length} result(s)` : (p.reason ?? "no reason")}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-6 space-y-3">
        {results.map((s) => {
          const key = `${s.peer_node_id}:${s.document_id}`;
          return (
            <article key={`${s.peer_node_id}-${s.document_id}`} className="lm-result">
              <header className="flex items-center gap-2 mb-2">
                <span className="lm-chip">{s.kind}</span>
                <span className="lm-body" style={{ color: "hsl(0 0% 100% / 0.96)" }}>{s.title}</span>
                <span className="lm-micro" style={{ textTransform: "none", letterSpacing: 0 }}>
                  on {s.peer_label || s.peer_node_id.slice(0, 12)}
                </span>
                <span className="ml-auto lm-micro">{s.score}</span>
              </header>
              <pre className="lm-snippet">{s.snippet}</pre>
              <div className="mt-3 flex items-center gap-2">
                <button
                  className="lm-action lm-action--ghost"
                  disabled={s.policy !== "fleet-readable"}
                  onClick={() => fetchOne(s)}
                  data-pulse="true"
                >
                  Fetch full content
                </button>
                {s.policy !== "fleet-readable" && (
                  <span className="lm-micro" style={{ textTransform: "none", letterSpacing: 0 }}>peer policy: {s.policy}</span>
                )}
              </div>
              {fetched[key] && (
                <p className="lm-micro mt-3" style={{ textTransform: "none", letterSpacing: 0 }}>{fetched[key]}</p>
              )}
            </article>
          );
        })}
        {perPeer.length > 0 && results.length === 0 && (
          <p className="lm-body py-12 text-center" style={{ color: "hsl(0 0% 100% / 0.4)" }}>
            No matching snippets from any peer.
          </p>
        )}
      </div>
      <SharedStyles />
    </div>
  );
}

/* ============================================================ */
/* Shared primitives                                            */
/* ============================================================ */

function BigSearch({ value, onChange, placeholder, onSubmit, busy }:
  { value: string; onChange: (v: string) => void; placeholder: string; onSubmit: () => void; busy: boolean }) {
  return (
    <div className="lm-bigsearch">
      <Search className="h-4 w-4" style={{ color: "hsl(0 0% 100% / 0.4)" }} />
      <input
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onSubmit()}
        placeholder={placeholder}
      />
      <button onClick={onSubmit} disabled={busy || !value.trim()} className="lm-action" data-pulse="true" data-pulse-action="search">
        {busy ? "…" : "Search"}
      </button>
      <style jsx>{`
        .lm-bigsearch {
          display: flex; align-items: center; gap: 12px;
          padding: 14px 18px;
          background: hsl(0 0% 100% / 0.04);
          border: 1px solid hsl(0 0% 100% / 0.10);
          border-radius: 14px;
          transition: border-color var(--lm-dur-micro) var(--lm-ease-micro);
        }
        .lm-bigsearch:focus-within { border-color: hsl(0 0% 100% / 0.24); }
        .lm-bigsearch input {
          flex: 1;
          background: transparent;
          color: hsl(0 0% 100% / 0.96);
          font-size: 15px;
          letter-spacing: -0.005em;
          outline: none;
          border: none;
        }
      `}</style>
    </div>
  );
}

function SharedStyles() {
  return (
    <style jsx global>{`
      .lm-input {
        background: hsl(0 0% 100% / 0.04);
        border: 1px solid hsl(0 0% 100% / 0.10);
        border-radius: 12px;
        padding: 8px 12px;
        color: hsl(0 0% 100% / 0.96);
        font-size: 13px;
        letter-spacing: -0.005em;
        outline: none;
        transition: border-color var(--lm-dur-micro) var(--lm-ease-micro);
      }
      .lm-input:focus { border-color: hsl(0 0% 100% / 0.24); }
      .lm-input:disabled { opacity: 0.4; cursor: not-allowed; }
      .lm-input--title { font-size: 16px; font-weight: 500; padding: 10px 14px; }
      .lm-input--textarea { width: 100%; resize: vertical; font-family: ui-monospace, monospace; padding: 12px 14px; }
      .lm-select {
        background: hsl(0 0% 100% / 0.04);
        border: 1px solid hsl(0 0% 100% / 0.10);
        border-radius: 8px;
        padding: 4px 8px;
        color: hsl(0 0% 100% / 0.92);
        font-size: 12px;
        outline: none;
      }
      .lm-select option { background: hsl(234 18% 8%); color: hsl(0 0% 100%); }

      .lm-action {
        display: inline-flex; align-items: center; gap: 6px;
        padding: 8px 14px;
        background: hsl(0 0% 100%);
        color: hsl(234 22% 4%);
        border-radius: 12px;
        font-size: 12.5px; letter-spacing: -0.005em; font-weight: 500;
        transition: box-shadow var(--lm-dur-micro) var(--lm-ease-micro), opacity var(--lm-dur-micro) var(--lm-ease-micro);
      }
      .lm-action:hover { box-shadow: 0 0 16px hsl(0 0% 100% / 0.35); }
      .lm-action:disabled { opacity: 0.35; cursor: not-allowed; }
      .lm-action--ghost {
        background: transparent;
        color: hsl(0 0% 100% / 0.85);
        border: 1px solid hsl(0 0% 100% / 0.10);
      }
      .lm-action--ghost:hover { background: hsl(0 0% 100% / 0.05); box-shadow: none; }

      .lm-icon-btn {
        width: 36px; height: 36px;
        display: inline-flex; align-items: center; justify-content: center;
        background: hsl(0 0% 100% / 0.04);
        border: 1px solid hsl(0 0% 100% / 0.08);
        border-radius: 12px;
        color: hsl(0 0% 100% / 0.75);
      }
      .lm-icon-btn:hover { background: hsl(0 0% 100% / 0.08); }

      .lm-chip {
        display: inline-flex; align-items: center;
        padding: 2px 8px;
        font-size: 10.5px;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: hsl(0 0% 100% / 0.7);
        border: 1px solid hsl(0 0% 100% / 0.12);
        border-radius: 9999px;
      }
      .lm-chip[data-tone="ok"] { color: hsl(0 0% 100%); border-color: hsl(0 0% 100% / 0.3); }
      .lm-chip[data-tone="fail"] { color: hsl(0 100% 78%); border-color: hsl(0 90% 64% / 0.4); }

      .lm-result {
        padding: 14px 16px;
        background: hsl(0 0% 100% / 0.03);
        border: 1px solid hsl(0 0% 100% / 0.07);
        border-radius: 14px;
        transition: background var(--lm-dur-micro) var(--lm-ease-micro);
      }
      .lm-result:hover { background: hsl(0 0% 100% / 0.05); }

      .lm-snippet {
        font-size: 12px;
        white-space: pre-wrap;
        padding: 10px 12px;
        background: hsl(0 0% 100% / 0.04);
        border-radius: 8px;
        color: hsl(0 0% 100% / 0.85);
      }

      .lm-row {
        display: grid;
        grid-template-columns: 32px 1fr auto auto;
        align-items: center;
        gap: 14px;
        padding: 14px 4px;
        border-bottom: 1px solid hsl(0 0% 100% / 0.06);
      }
      .lm-row:hover { background: hsl(0 0% 100% / 0.025); }
      .lm-row__icon {
        display: inline-flex; align-items: center; justify-content: center;
        width: 32px; height: 32px;
        border-radius: 10px;
        background: hsl(0 0% 100% / 0.04);
        color: hsl(0 0% 100% / 0.72);
      }
      .lm-row__main { min-width: 0; }
      .lm-row__title { font-size: 13.5px; color: hsl(0 0% 100% / 0.94); letter-spacing: -0.005em; }
      .lm-row__status {
        font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase;
        padding: 3px 8px; border-radius: 9999px;
        color: hsl(0 0% 100% / 0.6); border: 1px solid hsl(0 0% 100% / 0.10);
      }
      .lm-row__status[data-status="indexed"] { color: hsl(0 0% 100%); border-color: hsl(0 0% 100% / 0.3); }
      .lm-row__status[data-status="failed"] { color: hsl(0 100% 78%); border-color: hsl(0 90% 64% / 0.4); }
      .lm-row__del {
        color: hsl(0 0% 100% / 0.3);
        opacity: 0;
        transition: opacity var(--lm-dur-micro) var(--lm-ease-micro), color var(--lm-dur-micro) var(--lm-ease-micro);
      }
      .lm-row:hover .lm-row__del { opacity: 1; }
      .lm-row__del:hover { color: hsl(0 100% 78%); }

      .lm-th {
        padding: 10px 14px;
        font-size: 10.5px;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: hsl(0 0% 100% / 0.45);
        font-weight: 500;
      }
      .lm-td { padding: 10px 14px; vertical-align: middle; }
    `}</style>
  );
}
