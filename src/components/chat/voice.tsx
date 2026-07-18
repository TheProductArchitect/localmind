"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, Volume2, MicOff, Loader2, Radio, MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * MicButton — local speech-to-text with two modes:
 *   1. Press-to-talk (click): single round-trip to /api/voice/stt.
 *   2. Continuous (shift-click): 2.5s timeslices POSTed to /api/voice/stt-stream?vad=1,
 *      text appended live, auto-stop after 2 consecutive silent chunks.
 *
 * Audio never leaves the box — whisper.cpp runs on the same machine.
 */

type MicState = "idle" | "recording" | "transcribing" | "streaming";

export function MicButton({ onText }: { onText: (t: string, opts?: { append?: boolean }) => void }) {
  const [state, setState] = useState<MicState>("idle");
  const [available, setAvailable] = useState<boolean | null>(null);
  const [tooltip, setTooltip] = useState("Click: dictate · Shift-click: continuous");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const silentRunRef = useRef<number>(0);
  const stoppingRef = useRef<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/voice/stt")
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        setAvailable(!!j.ready);
        if (!j.ready && j.hint) setTooltip(j.hint);
      })
      .catch(() => { if (!cancelled) setAvailable(false); });
    return () => { cancelled = true; };
  }, []);

  function pickMime(): string {
    const opts = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
    return opts.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
  }

  async function startPressToTalk() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      audioChunksRef.current = [];
      const mime = pickMime();
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      mediaRecorderRef.current = rec;

      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        const blob = new Blob(audioChunksRef.current, { type: rec.mimeType || "audio/webm" });
        if (blob.size < 500) { setState("idle"); return; }
        setState("transcribing");
        try {
          const r = await fetch("/api/voice/stt", {
            method: "POST",
            headers: { "content-type": rec.mimeType || "audio/webm" },
            body: blob,
          });
          if (!r.ok) {
            const j = await r.json().catch(() => ({}));
            setTooltip(j.error || "STT failed — check whisper.cpp install");
            return;
          }
          const { text } = (await r.json()) as { text?: string };
          if (text && text.trim()) onText(text.trim());
        } finally {
          setState("idle");
        }
      };

      rec.start();
      setState("recording");
    } catch (e) {
      console.warn("[mic] failed to start:", e);
      setTooltip("Microphone access denied or unavailable");
      setState("idle");
    }
  }

  async function startContinuous() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      silentRunRef.current = 0;
      stoppingRef.current = false;
      const mime = pickMime();
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      mediaRecorderRef.current = rec;

      // Per-chunk POST: each 2.5s timeslice fires `ondataavailable`
      // independently. We transcribe each chunk and append the result live.
      rec.ondataavailable = async (e) => {
        if (!e.data || e.data.size < 500 || stoppingRef.current) return;
        const blob = new Blob([e.data], { type: rec.mimeType || "audio/webm" });
        try {
          const r = await fetch("/api/voice/stt-stream?vad=1", {
            method: "POST",
            headers: { "content-type": rec.mimeType || "audio/webm" },
            body: blob,
          });
          if (!r.ok) return;
          const j = (await r.json()) as { text?: string; silent?: boolean };
          if (j.silent || !j.text) {
            silentRunRef.current += 1;
            if (silentRunRef.current >= 2) stopContinuous();
            return;
          }
          silentRunRef.current = 0;
          onText(j.text.trim(), { append: true });
        } catch { /* swallow; next chunk will try again */ }
      };
      rec.onstop = () => {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        setState("idle");
      };

      rec.start(2500);
      setState("streaming");
    } catch (e) {
      console.warn("[mic] continuous start failed:", e);
      setTooltip("Microphone access denied or unavailable");
      setState("idle");
    }
  }

  function stopPressToTalk() {
    const rec = mediaRecorderRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
  }

  function stopContinuous() {
    stoppingRef.current = true;
    const rec = mediaRecorderRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
  }

  if (available === false) return null;

  const onClick = (e: React.MouseEvent) => {
    if (state === "idle") {
      if (e.shiftKey) startContinuous();
      else startPressToTalk();
    } else if (state === "recording") {
      stopPressToTalk();
    } else if (state === "streaming") {
      stopContinuous();
    }
  };

  return (
    <button
      type="button"
      title={
        state === "streaming" ? "Continuous mode — click to stop" :
        state === "recording" ? "Recording — click to stop" :
        state === "transcribing" ? "Transcribing…" :
        tooltip
      }
      disabled={state === "transcribing"}
      onClick={onClick}
      aria-label={
        state === "recording" ? "Stop recording" :
        state === "streaming" ? "Stop continuous dictation" :
        state === "transcribing" ? "Transcribing" :
        "Start recording (shift-click for continuous)"
      }
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-md border",
        state === "recording" && "bg-destructive text-destructive-foreground animate-pulse",
        state === "streaming" && "bg-primary text-primary-foreground animate-pulse",
        state === "transcribing" && "bg-accent text-accent-foreground",
        state === "idle" && "hover:bg-accent"
      )}
    >
      {state === "transcribing" ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : state === "recording" ? (
        <MicOff className="h-4 w-4" />
      ) : state === "streaming" ? (
        <Radio className="h-4 w-4" />
      ) : (
        <Mic className="h-4 w-4" />
      )}
    </button>
  );
}

/**
 * Text-to-speech via the browser's built-in Speech Synthesis API — uses
 * the user's system voices and renders in-browser, no network.
 *
 * Returns a handle the caller can await/cancel. Conversation mode uses the
 * `done` promise to know when Sora has finished speaking so it can re-open
 * the mic without having the assistant transcribe itself.
 */
export type SpeakHandle = {
  done: Promise<void>;
  cancel: () => void;
};

export function speak(text: string, opts?: { onEnd?: () => void }): SpeakHandle {
  if (typeof window === "undefined" || !window.speechSynthesis) {
    opts?.onEnd?.();
    return { done: Promise.resolve(), cancel: () => {} };
  }
  const u = new SpeechSynthesisUtterance(text.slice(0, 4000));
  let resolve: () => void = () => {};
  const done = new Promise<void>((r) => { resolve = r; });
  const finish = () => { try { opts?.onEnd?.(); } catch { /* ignore */ } resolve(); };
  u.onend = finish;
  u.onerror = finish;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
  return {
    done,
    cancel: () => { try { window.speechSynthesis.cancel(); } catch { /* ignore */ } finish(); },
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

/* ============================================================ */
/* Conversation mode — hands-free                                */
/* ============================================================ */

type ConvState = "off" | "listening" | "thinking" | "speaking";

/**
 * <ConversationButton/> — hands-free voice loop.
 *
 * Click once to enter Conversation mode. From then on:
 *
 *   1. mic records continuously in 2.5s chunks → /api/voice/stt-stream
 *   2. transcribed text accumulates into a buffer
 *   3. after 2 consecutive silent chunks (~5s), the buffered utterance is
 *      sent via `onUtterance` and the mic pauses
 *   4. the chat page reports back when the assistant is busy and when its
 *      response is ready — TTS reads it via `speak()`
 *   5. once TTS ends, the mic re-opens for the next turn
 *
 * Click again to exit. The button visually mirrors the state (idle / pulsing
 * mic for listening / spinner for thinking / speaker for speaking) so the
 * user always knows whose turn it is.
 *
 * `assistantSay` is the text the parent wants spoken once. When it changes
 * to a non-empty string while in conversation mode, ConversationButton
 * speaks it and then resumes listening. The parent should clear it (set to
 * empty/null) right after handing it over to avoid double-speaking.
 */
export function ConversationButton({
  isAssistantBusy,
  assistantSay,
  onUtterance,
  onAssistantSpoken,
  onActiveChange,
}: {
  isAssistantBusy: boolean;
  assistantSay: string | null;
  onUtterance: (text: string) => void;
  onAssistantSpoken: () => void;
  onActiveChange?: (active: boolean) => void;
}) {
  const [state, setState] = useState<ConvState>("off");
  const [available, setAvailable] = useState<boolean | null>(null);
  // Async callbacks (TTS onEnd, MediaRecorder ondataavailable) outlive the
  // closure that scheduled them; we read the latest state via this ref so
  // they don't trigger restarts after the user has exited the mode.
  const stateRef = useRef<ConvState>("off");
  useEffect(() => { stateRef.current = state; }, [state]);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const bufferRef = useRef<string>("");
  const silentRunRef = useRef<number>(0);
  const stoppingRef = useRef<boolean>(false);
  const speakHandleRef = useRef<SpeakHandle | null>(null);

  // Probe whisper.cpp availability — same hint flow as the press-to-talk
  // MicButton. If STT isn't installed, the button hides.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/voice/stt").then((r) => r.json()).then((j) => {
      if (!cancelled) setAvailable(!!j.ready);
    }).catch(() => { if (!cancelled) setAvailable(false); });
    return () => { cancelled = true; };
  }, []);

  function pickMime(): string {
    const opts = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
    return opts.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
  }

  const startListening = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      silentRunRef.current = 0;
      stoppingRef.current = false;
      bufferRef.current = "";
      const mime = pickMime();
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      mediaRecorderRef.current = rec;

      rec.ondataavailable = async (e) => {
        if (!e.data || e.data.size < 500 || stoppingRef.current) return;
        const blob = new Blob([e.data], { type: rec.mimeType || "audio/webm" });
        try {
          const r = await fetch("/api/voice/stt-stream?vad=1", {
            method: "POST",
            headers: { "content-type": rec.mimeType || "audio/webm" },
            body: blob,
          });
          if (!r.ok) return;
          const j = (await r.json()) as { text?: string; silent?: boolean };
          if (j.silent || !j.text) {
            silentRunRef.current += 1;
            // After 2 consecutive silent chunks (~5s), submit whatever we've
            // accumulated. If buffer is empty, just keep listening — user
            // hasn't said anything yet.
            if (silentRunRef.current >= 2 && bufferRef.current.trim().length > 0) {
              const utterance = bufferRef.current.trim();
              bufferRef.current = "";
              silentRunRef.current = 0;
              await stopListeningOnly();
              setState("thinking");
              onUtterance(utterance);
            }
            return;
          }
          silentRunRef.current = 0;
          bufferRef.current = (bufferRef.current + " " + j.text.trim()).trim();
        } catch { /* swallow chunk failures */ }
      };
      rec.onstop = () => {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      };

      rec.start(2500);
      setState("listening");
    } catch (e) {
      console.warn("[conversation] mic start failed:", e);
      setState("off");
    }
  }, [onUtterance]);

  async function stopListeningOnly() {
    stoppingRef.current = true;
    const rec = mediaRecorderRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
  }

  async function leaveConversation() {
    stoppingRef.current = true;
    const rec = mediaRecorderRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
    speakHandleRef.current?.cancel();
    setState("off");
  }

  // Watch the parent's busy flag — when the assistant FINISHES (busy goes
  // from true to false), if we have text to speak we speak it; otherwise we
  // re-open the mic immediately.
  useEffect(() => {
    if (state === "off") return;
    if (state === "thinking" && !isAssistantBusy && !assistantSay) {
      // Edge case: assistant produced no spoken response (e.g. tool-only
      // turn). Just resume listening.
      startListening();
    }
  }, [state, isAssistantBusy, assistantSay, startListening]);

  // Watch for an assistant message to speak. When parent hands it over, we
  // TTS it and then resume listening.
  useEffect(() => {
    if (state === "off") return;
    if (!assistantSay || assistantSay.trim().length === 0) return;
    if (isAssistantBusy) return; // wait until streaming has finished
    setState("speaking");
    const handle = speak(assistantSay, {
      onEnd: () => {
        speakHandleRef.current = null;
        onAssistantSpoken();
        // Resume listening for the next turn — but only if we're still in
        // conversation mode (user may have clicked the button to exit).
        if (stateRef.current !== "off") startListening();
      },
    });
    speakHandleRef.current = handle;
  }, [assistantSay, isAssistantBusy, state, onAssistantSpoken, startListening]);

  // Report active-state changes to the parent so it can gate the
  // assistantSay handoff. We avoid calling on every render — only fire when
  // the boolean actually flips.
  const wasActiveRef = useRef(false);
  useEffect(() => {
    const active = state !== "off";
    if (active !== wasActiveRef.current) {
      wasActiveRef.current = active;
      onActiveChange?.(active);
    }
  }, [state, onActiveChange]);

  // Cleanup on unmount.
  useEffect(() => () => { leaveConversation(); }, []);

  if (available === false) return null;

  const onClick = () => {
    if (state === "off") startListening();
    else leaveConversation();
  };

  const active = state !== "off";
  const label =
    state === "listening" ? "Listening…" :
    state === "thinking"  ? "Thinking…"  :
    state === "speaking"  ? "Speaking…"  : "Start conversation";

  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      data-pulse-action={active ? "destructive" : "send"}
      className={cn(
        "inline-flex h-9 items-center gap-2 px-3 rounded-md border text-[12px] tracking-[-0.005em]",
        state === "off"       && "border-white/10 bg-white/[0.04] text-white/85 hover:bg-white/[0.07]",
        state === "listening" && "border-white/25 bg-white/[0.10] text-white animate-pulse",
        state === "thinking"  && "border-white/15 bg-white/[0.06] text-white/85",
        state === "speaking"  && "border-white/30 bg-white/[0.12] text-white",
      )}
    >
      {state === "thinking" ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : state === "speaking" ? (
        <Volume2 className="h-4 w-4" />
      ) : state === "listening" ? (
        <Radio className="h-4 w-4" />
      ) : (
        <MessageCircle className="h-4 w-4" />
      )}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
