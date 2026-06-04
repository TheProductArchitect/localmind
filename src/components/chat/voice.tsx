"use client";
import { useEffect, useRef, useState } from "react";
import { Mic, Volume2, MicOff, Loader2, Radio } from "lucide-react";
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

export function MicButton({ onText }: { onText: (t: string) => void }) {
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
          onText(j.text.trim());
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
 */

export function speak(text: string) {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  const u = new SpeechSynthesisUtterance(text.slice(0, 4000));
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
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
