"use client";

/**
 * Report improvement — always-available dialog.
 *
 * Captures route + optional note + recent client errors (+ optional screenshot),
 * POSTs to /api/reports/improvement, and shows the local model's suggestions.
 * Nothing leaves the box.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Flag, Loader2, X, Camera, ImagePlus } from "lucide-react";
import { toast } from "@/components/toast";
import {
  ensureErrorRing,
  recentClientErrors,
} from "@/lib/client/error-ring";
import type { ReportAnalysis } from "@/lib/db/user-reports";
import { REPORT_EVENT } from "@/lib/client/report-improvement";

export { openReportImprovement, REPORT_EVENT } from "@/lib/client/report-improvement";

type Phase = "compose" | "analyzing" | "done";

export function ReportImprovement() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [includeShot, setIncludeShot] = useState(false);
  const [shotPreview, setShotPreview] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("compose");
  const [analysis, setAnalysis] = useState<ReportAnalysis | null>(null);
  const [reportId, setReportId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Read inside the key handler without re-subscribing on every phase change.
  const phaseRef = useRef<Phase>(phase);
  phaseRef.current = phase;

  const route =
    typeof window !== "undefined"
      ? `${pathname || "/"}${window.location.search || ""}`
      : pathname || "/";

  useEffect(() => {
    ensureErrorRing();
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setNote("");
    setIncludeShot(false);
    setShotPreview(null);
    setPhase("compose");
    setAnalysis(null);
    setReportId(null);
    setError(null);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    reset();
  }, [reset]);

  useEffect(() => {
    const onOpen = () => {
      reset();
      setOpen(true);
    };
    window.addEventListener(REPORT_EVENT, onOpen);
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        onOpen();
        return;
      }
      // Escape dismisses, except while the model is mid-analysis.
      if (e.key === "Escape") {
        setOpen((cur) => {
          if (!cur || phaseRef.current === "analyzing") return cur;
          reset();
          return false;
        });
      }
    };
    window.addEventListener("keydown", onKey);

    // Electron Help menu / preload
    const api = (window as unknown as {
      lmBrowser?: { onReportImprovement?: (cb: () => void) => () => void };
    }).lmBrowser;
    const unsub = api?.onReportImprovement?.(onOpen);

    return () => {
      window.removeEventListener(REPORT_EVENT, onOpen);
      window.removeEventListener("keydown", onKey);
      unsub?.();
    };
  }, [reset]);

  async function grabScreenshot() {
    try {
      // Prefer a file the user picks; full-page capture without deps is unreliable.
      fileRef.current?.click();
    } catch {
      toast("Could not open image picker", "error");
    }
  }

  async function captureDomRough() {
    try {
      const html = document.documentElement.outerHTML.slice(0, 80_000);
      // Encode a tiny SVG snapshot of text context isn't useful as image —
      // instead mark that we attempted; real shot via file/camera below.
      void html;
      const stream = await (navigator.mediaDevices as any)
        ?.getDisplayMedia?.({
          video: { displaySurface: "browser" },
          preferCurrentTab: true,
        })
        .catch(() => null);
      if (!stream) {
        toast("Pick an image instead, or describe the issue in the note", "info");
        fileRef.current?.click();
        return;
      }
      const track = stream.getVideoTracks()[0];
      const video = document.createElement("video");
      video.srcObject = stream;
      await video.play();
      await new Promise((r) => setTimeout(r, 120));
      const canvas = document.createElement("canvas");
      canvas.width = Math.min(video.videoWidth || 1280, 1280);
      canvas.height = Math.min(
        video.videoHeight || 720,
        Math.round((canvas.width / (video.videoWidth || 1280)) * (video.videoHeight || 720))
      );
      const ctx = canvas.getContext("2d");
      ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);
      track.stop();
      stream.getTracks().forEach((t: MediaStreamTrack) => t.stop());
      const url = canvas.toDataURL("image/jpeg", 0.72);
      setShotPreview(url);
      setIncludeShot(true);
    } catch {
      fileRef.current?.click();
    }
  }

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result || "");
      if (url.length > 2_000_000) {
        toast("Image too large — try a smaller screenshot", "error");
        return;
      }
      setShotPreview(url);
      setIncludeShot(true);
    };
    reader.readAsDataURL(file);
  }

  async function submit() {
    setError(null);
    setPhase("analyzing");
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const r = await fetch("/api/reports/improvement", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: ac.signal,
        body: JSON.stringify({
          note,
          route,
          clientErrors: recentClientErrors(),
          userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
          screenshotDataUrl: includeShot ? shotPreview : null,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        throw new Error(j.error || `Report failed (${r.status})`);
      }
      setAnalysis(j.analysis as ReportAnalysis);
      setReportId(j.report?.id || null);
      setPhase("done");
      toast("Report saved locally — suggestions ready", "success");
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setPhase("compose");
      toast(msg, "error");
    } finally {
      abortRef.current = null;
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-4 lm-overlay-in"
      style={{ background: "hsl(234 22% 2% / 0.55)", backdropFilter: "blur(8px)" }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="lm-report-title"
      onClick={close}
    >
      <div
        className="w-full max-w-lg lm-panel-in"
        style={{
          borderRadius: 14,
          border: "1px solid hsl(0 0% 100% / 0.12)",
          background: "hsl(234 18% 8% / 0.96)",
          boxShadow: "0 24px 64px hsl(0 0% 0% / 0.45)",
          maxHeight: "min(88vh, 720px)",
          overflow: "auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-2 px-4 py-3 border-b border-white/10">
          <Flag className="h-4 w-4 text-white/70" />
          <h2 id="lm-report-title" className="text-sm font-medium text-white/95 flex-1">
            Report improvement
          </h2>
          <span className="text-[10px] text-white/35 hidden sm:inline">⌘⇧F</span>
          <button
            type="button"
            onClick={close}
            className="p-1 rounded-md text-white/50 hover:text-white hover:bg-white/5"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="px-4 py-3 space-y-3">
          <p className="text-xs text-white/50 leading-relaxed">
            Stays on this machine. Your note plus recent errors are sent to the
            active local model for concrete suggestions — nothing is uploaded.
          </p>

          <div>
            <label className="text-[10px] uppercase tracking-wide text-white/40">Route</label>
            <p className="text-xs text-white/75 font-mono truncate mt-0.5">{route || "/"}</p>
          </div>

          {phase !== "done" && (
            <>
              <div>
                <label htmlFor="lm-report-note" className="text-[10px] uppercase tracking-wide text-white/40">
                  What should improve?
                </label>
                <textarea
                  id="lm-report-note"
                  rows={4}
                  value={note}
                  disabled={phase === "analyzing"}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. Chat header feels cramped on laptop; model picker hard to find…"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white/95 placeholder:text-white/30 outline-none focus:border-white/25 resize-y min-h-[88px]"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={phase === "analyzing"}
                  onClick={captureDomRough}
                  className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-white/10 text-white/70 hover:bg-white/5"
                >
                  <Camera className="h-3.5 w-3.5" />
                  Capture screen
                </button>
                <button
                  type="button"
                  disabled={phase === "analyzing"}
                  onClick={grabScreenshot}
                  className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-white/10 text-white/70 hover:bg-white/5"
                >
                  <ImagePlus className="h-3.5 w-3.5" />
                  Attach image
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={onPickFile}
                />
                {shotPreview && (
                  <label className="inline-flex items-center gap-1.5 text-xs text-white/55">
                    <input
                      type="checkbox"
                      checked={includeShot}
                      onChange={(e) => setIncludeShot(e.target.checked)}
                    />
                    Include screenshot
                  </label>
                )}
              </div>
              {shotPreview && includeShot && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={shotPreview}
                  alt="Report attachment preview"
                  className="max-h-36 rounded-md border border-white/10 object-contain bg-black/30"
                />
              )}
            </>
          )}

          {phase === "analyzing" && (
            <div className="flex items-center gap-2 text-sm text-white/70 py-6 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" />
              Asking the local model…
            </div>
          )}

          {error && (
            <p className="text-xs text-red-300/90 border border-red-400/20 rounded-md px-2.5 py-2 bg-red-500/5">
              {error}
            </p>
          )}

          {phase === "done" && analysis && (
            <div className="space-y-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-medium text-white/95">{analysis.title}</h3>
                  <span
                    className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-white/15 text-white/55"
                  >
                    {analysis.severity}
                  </span>
                </div>
                <p className="text-xs text-white/60 mt-1 leading-relaxed">{analysis.summary}</p>
                {reportId && (
                  <p className="text-[10px] text-white/35 mt-1 font-mono">{reportId}</p>
                )}
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-white/40 mb-1">Suggestions</p>
                <ul className="space-y-1.5">
                  {analysis.suggestions.map((s, i) => (
                    <li
                      key={i}
                      className="text-xs text-white/80 leading-snug pl-2 border-l border-white/15"
                    >
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
              {analysis.related_areas.length > 0 && (
                <p className="text-[11px] text-white/40">
                  Areas: {analysis.related_areas.join(" · ")}
                </p>
              )}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 px-4 py-3 border-t border-white/10">
          {phase === "done" ? (
            <>
              <button
                type="button"
                onClick={() => {
                  reset();
                  setOpen(true);
                }}
                className="text-xs px-3 py-1.5 rounded-md text-white/60 hover:bg-white/5"
              >
                Report another
              </button>
              <button
                type="button"
                onClick={close}
                className="text-xs px-3 py-1.5 rounded-md bg-white text-black font-medium"
                data-pulse="true"
              >
                Done
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={close}
                disabled={phase === "analyzing"}
                className="text-xs px-3 py-1.5 rounded-md text-white/60 hover:bg-white/5"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={phase === "analyzing" || (!note.trim() && recentClientErrors().length === 0)}
                className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-white text-black font-medium disabled:opacity-40"
                data-pulse="true"
              >
                {phase === "analyzing" ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Analyzing…
                  </>
                ) : (
                  "Send to local model"
                )}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
