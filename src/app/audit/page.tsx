"use client";
import { useEffect, useState } from "react";
import { Button, Input, Badge, EmptyState } from "@/components/ui";

type Row = {
  id: number; timestamp: number; action_type: string; tool_name: string;
  input: string; output_summary: string | null; status: string;
  approved_by: string; conversation_id: string | null;
};

const TOOLS = ["", "filesystem", "web_search", "memory", "calendar", "email", "mac_automation", "browser"];
const STATUSES = ["", "allowed", "denied", "pending", "failed"];

export default function AuditPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [tool, setTool] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [verify, setVerify] = useState<string | null>(null);
  const PAGE = 50;

  async function load() {
    const params = new URLSearchParams({
      q, tool, status, limit: String(PAGE), offset: String(page * PAGE),
    });
    const r = await fetch(`/api/audit?${params}`);
    const j = await r.json();
    setRows(j.rows || []);
  }
  useEffect(() => { load(); }, [page, tool, status]); // eslint-disable-line react-hooks/exhaustive-deps

  async function runVerify() {
    const r = await fetch("/api/audit/verify", { method: "POST" });
    const j = await r.json();
    setVerify(j.ok ? "Integrity verified — hash chain is unbroken." : `Tampering detected at row ${j.firstBadId}.`);
  }

  const statusVariant = (s: string) =>
    s === "allowed" ? "success" : s === "denied" ? "destructive" : s === "failed" ? "destructive" : "outline";

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="flex items-center gap-2 mb-4">
        <h1 className="text-xl font-semibold">Audit Log</h1>
        <div className="ml-auto flex gap-2 flex-wrap">
          <Input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && load()} className="w-40 h-8" />
          <select value={tool} onChange={(e) => { setPage(0); setTool(e.target.value); }}
            className="h-8 rounded-md border bg-background px-2 text-sm">
            {TOOLS.map((t) => <option key={t} value={t}>{t || "All tools"}</option>)}
          </select>
          <select value={status} onChange={(e) => { setPage(0); setStatus(e.target.value); }}
            className="h-8 rounded-md border bg-background px-2 text-sm">
            {STATUSES.map((s) => <option key={s} value={s}>{s || "All statuses"}</option>)}
          </select>
          <Button size="sm" variant="outline" onClick={load}>Search</Button>
          <Button size="sm" variant="outline" onClick={runVerify}>Verify Integrity</Button>
          <a href="/api/audit/export?format=csv"><Button size="sm" variant="outline">Export CSV</Button></a>
        </div>
      </div>

      {verify && <div className="mb-3 text-sm rounded-md border px-3 py-2 bg-muted/30">{verify}</div>}

      {rows.length === 0 ? (
        <EmptyState
          title="No actions have been taken yet"
          hint="When the AI uses a tool, it will appear here with its full input and output."
        />
      ) : (
        <div className="border rounded-md divide-y">
          {rows.map((r) => (
            <div key={r.id}>
              <button
                className="w-full flex items-center gap-3 px-3 py-2 text-sm text-left hover:bg-accent/40"
                aria-expanded={expanded === r.id}
                aria-controls={`audit-detail-${r.id}`}
                onClick={() => setExpanded(expanded === r.id ? null : r.id)}
              >
                <span className="text-muted-foreground w-36 shrink-0">
                  {new Date(r.timestamp).toLocaleString()}
                </span>
                <span className="w-32 shrink-0">{r.action_type}</span>
                <span className="w-28 shrink-0 text-muted-foreground">{r.tool_name}</span>
                <Badge variant={statusVariant(r.status) as any}>{r.status}</Badge>
                <span className="text-xs text-muted-foreground ml-auto">{r.approved_by}</span>
              </button>
              {expanded === r.id && (
                <div id={`audit-detail-${r.id}`} className="px-3 py-2 bg-muted/30 text-xs space-y-2">
                  <div>
                    <p className="font-medium">Input</p>
                    <pre className="overflow-x-auto">{r.input}</pre>
                  </div>
                  <div>
                    <p className="font-medium">Output</p>
                    <pre className="overflow-x-auto whitespace-pre-wrap">{r.output_summary || "(none)"}</pre>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 mt-3">
        <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
          Previous
        </Button>
        <span className="text-xs text-muted-foreground">Page {page + 1}</span>
        <Button size="sm" variant="outline" disabled={rows.length < 50} onClick={() => setPage((p) => p + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}
