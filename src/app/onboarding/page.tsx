"use client";
import { useState } from "react";
import { Button, Card, Input } from "@/components/ui";
import { CURATED_MODELS } from "@/lib/curated-models";

export default function Onboarding() {
  const [step, setStep] = useState(1);
  const [name, setName] = useState("Assistant");
  const [personality, setPersonality] = useState("Friendly");
  const [model, setModel] = useState<string | null>(null);
  const [pulling, setPulling] = useState<{ pct: number; status: string } | null>(null);
  const [installed, setInstalled] = useState(false);
  const [pin, setPin] = useState("");

  async function patch(p: any) {
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(p),
    });
  }

  async function pull() {
    if (!model) return;
    setPulling({ pct: 0, status: "starting" });
    const res = await fetch("/api/models/pull", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: model }),
    });
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const chunks = buf.split("\n\n");
      buf = chunks.pop() || "";
      for (const c of chunks) {
        const line = c.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        const o = JSON.parse(line.slice(6));
        if (o.type === "progress") setPulling({ pct: o.pct, status: o.status });
        if (o.type === "done") { setPulling(null); setInstalled(true); await patch({ active_model: model }); }
        if (o.type === "error") { setPulling(null); alert(o.message); }
      }
    }
  }

  async function finish() {
    await patch({ assistant_name: name, personality, onboarded: 1, ...(pin.length >= 4 ? { pin } : {}) });
    // Create the owner account (V2 multi-user). PIN required; default to a derived one if skipped.
    await fetch("/api/auth/bootstrap", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ display_name: name || "Owner", pin: pin.length >= 4 ? pin : "0000" }),
    }).catch(() => {});
    window.location.href = "/";
  }

  return (
    <div className="h-full flex items-center justify-center p-6 bg-muted/20">
      <Card className="w-full max-w-lg p-6">
        <p className="text-xs text-muted-foreground mb-2">Step {step} of 6</p>

        {step === 1 && (
          <>
            <h1 className="text-xl font-semibold mb-2">Welcome to LocalMind</h1>
            <p className="text-sm text-muted-foreground mb-4">
              LocalMind is a private AI assistant that runs entirely on your Mac. Nothing is sent
              anywhere unless you explicitly connect a cloud provider. After setup, you never need
              the terminal again.
            </p>
            <Button onClick={() => setStep(2)}>Continue</Button>
          </>
        )}

        {step === 2 && (
          <>
            <h1 className="text-lg font-semibold mb-3">Choose your AI runtime</h1>
            <Card className="p-3 mb-2 border-primary">
              <p className="font-medium text-sm">Ollama — Recommended</p>
              <p className="text-xs text-muted-foreground">Runs fully on your Mac, no internet needed.</p>
            </Card>
            <p className="text-xs text-muted-foreground mb-4">
              Cloud providers can be added later in Settings.
            </p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(1)}>Back</Button>
              <Button onClick={() => setStep(3)}>Continue</Button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h1 className="text-lg font-semibold mb-3">Pull your first model</h1>
            <div className="space-y-2 mb-3">
              {CURATED_MODELS.map((m) => (
                <button
                  key={m.name}
                  onClick={() => setModel(m.name)}
                  className={`w-full text-left rounded-md border p-2 text-sm ${
                    model === m.name ? "border-primary bg-accent" : ""
                  }`}
                >
                  <p className="font-medium">{m.name}</p>
                  <p className="text-xs text-muted-foreground">{m.description} · {m.size}</p>
                </button>
              ))}
            </div>
            {pulling && (
              <div className="mb-3">
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div className="h-full bg-primary" style={{ width: `${pulling.pct}%` }} />
                </div>
                <p className="text-xs text-muted-foreground mt-1">{pulling.pct}% — {pulling.status}</p>
              </div>
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(2)}>Back</Button>
              {!installed ? (
                <Button disabled={!model || !!pulling} onClick={pull}>Download</Button>
              ) : (
                <Button onClick={() => setStep(4)}>Continue</Button>
              )}
            </div>
          </>
        )}

        {step === 4 && (
          <>
            <h1 className="text-lg font-semibold mb-3">Name and personality</h1>
            <label className="block text-sm mb-3">
              Assistant name
              <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1" />
            </label>
            <div className="flex gap-2 mb-4">
              {["Professional", "Friendly", "Concise"].map((t) => (
                <button
                  key={t}
                  onClick={() => setPersonality(t)}
                  className={`flex-1 rounded-md border p-2 text-sm ${
                    personality === t ? "border-primary bg-accent" : ""
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(3)}>Back</Button>
              <Button onClick={() => setStep(5)}>Continue</Button>
              <Button variant="ghost" onClick={() => setStep(5)}>Skip for now</Button>
            </div>
          </>
        )}

        {step === 5 && (
          <>
            <h1 className="text-lg font-semibold mb-3">What can it access</h1>
            <p className="text-sm text-muted-foreground mb-4">
              All permissions start off. You can grant access any time from the Permissions board.
              The default profile is Normal — read operations are allowed, writes and sends ask first.
            </p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(4)}>Back</Button>
              <Button onClick={() => setStep(6)}>Continue</Button>
            </div>
          </>
        )}

        {step === 6 && (
          <>
            <h1 className="text-lg font-semibold mb-3">Set a PIN</h1>
            <p className="text-sm text-muted-foreground mb-3">
              Your PIN protects sensitive actions like deleting files or sending emails. Without a
              PIN, the AI can take any permitted action without asking you to confirm.
            </p>
            <Input
              type="password"
              placeholder="4+ digit PIN"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              className="w-48 mb-4"
            />
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(5)}>Back</Button>
              <Button onClick={finish}>Finish setup</Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
