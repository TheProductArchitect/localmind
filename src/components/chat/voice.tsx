"use client";
import { useEffect, useRef, useState } from "react";
import { Mic, Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";

// Browser-native speech recognition — runs on the user's device, nothing uploaded.
export function MicButton({ onText }: { onText: (t: string) => void }) {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(true);
  const recRef = useRef<any>(null);

  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { setSupported(false); return; }
    const rec = new SR();
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = "en-US";
    rec.onresult = (e: any) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      onText(text);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
  }, [onText]);

  if (!supported) return null;
  return (
    <button
      type="button"
      title="Dictate (local)"
      onClick={() => {
        if (listening) { recRef.current?.stop(); setListening(false); }
        else { recRef.current?.start(); setListening(true); }
      }}
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-md border",
        listening ? "bg-destructive text-destructive-foreground" : "hover:bg-accent"
      )}
    >
      <Mic className="h-4 w-4" />
    </button>
  );
}

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
