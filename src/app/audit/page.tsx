"use client";
import { useEffect, useState } from "react";
import { Button, Input, Badge, EmptyState } from "@/components/ui";
import { toast } from "@/components/toast";

type Row = {
  id: number; timestamp: number; action_type: string; tool_name: string;
  input: string; output_summary: string | null; status: string;
  approved_by: string; conversation_id: string | null;
};

type PeerVerification = {
  peer_node_id: string;
  direction: "inbound" | "outbound";
  peer_audit_id: number;
  ok: boolean;
  chain_ok?: boolean;
  reason?: string;
  row_excerpt?: { action_type: string; tool_name: string; status: string; timestamp: number };
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
  const [peerVerifications, setPeerVerifications] = useState<Record<number, { loading: boolean; data?: PeerVerification[]; note?: string }>>({});
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

  async function verifyPeerChain(rowId: number) {
    setPeerVerifications((cur) => ({ ...cur, [rowId]: { loading: true } }));
    try {
      const r = await fetch(`/api/audit/${rowId}/verify-peer`);
      const j = await r.json();
      setPeerVerifications((cur) => ({
        ...cur,
        [rowId]: { loading: false, data: j.verifications ?? [], note: j.note },
      }));
      if (!j.verifications?.length && j.note) {
        toast(j.note);
      }
    } catch (e) {
      setPeerVerifications((cur) => ({
        ...cur,
        [rowId]: { loading: false, note: (e as Error).message || "peer verify failed" },
      }));
    }
  }

  const statusVariant = (s: string) =>
    s === "allowed" ? "success" : s === "denied" ? "destructive" : s === "failed" ? "destructive" : "outline";

  return (
    <div className="mx-auto max-w-6xl px-10 py-14">
      <div className="flex items-end justify-between gap-6 mb-10">
        <div>
          <p className="lm-micro mb-2">Audit</p>
          <h1 className="lm-display">Every action, traceable</h1>
        </div>
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
                  {/* V6.4 cross-references — for rows linked to a peer's audit, show
                      a button that verifies their chain over /api/audit/[id]/verify-peer. */}
                  <div className="flex items-center gap-2 border-t pt-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={peerVerifications[r.id]?.loading}
                      onClick={() => verifyPeerChain(r.id)}
                    >
                      {peerVerifications[r.id]?.loading ? "Verifying…" : "Show peer chain"}
                    </Button>
                    <span className="text-muted-foreground">
                      Fetches the peer's audit row and confirms their hash chain is intact.
                    </span>
                  </div>
                  {peerVerifications[r.id] && !peerVerifications[r.id].loading && (
                    <div className="space-y-1">
                      {peerVerifications[r.id].note && (
                        <p className="text-muted-foreground italic">{peerVerifications[r.id].note}</p>
                      )}
                      {peerVerifications[r.id].data?.length === 0 && !peerVerifications[r.id].note && (
                        <p className="text-muted-foreground italic">No peer cross-references on this row.</p>
                      )}
                      {peerVerifications[r.id].data?.map((v) => (
                        <div
                          key={`${v.peer_node_id}-${v.peer_audit_id}-${v.direction}`}
                          className="rounded border bg-card px-2 py-1.5 flex items-start gap-2"
                        >
                          <Badge variant={v.ok ? (v.chain_ok !== false ? "success" : "warning") : "destructive"}>
                            {v.direction}
                          </Badge>
                          <div className="flex-1 min-w-0">
                            <div className="font-mono text-[11px]">
                              peer {v.peer_node_id.slice(0, 12)}… row #{v.peer_audit_id}
                            </div>
                            {v.row_excerpt && (
                              <div className="text-muted-foreground">
                                {v.row_excerpt.action_type} / {v.row_excerpt.tool_name} ({v.row_excerpt.status})
                              </div>
                            )}
                            {!v.ok && v.reason && (
                              <div className="text-destructive">{v.reason}</div>
                            )}
                            {v.ok && v.chain_ok === false && (
                              <div className="text-amber-600">peer reports their chain is broken</div>
                            )}
                            {v.ok && v.chain_ok && (
                              <div className="text-green-600">peer chain intact</div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
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
