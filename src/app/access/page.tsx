"use client";
import { useEffect, useState } from "react";
import { Button, Card, Input, Badge, EmptyState } from "@/components/ui";
import { toast } from "@/components/toast";
import { startRegistration } from "@simplewebauthn/browser";

const TABS = ["Users", "Sessions", "My Passkeys"];

export default function AccessPage() {
  const [tab, setTab] = useState("Users");
  const [me, setMe] = useState<any>(null);
  useEffect(() => { fetch("/api/auth/me").then((r) => r.json()).then((j) => setMe(j.user)); }, []);
  return (
    <div className="h-full overflow-y-auto p-6">
      <h1 className="text-xl font-semibold mb-3">Access Control</h1>
      <div className="flex gap-2 mb-4">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`rounded-full px-3 py-1 text-sm border ${tab === t ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>
            {t}
          </button>
        ))}
      </div>
      {tab === "Users" && <UsersTab isOwner={me?.role === "owner"} />}
      {tab === "Sessions" && <SessionsTab />}
      {tab === "My Passkeys" && <PasskeysTab />}
    </div>
  );
}

function UsersTab({ isOwner }: { isOwner: boolean }) {
  const [users, setUsers] = useState<any[]>([]);
  const [form, setForm] = useState({ display_name: "", role: "member", pin: "" });
  const [err, setErr] = useState<string | null>(null);
  const load = () => fetch("/api/users").then((r) => r.json()).then((j) => {
    if (j.error) setErr(j.error); else setUsers(j.users || []);
  });
  useEffect(() => { load(); }, []);

  async function add() {
    if (!form.display_name || form.pin.length < 4) return;
    const r = await fetch("/api/users", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(form),
    });
    const j = await r.json();
    toast(j.user ? "User created" : j.error || "Failed", j.user ? "success" : "error");
    setForm({ display_name: "", role: "member", pin: "" });
    load();
  }
  async function remove(id: string) {
    await fetch(`/api/users/${id}`, { method: "DELETE" });
    load();
  }

  if (err) return <p className="text-sm text-muted-foreground">{err}</p>;
  return (
    <div className="space-y-3">
      {isOwner && (
        <Card className="p-4 space-y-2">
          <p className="font-medium text-sm">Add a user account</p>
          <div className="flex gap-2 flex-wrap">
            <Input placeholder="Display name" value={form.display_name}
              onChange={(e) => setForm({ ...form, display_name: e.target.value })} className="w-44" />
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}
              className="h-9 rounded-md border bg-background px-2 text-sm">
              <option value="member">Member</option>
              <option value="guest">Guest</option>
              <option value="owner">Owner</option>
            </select>
            <Input type="password" placeholder="PIN (4+ digits)" value={form.pin}
              onChange={(e) => setForm({ ...form, pin: e.target.value })} className="w-36" />
            <Button size="sm" onClick={add}>Add</Button>
          </div>
        </Card>
      )}
      {users.map((u) => (
        <Card key={u.id} className="p-3 flex items-center gap-2">
          <span className="h-8 w-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs">
            {u.display_name.slice(0, 2).toUpperCase()}
          </span>
          <div className="flex-1">
            <p className="text-sm font-medium">{u.display_name}</p>
            <p className="text-xs text-muted-foreground">{u.role} · auth: {u.auth_method}</p>
          </div>
          <Badge variant="outline">{u.role}</Badge>
          {isOwner && u.role !== "owner" && (
            <Button size="sm" variant="ghost" onClick={() => remove(u.id)}>Deactivate</Button>
          )}
        </Card>
      ))}
    </div>
  );
}

function SessionsTab() {
  const [sessions, setSessions] = useState<any[]>([]);
  const load = () => fetch("/api/sessions").then((r) => r.json()).then((j) => setSessions(j.sessions || []));
  useEffect(() => { load(); }, []);
  async function revoke(id: string) {
    await fetch(`/api/sessions/${id}`, { method: "DELETE" });
    load();
  }
  return (
    <div className="space-y-2">
      {sessions.length === 0 && <EmptyState title="No active sessions" hint="Sessions appear here when users sign in." />}
      {sessions.map((s) => (
        <Card key={s.id} className="p-3 flex items-center gap-2">
          <div className="flex-1">
            <p className="text-sm font-medium">{s.user_name} {s.current && <Badge variant="success">this device</Badge>}</p>
            <p className="text-xs text-muted-foreground truncate">
              {s.device} · {s.ip} · {s.auth_method} · active {new Date(s.last_active_at).toLocaleString()}
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={() => revoke(s.id)}>Revoke</Button>
        </Card>
      ))}
    </div>
  );
}

function PasskeysTab() {
  async function register() {
    try {
      const begin = await (await fetch("/api/auth/passkey/register/begin", { method: "POST" })).json();
      if (begin.error) throw new Error(begin.error);
      const attestation = await startRegistration(begin.options);
      const r = await fetch("/api/auth/passkey/register/complete", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ attestation }),
      });
      const j = await r.json();
      toast(j.ok ? "Passkey registered" : j.error || "Failed", j.ok ? "success" : "error");
    } catch (e: any) {
      toast(e?.message || "Passkey registration failed", "error");
    }
  }
  return (
    <Card className="p-4 space-y-2">
      <p className="font-medium text-sm">Passkeys</p>
      <p className="text-xs text-muted-foreground">
        Register a passkey to sign in with Face ID or Touch ID instead of a PIN. Passkeys are
        bound to this origin and cannot be phished.
      </p>
      <Button size="sm" onClick={register}>Register a passkey on this device</Button>
    </Card>
  );
}
