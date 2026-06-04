/**
 * POST /api/voice/stt
 *
 * Press-to-talk speech-to-text — entirely local. The user records audio in the
 * browser (MediaRecorder), POSTs the blob here, we convert to 16kHz mono WAV
 * via ffmpeg, run whisper.cpp (`whisper-cli`), and return the transcribed text.
 *
 * Defaults to the base.en model installed by the platform install script at
 * ~/.localmind/models/ggml-base.en.bin. The model path is overrideable via
 * the LOCALMIND_WHISPER_MODEL env var if a user wants a larger/multilingual one.
 *
 * Privacy: audio never leaves the box. The temp wav file is unlinked at the
 * end of the request. If anything throws, we still try to clean up.
 *
 * Limits:
 *   - 20 MiB request body cap (~20 min of webm/opus at typical bitrates)
 *   - 60s wall-clock for the whisper run; long recordings should be chunked
 *     by the caller (real streaming UX is a follow-up)
 *
 * Availability detection: if whisper-cli or ffmpeg aren't on PATH, returns
 * 503 with an actionable installation hint. The MicButton uses this to fall
 * back gracefully when the host hasn't run the install script's voice setup.
 */

import { NextRequest, NextResponse } from "next/server";
import { spawn, spawnSync } from "child_process";
import fs from "fs/promises";
import path from "path";
import os from "os";

export const runtime = "nodejs";
export const maxDuration = 90;

const MAX_BODY_BYTES = 20 * 1024 * 1024;
const WHISPER_TIMEOUT_MS = 60_000;
const MODEL_PATH =
  process.env.LOCALMIND_WHISPER_MODEL ||
  path.join(process.env.HOME || os.homedir(), ".localmind", "models", "ggml-base.en.bin");

function which(cmd: string): string | null {
  const r = spawnSync("/usr/bin/env", ["bash", "-c", `command -v ${cmd}`], { encoding: "utf8" });
  const out = (r.stdout || "").trim();
  return out || null;
}

export async function GET() {
  // Capability probe — used by the MicButton on mount to decide whether to
  // surface itself at all.
  const whisper = which("whisper-cli");
  const ffmpeg = which("ffmpeg");
  let modelExists = false;
  try { await fs.access(MODEL_PATH); modelExists = true; } catch { /* missing */ }
  const ready = !!(whisper && ffmpeg && modelExists);
  return NextResponse.json({
    ready,
    whisper_path: whisper,
    ffmpeg_path: ffmpeg,
    model_path: MODEL_PATH,
    model_present: modelExists,
    hint: ready
      ? "Local STT is ready."
      : !whisper
        ? "Install whisper.cpp: `brew install whisper-cpp` on macOS, or build from source on Linux. Then restart."
        : !ffmpeg
          ? "Install ffmpeg: `brew install ffmpeg` on macOS, `apt-get install -y ffmpeg` on Ubuntu/Debian."
          : `Download the model: \`curl -L https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin -o ${MODEL_PATH}\``,
  });
}

export async function POST(req: NextRequest) {
  const whisper = which("whisper-cli");
  const ffmpeg = which("ffmpeg");
  if (!whisper) {
    return NextResponse.json(
      { error: "whisper-cli not on PATH. Install whisper.cpp and restart LocalMind." },
      { status: 503 }
    );
  }
  if (!ffmpeg) {
    return NextResponse.json(
      { error: "ffmpeg not on PATH. Install ffmpeg and restart LocalMind." },
      { status: 503 }
    );
  }
  try { await fs.access(MODEL_PATH); }
  catch {
    return NextResponse.json(
      { error: `Whisper model not found at ${MODEL_PATH}. Run the install script's voice step or download manually.` },
      { status: 503 }
    );
  }

  // Read the body. We accept either raw audio bytes (POST body = blob) or a
  // multipart upload with a 'file' field. Browsers using MediaRecorder +
  // fetch() with the blob as the body produce the raw-bytes form.
  let inputBuf: Buffer;
  try {
    const ab = await req.arrayBuffer();
    inputBuf = Buffer.from(ab);
  } catch (e) {
    return NextResponse.json({ error: `Could not read audio body: ${(e as Error).message}` }, { status: 400 });
  }
  if (inputBuf.byteLength === 0) {
    return NextResponse.json({ error: "Audio body is empty." }, { status: 400 });
  }
  if (inputBuf.byteLength > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: `Audio body exceeds ${MAX_BODY_BYTES / 1024 / 1024} MiB. Split into shorter recordings.` },
      { status: 413 }
    );
  }

  // Stage temp files under the OS temp dir; clean them up no matter what.
  const stamp = `lm-stt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tmpDir = path.join(os.tmpdir(), stamp);
  await fs.mkdir(tmpDir, { recursive: true });
  const inputPath = path.join(tmpDir, "input.bin");
  const wavPath = path.join(tmpDir, "input.wav");
  const txtPath = path.join(tmpDir, "input.wav.txt");
  await fs.writeFile(inputPath, inputBuf);

  const cleanup = async () => {
    try { await fs.rm(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  };

  try {
    // 1) Convert to 16kHz mono WAV via ffmpeg. -f auto-detects the input
    // container (webm/opus, mp4/aac, etc.). -ac 1 mono, -ar 16000 sample
    // rate — what whisper.cpp expects natively (no resampling tax).
    await new Promise<void>((resolve, reject) => {
      const ff = spawn(ffmpeg, [
        "-y",
        "-i", inputPath,
        "-ac", "1",
        "-ar", "16000",
        wavPath,
      ], { stdio: ["ignore", "ignore", "pipe"] });
      let err = "";
      ff.stderr.on("data", (b) => { err += b.toString("utf8"); });
      ff.on("error", reject);
      ff.on("exit", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg exit ${code}: ${err.slice(-400)}`));
      });
    });

    // 2) Run whisper-cli. -otxt writes plain text alongside the wav. The
    // base.en model returns in ~1-3 seconds for a 10-second clip on M-series.
    await new Promise<void>((resolve, reject) => {
      const wh = spawn(whisper, [
        "-m", MODEL_PATH,
        "-f", wavPath,
        "-otxt",
        "-nt",     // no timestamps in the txt output
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
        else reject(new Error(`whisper-cli exit ${code}: ${err.slice(-400)}`));
      });
    });

    // 3) Read the produced .txt.
    let text = "";
    try { text = (await fs.readFile(txtPath, "utf8")).trim(); }
    catch { text = ""; }

    return NextResponse.json({
      ok: true,
      text,
      model: path.basename(MODEL_PATH),
      bytes_in: inputBuf.byteLength,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message || "transcription failed" },
      { status: 500 }
    );
  } finally {
    cleanup();
  }
}
