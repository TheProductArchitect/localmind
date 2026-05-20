"use client";
import { useEffect, useState } from "react";
import { Button, Input } from "@/components/ui";
import { AlertTriangle, Lock } from "lucide-react";

export type ConfirmationState = {
  toolCallId: string;
  actionType: string;
  preview: string;
  timeoutSeconds: number;
  requiresPin?: boolean;
};

export function ConfirmationCard({
  c,
  onDecide,
}: {
  c: ConfirmationState;
  onDecide: (decision: "allow" | "deny", pin?: string) => void;
}) {
  const [remaining, setRemaining] = useState(c.timeoutSeconds);
  const [pin, setPin] = useState("");

  useEffect(() => {
    const t = setInterval(() => setRemaining((r) => Math.max(0, r - 1)), 1000);
    return () => clearInterval(t);
  }, []);

  const pinReady = !c.requiresPin || pin.length >= 4;

  return (
    <div className="my-3 rounded-md border-2 border-amber-500 bg-amber-50 dark:bg-amber-950/20 p-3" role="alertdialog">
      <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
        <AlertTriangle className="h-4 w-4" aria-hidden="true" />
        <span className="font-medium text-sm">Confirmation required: {c.actionType}</span>
        <span className="ml-auto text-xs" role="timer" aria-live="assertive">{remaining}s remaining</span>
      </div>
      {c.requiresPin && (
        <p className="mt-1 flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
          <Lock className="h-3 w-3" /> This is a protected action — your PIN is required to allow it.
        </p>
      )}
      <pre className="mt-2 text-xs whitespace-pre-wrap bg-background rounded p-2 border">{c.preview}</pre>
      <div className="mt-3 flex flex-col sm:flex-row sm:items-center gap-2">
        <Input
          type="password"
          inputMode="numeric"
          placeholder={c.requiresPin ? "PIN (required)" : "PIN (if required)"}
          aria-label="Confirmation PIN"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          className="h-8 w-full sm:w-40"
        />
        <Button size="sm" disabled={!pinReady} onClick={() => onDecide("allow", pin || undefined)}>
          Allow once
        </Button>
        <Button size="sm" variant="destructive" onClick={() => onDecide("deny")}>
          Deny
        </Button>
      </div>
    </div>
  );
}
