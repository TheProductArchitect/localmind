"use client";
import { useEffect, useState } from "react";
import { Button, Card, Input, Textarea, Badge, EmptyState } from "@/components/ui";
import { toast } from "@/components/toast";

export default function DevPmPage() {
  const [codebases, setCodebases] = useState<any[]>([]);
  const [form, setForm] = useState({ name: "", path: "" });
  const [standup, setStandup] = useState("");
  const [prDiff, setPrDiff] = useState("");
  const [prReview, setPrReview] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => fetch("/api/devpm/codebases").then((r) => r.json()).then((j) => setCodebases(j.codebases || []));
  useEffect(() => { load(); }, []);

  async function add() {
    if (!form.name || !form.path) return;
    await fetch("/api/devpm/codebases", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(form),
    });
    setForm({ name: "", path: "" });
    load();
  }
  async function index(id: string) {
    toast("Indexing codebase…");
    const j = await (await fetch(`/api/devpm/codebases/${id}/index`, { method: "POST" })).json();
    toast(j.files !== undefined ? `Indexed ${j.files} files` : j.error || "Failed", j.files !== undefined ? "success" : "error");
    load();
  }
  async function del(id: string) { await fetch(`/api/devpm/codebases/${id}`, { method: "DELETE" }); load(); }

  async function genStandup(kind: string) {
    setBusy(true);
    setStandup("Generating…");
    const j = await (await fetch("/api/devpm/standup", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind }),
    })).json();
    setStandup(j.standup || j.error || "Failed");
    setBusy(false);
  }
  async function review() {
    if (!prDiff.trim()) return;
    setBusy(true);
    setPrReview("Reviewing…");
    const j = await (await fetch("/api/devpm/pr-review", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ diff: prDiff }),
    })).json();
    setPrReview(j.review || j.error || "Failed");
    setBusy(false);
  }

  return (
    <div className="h-full overflow-y-auto p-6 space-y-4">
      <h1 className="text-xl font-semibold">DevPM</h1>
      <p className="text-sm text-muted-foreground">
        Register codebases so the DevPM persona (switch to it in the chat toolbar) is aware of them.
      </p>

      <Card className="p-4 space-y-2">
        <p className="font-medium text-sm">Register a codebase</p>
        <div className="flex gap-2">
          <Input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-44" />
          <Input placeholder="Absolute path" value={form.path} onChange={(e) => setForm({ ...form, path: e.target.value })} />
          <Button size="sm" onClick={add}>Add</Button>
        </div>
      </Card>

      {codebases.length === 0 ? (
        <EmptyState title="No codebases registered" hint="Add a local project directory above, then index it." />
      ) : (
        codebases.map((c) => (
          <Card key={c.id} className="p-3 flex items-center gap-2">
            <div className="flex-1">
              <p className="text-sm font-medium">{c.name}</p>
              <p className="text-xs text-muted-foreground">
                {c.path} · {c.file_count} files ·
                {c.last_indexed_at ? ` indexed ${new Date(c.last_indexed_at).toLocaleString()}` : " not indexed"}
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={() => index(c.id)}>Index</Button>
            <Button size="sm" variant="ghost" onClick={() => del(c.id)}>Remove</Button>
          </Card>
        ))
      )}

      <Card className="p-4 space-y-2">
        <div className="flex items-center gap-2">
          <p className="font-medium text-sm flex-1">Standup &amp; status</p>
          <Button size="sm" disabled={busy} onClick={() => genStandup("standup")}>Daily standup</Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => genStandup("weekly")}>Weekly summary</Button>
        </div>
        {standup && <pre className="text-xs whitespace-pre-wrap bg-muted/40 rounded p-3">{standup}</pre>}
      </Card>

      <Card className="p-4 space-y-2">
        <p className="font-medium text-sm">PR review assistant</p>
        <Textarea placeholder="Paste a unified diff…" rows={6} value={prDiff}
          onChange={(e) => setPrDiff(e.target.value)} />
        <Button size="sm" disabled={busy} onClick={review}>Generate review</Button>
        {prReview && <pre className="text-xs whitespace-pre-wrap bg-muted/40 rounded p-3">{prReview}</pre>}
      </Card>
    </div>
  );
}
