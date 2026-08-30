"use client";

import { Volume2 } from "lucide-react";

export type SpeakHandle = {
  done: Promise<void>;
  cancel: () => void;
};

/** Local text-to-speech via the browser's Speech Synthesis API. */
export function speak(text: string, opts?: { onEnd?: () => void }): SpeakHandle {
  if (typeof window === "undefined" || !window.speechSynthesis) {
    opts?.onEnd?.();
    return { done: Promise.resolve(), cancel: () => {} };
  }
  const utterance = new SpeechSynthesisUtterance(text.slice(0, 4000));
  let resolve: () => void = () => {};
  const done = new Promise<void>((doneResolve) => {
    resolve = doneResolve;
  });
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    try {
      opts?.onEnd?.();
    } catch {
      /* ignore */
    }
    resolve();
  };
  utterance.onend = finish;
  utterance.onerror = finish;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
  return {
    done,
    cancel: () => {
      try {
        window.speechSynthesis.cancel();
      } catch {
        /* ignore */
      }
      finish();
    },
  };
}

export function SpeakerButton({ text }: { text: string }) {
  return (
    <button
      type="button"
      title="Read aloud"
      onClick={() => speak(text)}
      className="text-muted-foreground hover:text-foreground"
    >
      <Volume2 className="h-3.5 w-3.5" />
    </button>
  );
}
