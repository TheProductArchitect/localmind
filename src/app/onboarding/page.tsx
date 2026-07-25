"use client";
import { useEffect, useState } from "react";
import { Button, Card, Input } from "@/components/ui";
import {
  CURATED_MODELS,
  isLikelyEmbeddingModel,
  modelTagsMatch,
  pickPreferredOllamaModel,
} from "@/lib/curated-models";

type InstalledModel = { name: string; family?: string; size?: number; modified?: string };

function fmtSize(n?: number) {
  if (!n) return null;
  return (n / 1e9).toFixed(1) + " GB";
}

export default function Onboarding() {
  const [step, setStep] = useState(1);
  const [name, setName] = useState("Assistant");
  const [personality, setPersonality] = useState("Friendly");
  const [model, setModel] = useState<string | null>(null);
  const [pulling, setPulling] = useState<{ pct: number; status: string } | null>(null);
  const [installed, setInstalled] = useState(false);
  const [pin, setPin] = useState("");
  const [existingModels, setExistingModels] = useState<InstalledModel[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [ollamaError, setOllamaError] = useState<string | null>(null);

  async function patch(p: any) {
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(p),
    });
  }

  // Discover already-installed Ollama models when entering the model step.
  useEffect(() => {
    if (step !== 3) return;
    let cancelled = false;
    (async () => {
      setLoadingModels(true);
      setOllamaError(null);
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const r = await fetch("/api/models?provider=ollama");
          const j = await r.json();
          if (cancelled) return;
          const chat = ((j.models || []) as InstalledModel[]).filter((m) => !isLikelyEmbeddingModel(m));
          if (j.error && chat.length === 0) {
            setOllamaError(j.error);
            await new Promise((res) => setTimeout(res, 800));
            continue;
          }
          setExistingModels(chat);
          setOllamaError(null);
          if (chat.length) {
            const pref = pickPreferredOllamaModel(chat);
            if (pref) {
              setModel(pref);
              setInstalled(true);
            }
          }
          setLoadingModels(false);
          return;
        } catch {
          await new Promise((res) => setTimeout(res, 800));
        }
      }
      if (!cancelled) {
        setLoadingModels(false);
        setOllamaError("Could not reach Ollama. Is it running?");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [step]);

  function selectExisting(name: string) {
    setModel(name);
    setInstalled(true);
  }

  function selectCurated(name: string) {
    setModel(name);
    const already = existingModels.some((m) => modelTagsMatch(m.name, name));
    setInstalled(already);
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
        if (o.type === "done") {
          setPulling(null);
          setInstalled(true);
          setExistingModels((prev) =>
            prev.some((m) => modelTagsMatch(m.name, model)) ? prev : [...prev, { name: model }]
          );
          await patch({ active_model: model, provider: "ollama" });
        }
        if (o.type === "error") {
          setPulling(null);
          alert(o.message);
        }
      }
    }
  }

  async function continueWithModel() {
    if (!model) return;
    await patch({ active_model: model, provider: "ollama" });
    setStep(4);
  }

  async function finish() {
    await patch({ assistant_name: name, personality, onboarded: 1, ...(pin.length >= 4 ? { pin } : {}) });
    const { notifyAssistantName } = await import("@/components/branding-sync");
    notifyAssistantName(name);
    // Create the owner account (V2 multi-user). PIN required; default to a derived one if skipped.
    await fetch("/api/auth/bootstrap", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ display_name: name || "Owner", pin: pin.length >= 4 ? pin : "0000" }),
    }).catch(() => {});
    window.location.href = "/";
  }

  const curatedNeedsDownload =
    !!model && !existingModels.some((m) => modelTagsMatch(m.name, model));

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
            <h1 className="text-lg font-semibold mb-3">
              {existingModels.length > 0 ? "Choose a model" : "Pull your first model"}
            </h1>

            {loadingModels && (
              <p className="text-xs text-muted-foreground mb-3">Looking for models already on this machine…</p>
            )}
            {ollamaError && !loadingModels && (
              <p className="text-xs text-destructive mb-3">{ollamaError}</p>
            )}

            {existingModels.length > 0 && (
              <>
                <p className="text-xs text-muted-foreground mb-2">Already installed on this machine</p>
                <div className="space-y-2 mb-4">
                  {existingModels.map((m) => (
                    <button
                      key={m.name}
                      type="button"
                      onClick={() => selectExisting(m.name)}
                      className={`w-full text-left rounded-md border p-2 text-sm ${
                        model === m.name ? "border-primary bg-accent" : ""
                      }`}
                    >
                      <p className="font-medium">{m.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {[m.family || "model", fmtSize(m.size)].filter(Boolean).join(" · ")}
                      </p>
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mb-2">Or pull another</p>
              </>
            )}

            <div className="space-y-2 mb-3">
              {CURATED_MODELS.map((m) => {
                const already = existingModels.some((x) => modelTagsMatch(x.name, m.name));
                return (
                  <button
                    key={m.name}
                    type="button"
                    onClick={() => selectCurated(m.name)}
                    className={`w-full text-left rounded-md border p-2 text-sm ${
                      model === m.name ? "border-primary bg-accent" : ""
                    }`}
                  >
                    <p className="font-medium">
                      {m.name}
                      {already ? (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">Installed</span>
                      ) : null}
                    </p>
                    <p className="text-xs text-muted-foreground">{m.description} · {m.size}</p>
                  </button>
                );
              })}
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
              {installed && model ? (
                <Button disabled={!!pulling} onClick={continueWithModel}>Continue</Button>
              ) : (
                <Button disabled={!model || !!pulling || !curatedNeedsDownload} onClick={pull}>
                  Download
                </Button>
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
