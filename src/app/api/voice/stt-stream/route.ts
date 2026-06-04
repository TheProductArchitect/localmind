/**
 * POST /api/voice/stt-stream — per-chunk streaming STT.
 *
 * The browser's MicButton (in continuous mode) records audio with a
 * timeslice of 2-3 seconds and POSTs EACH chunk independently here. The
 * endpoint runs whisper-cli on just that chunk and returns the transcribed
 * text. The browser concatenates results as they arrive — UX feels live.
 *
 * This is the pragmatic path on Next.js. True streaming with VAD-driven
 * overlapping windows needs WebSockets and a long-lived whisper-stream
 * process; that's a focused project of its own. The chunked approach gets
 * usable "voice assistant" UX in ~2-3s perceived latency.
 *
 * Each chunk is a self-contained webm/opus or wav blob — same envelope as
 * /api/voice/stt. The only difference is the expected USE: the caller
 * sends many small chunks instead of one long recording.
 *
 * Optional `?vad=1` query param: drop the request silently if the chunk has
 * no detected speech (silence-only chunk). Determined by ffmpeg's
 * `silencedetect` filter applied to the WAV during conversion. Helps keep
 * the client UI clean — no "<empty>" results stacking up between utterances.
 */

import { NextRequest, NextResponse } from "next/server";
import { spawn, spawnSync } from "child_process";
import fs from "fs/promises";
import path from "path";
import os from "os";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_CHUNK_BYTES = 4 * 1024 * 1024; // 4 MiB per chunk — enough for ~5s of opus
const WHISPER_TIMEOUT_MS = 20_000;
const MODEL_PATH =
  process.env.LOCALMIND_WHISPER_MODEL ||
  path.join(process.env.HOME || os.homedir(), ".localmind", "models", "ggml-base.en.bin");

function which(cmd: string): string | null {
  const r = spawnSync("/usr/bin/env", ["bash", "-c", `command -v ${cmd}`], { encoding: "utf8" });
  const out = (r.stdout || "").trim();
  return out || null;
}

export async function POST(req: NextRequest) {
  const whisper = which("whisper-cli");
  const ffmpeg = which("ffmpeg");
  if (!whisper || !ffmpeg) {
    return NextResponse.json(
      { error: !whisper ? "whisper-cli not on PATH" : "ffmpeg not on PATH" },
      { status: 503 }
    );
  }
  try { await fs.access(MODEL_PATH); }
  catch {
    return NextResponse.json({ error: `Whisper model not found at ${MODEL_PATH}` }, { status: 503 });
  }

  let inputBuf: Buffer;
  try {
    const ab = await req.arrayBuffer();
    inputBuf = Buffer.from(ab);
  } catch (e) {
    return NextResponse.json({ error: `Could not read audio chunk: ${(e as Error).message}` }, { status: 400 });
  }
  if (inputBuf.byteLength === 0) {
    return NextResponse.json({ ok: true, text: "", silent: true });
  }
  if (inputBuf.byteLength > MAX_CHUNK_BYTES) {
    return NextResponse.json(
      { error: `Chunk exceeds ${MAX_CHUNK_BYTES / 1024 / 1024} MiB. Reduce client timeslice.` },
      { status: 413 }
    );
  }

  const vadEnabled = req.nextUrl.searchParams.get("vad") === "1";
  const stamp = `lm-stt-stream-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tmpDir = path.join(os.tmpdir(), stamp);
  await fs.mkdir(tmpDir, { recursive: true });
  const inputPath = path.join(tmpDir, "chunk.bin");
  const wavPath = path.join(tmpDir, "chunk.wav");
  const txtPath = path.join(tmpDir, "chunk.wav.txt");
  await fs.writeFile(inputPath, inputBuf);

  const cleanup = async () => {
    try { await fs.rm(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  };

  try {
    // 1) Convert to 16 kHz mono WAV. Optionally also analyse for silence:
    // ffmpeg's silencedetect filter emits "silence_duration" on stderr when
    // the whole input is silent — we use that to short-circuit VAD chunks.
    const silenceTracking: { detected_total: number; chunk_seconds: number } = { detected_total: 0, chunk_seconds: 0 };
    await new Promise<void>((resolve, reject) => {
      const args = [
        "-y",
        "-i", inputPath,
        "-ac", "1",
        "-ar", "16000",
      ];
      if (vadEnabled) {
        // Detect silence segments. We don't TRIM — whisper handles short
        // silences fine — we just observe the totals on stderr.
        args.push("-af", "silencedetect=noise=-35dB:d=0.5");
      }
      args.push(wavPath);
      const ff = spawn(ffmpeg, args, { stdio: ["ignore", "ignore", "pipe"] });
      let err = "";
      ff.stderr.on("data", (b) => { err += b.toString("utf8"); });
      ff.on("error", reject);
      ff.on("exit", (code) => {
        if (code !== 0) return reject(new Error(`ffmpeg exit ${code}: ${err.slice(-400)}`));
        if (vadEnabled) {
          for (const m of err.matchAll(/silence_duration:\s*([\d.]+)/g)) {
            silenceTracking.detected_total += Number(m[1]) || 0;
          }
          const durMatch = err.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
          if (durMatch) {
            silenceTracking.chunk_seconds =
              Number(durMatch[1]) * 3600 + Number(durMatch[2]) * 60 + Number(durMatch[3]);
          }
        }
        resolve();
      });
    });

    // 2) VAD short-circuit. If the chunk is >90% silence, skip whisper.
    if (vadEnabled && silenceTracking.chunk_seconds > 0) {
      const silentRatio = silenceTracking.detected_total / silenceTracking.chunk_seconds;
      if (silentRatio > 0.9) {
        return NextResponse.json({
          ok: true,
          text: "",
          silent: true,
          silent_ratio: Math.round(silentRatio * 100) / 100,
        });
      }
    }

    // 3) Run whisper-cli on the chunk. Tiny model used here would be faster
    // but base.en strikes a better word-accuracy balance for live UX.
    await new Promise<void>((resolve, reject) => {
      const wh = spawn(whisper, [
        "-m", MODEL_PATH,
        "-f", wavPath,
        "-otxt",
        "-nt",
        "-l", "en",
      ], { stdio: ["ignore", "pipe", "pipe"] });
      let err = "";
      wh.stderr.on("data", (b) => { err += b.toString("utf8"); });
      wh.on("error", reject);
      const timer = setTimeout(() => {
        try { wh.kill("SIGTERM"); } catch { /* gone */ }
        reject(new Error(`whisper-cli timed out after ${WHISPER_TIMEOUT_MS / 1000}s`));
      }, WHISPER_TIMEOUT_MS);
      timer.unref?.();
      wh.on("exit", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`whisper-cli exit ${code}: ${err.slice(-200)}`));
      });
    });

    const text = (await fs.readFile(txtPath, "utf8").catch(() => "")).trim();
    return NextResponse.json({
      ok: true,
      text,
      silent: text.length === 0,
      bytes_in: inputBuf.byteLength,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message || "chunk transcription failed" },
      { status: 500 }
    );
  } finally {
    cleanup();
  }
}
