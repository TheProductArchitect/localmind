/**
 * POST /api/voice/stt-batch
 *
 * Heavier-but-higher-quality transcription using openai/whisper (Python).
 * Designed for meeting recordings, podcasts, long audio (multi-megabyte
 * input). Automatically uses GPU if torch+CUDA is available — that's what
 * makes Python whisper meaningfully faster than whisper.cpp for big audio.
 *
 * Diffs vs /api/voice/stt:
 *   - Accepts up to 500 MiB instead of 20 (long meetings)
 *   - Uses `whisper` CLI (openai-whisper package) instead of whisper-cli
 *   - Returns timestamps + segments alongside the plain text
 *   - 5-minute timeout (vs 60s for press-to-talk)
 *   - Defaults to `base` model; override via `?model=small|medium|large`
 *
 * If the openai/whisper Python package isn't installed, the endpoint returns
 * 503 with the pip install command. The GET handler is a capability probe
 * the UI can hit to know whether to expose batch transcription.
 */

import { NextRequest, NextResponse } from "next/server";
import { spawn, spawnSync } from "child_process";
import fs from "fs/promises";
import path from "path";
import os from "os";

export const runtime = "nodejs";
export const maxDuration = 600;

const MAX_BODY_BYTES = 500 * 1024 * 1024; // 500 MiB
const BATCH_TIMEOUT_MS = 5 * 60_000;

function which(cmd: string): string | null {
  const r = spawnSync("/usr/bin/env", ["bash", "-c", `command -v ${cmd}`], { encoding: "utf8" });
  const out = (r.stdout || "").trim();
  return out || null;
}

function detectGpu(): { available: boolean; detail: string } {
  // Quick torch.cuda probe — non-zero exit means no GPU OR torch missing,
  // both of which we want to surface as "available=false."
  const r = spawnSync(
    "python3",
    ["-c", "import torch; print('cuda' if torch.cuda.is_available() else 'cpu')"],
    { encoding: "utf8", timeout: 5000 }
  );
  if (r.status !== 0) return { available: false, detail: "torch not importable" };
  const out = (r.stdout || "").trim();
  return { available: out === "cuda", detail: out || "unknown" };
}

export async function GET() {
  const whisperBin = which("whisper");
  const ffmpeg = which("ffmpeg");
  const gpu = whisperBin ? detectGpu() : { available: false, detail: "whisper not installed" };
  const ready = !!(whisperBin && ffmpeg);
  return NextResponse.json({
    ready,
    whisper_path: whisperBin,
    ffmpeg_path: ffmpeg,
    gpu,
    hint: ready
      ? `Batch STT ready (${gpu.available ? "GPU" : "CPU"} mode).`
      : !whisperBin
        ? "Install openai/whisper: `pip3 install --user openai-whisper`. Optional GPU: install torch with CUDA support first."
        : "Install ffmpeg.",
  });
}

export async function POST(req: NextRequest) {
  const whisperBin = which("whisper");
  const ffmpeg = which("ffmpeg");
  if (!whisperBin) {
    return NextResponse.json(
      { error: "openai/whisper not on PATH. Install with `pip3 install --user openai-whisper`." },
      { status: 503 }
    );
  }
  if (!ffmpeg) {
    return NextResponse.json({ error: "ffmpeg not on PATH." }, { status: 503 });
  }

  const sp = req.nextUrl.searchParams;
  const model = (sp.get("model") || "base").toLowerCase();
  if (!["tiny", "base", "small", "medium", "large", "large-v3", "turbo"].includes(model)) {
    return NextResponse.json({ error: `Unknown model "${model}".` }, { status: 400 });
  }
  const language = sp.get("language") || "en";

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

  const stamp = `lm-stt-batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tmpDir = path.join(os.tmpdir(), stamp);
  await fs.mkdir(tmpDir, { recursive: true });
  const inputPath = path.join(tmpDir, "input.bin");
  await fs.writeFile(inputPath, inputBuf);

  const cleanup = async () => {
    try { await fs.rm(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  };

  try {
    // `whisper` (Python) handles container detection internally via ffmpeg.
    // --output_format json gets us timestamps + segments in one go.
    const t0 = Date.now();
    const { stdout, stderr, code } = await new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve) => {
      const wh = spawn(whisperBin, [
        inputPath,
        "--model", model,
        "--language", language,
        "--output_format", "json",
        "--output_dir", tmpDir,
        "--fp16", "False",   // tolerate non-CUDA boxes
      ], { stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      let err = "";
      wh.stdout.on("data", (b) => { out += b.toString("utf8"); });
      wh.stderr.on("data", (b) => { err += b.toString("utf8"); });
      const timer = setTimeout(() => {
        try { wh.kill("SIGTERM"); } catch { /* gone */ }
      }, BATCH_TIMEOUT_MS);
      timer.unref?.();
      wh.on("exit", (c) => { clearTimeout(timer); resolve({ stdout: out, stderr: err, code: c }); });
      wh.on("error", () => resolve({ stdout: out, stderr: err, code: 1 }));
    });
    const duration_ms = Date.now() - t0;

    if (code !== 0) {
      return NextResponse.json(
        { ok: false, error: stderr.slice(-1000) || `whisper exited ${code}`, duration_ms },
        { status: 500 }
      );
    }

    // Locate the produced JSON.
    let result: { text?: string; segments?: unknown[] } = {};
    try {
      const files = await fs.readdir(tmpDir);
      const jsonFile = files.find((f) => f.endsWith(".json"));
      if (jsonFile) {
        const raw = await fs.readFile(path.join(tmpDir, jsonFile), "utf8");
        result = JSON.parse(raw);
      }
    } catch (e) {
      return NextResponse.json(
        { ok: false, error: `Could not parse whisper output: ${(e as Error).message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      text: (result.text ?? "").trim(),
      segments: result.segments ?? [],
      model,
      language,
      duration_ms,
      bytes_in: inputBuf.byteLength,
      stderr_tail: stderr.slice(-500),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message || "batch transcription failed" },
      { status: 500 }
    );
  } finally {
    cleanup();
  }
}
