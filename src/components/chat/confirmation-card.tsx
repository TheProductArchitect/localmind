"use client";
import { useEffect, useState } from "react";
import { Lock } from "lucide-react";

export type ConfirmationState = {
  toolCallId: string;
  actionType: string;
  preview: string;
  timeoutSeconds: number;
  requiresPin?: boolean;
};

/**
 * Mono glass confirmation — matches v2 chat chrome (not amber/shadcn).
 * Intensity comes from hairline glow + timer, not a second accent color.
 */
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
  const urgent = remaining <= 10;

  return (
    <div className="lm-confirm" role="alertdialog" aria-labelledby={`confirm-${c.toolCallId}`}>
      <div className="lm-confirm__head">
        <span className="lm-micro" id={`confirm-${c.toolCallId}`}>
          Needs you · {c.actionType}
        </span>
        <span
          className="lm-confirm__timer"
          role="timer"
          aria-live="assertive"
          data-urgent={urgent || undefined}
        >
          {remaining}s
        </span>
      </div>
      {c.requiresPin && (
        <p className="lm-confirm__pin-note">
          <Lock className="h-3 w-3" aria-hidden />
          Protected action — PIN required to allow.
        </p>
      )}
      <pre className="lm-confirm__preview">{c.preview}</pre>
      <div className="lm-confirm__actions">
        <input
          type="password"
          inputMode="numeric"
          placeholder={c.requiresPin ? "PIN (required)" : "PIN (optional)"}
          aria-label="Confirmation PIN"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          className="lm-input lm-confirm__pin"
        />
        <button
          type="button"
          className="lm-action"
          disabled={!pinReady}
          data-pulse="true"
          data-pulse-action="save"
          onClick={() => onDecide("allow", pin || undefined)}
        >
          Allow once
        </button>
        <button
          type="button"
          className="lm-action lm-action--ghost"
          data-pulse="true"
          data-pulse-action="destructive"
          onClick={() => onDecide("deny")}
        >
          Deny
        </button>
      </div>
    </div>
  );
}
