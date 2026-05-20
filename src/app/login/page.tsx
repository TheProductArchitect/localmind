"use client";
import { useEffect, useState } from "react";
import { Button, Card, Input } from "@/components/ui";
import { startAuthentication } from "@simplewebauthn/browser";

type Account = { id: string; display_name: string; role: string; avatar?: string };

export default function LoginPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selected, setSelected] = useState<Account | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((j) => {
        if (j.user) { window.location.href = "/"; return; }
        if (!j.hasUsers) { window.location.href = "/onboarding"; return; }
        setAccounts(j.accounts || []);
        if (j.accounts?.length === 1) setSelected(j.accounts[0]);
      });
  }, []);

  async function login() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    const r = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: selected.id, pin }),
    });
    if (r.ok) { window.location.href = "/"; return; }
    const j = await r.json().catch(() => ({}));
    setError(j.error || "Login failed");
    setBusy(false);
  }

  async function loginPasskey() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const begin = await fetch("/api/auth/passkey/authenticate/begin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: selected.id }),
      }).then((r) => r.json());
      if (begin.error) throw new Error(begin.error);
      const assertion = await startAuthentication(begin.options);
      const complete = await fetch("/api/auth/passkey/authenticate/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: selected.id, assertion }),
      });
      if (complete.ok) { window.location.href = "/"; return; }
      const j = await complete.json().catch(() => ({}));
      throw new Error(j.error || "Passkey login failed");
    } catch (e: any) {
      setError(e?.message || "Passkey login failed");
      setBusy(false);
    }
  }

  return (
    <div className="h-screen flex items-center justify-center bg-muted/20">
      <Card className="w-full max-w-sm p-6">
        <h1 className="text-xl font-semibold mb-1">LocalMind</h1>
        <p className="text-sm text-muted-foreground mb-4">Sign in to continue.</p>

        {!selected ? (
          <div className="space-y-2">
            {accounts.map((a) => (
              <button
                key={a.id}
                onClick={() => setSelected(a)}
                className="w-full flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent"
              >
                <span className="h-7 w-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs">
                  {a.display_name.slice(0, 2).toUpperCase()}
                </span>
                {a.display_name}
                <span className="ml-auto text-xs text-muted-foreground">{a.role}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm">Signing in as <b>{selected.display_name}</b></p>
            <Input
              type="password"
              placeholder="PIN"
              value={pin}
              autoFocus
              onChange={(e) => setPin(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && login()}
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex gap-2">
              <Button onClick={login} disabled={busy || pin.length < 4}>Sign in</Button>
              <Button variant="outline" onClick={loginPasskey} disabled={busy}>Use passkey</Button>
            </div>
            {accounts.length > 1 && (
              <button className="text-xs text-muted-foreground" onClick={() => setSelected(null)}>
                ← Choose a different account
              </button>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
