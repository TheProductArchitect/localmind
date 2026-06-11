/**
 * Hugging Face Hub model downloader.
 *
 * Downloads a specific file (typically a .gguf quantization) from a public
 * HF repo straight to disk under MODELS_DIR/huggingface/<repo>/<file>.
 * Streams byte progress so the UI can render a real progress bar.
 *
 * After a successful download, we best-effort register the file with Ollama
 * via `ollama create <name> -f Modelfile`, which makes the model usable for
 * chat without the user touching the CLI. If Ollama isn't installed we
 * leave the file on disk and report that explicitly — no silent half-state.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { MODELS_DIR } from "../paths";

const HF_HOST = process.env.HF_ENDPOINT || "https://huggingface.co";

export type HfPullInput = {
  /** "owner/repo", e.g. "bartowski/Llama-3.2-3B-Instruct-GGUF" */
  repo: string;
  /** File path inside the repo, e.g. "Llama-3.2-3B-Instruct-Q4_K_M.gguf" */
  file: string;
  /** Optional Ollama model name to register after download. */
  ollamaName?: string;
  /** Optional HF token for gated/private repos. */
  token?: string;
};

export function huggingfaceFileUrl(repo: string, file: string): string {
  // The "resolve/main" path follows redirects to the CDN and serves the
  // raw file. Encode each path segment so spaces or unusual filenames work.
  const encRepo = repo.split("/").map(encodeURIComponent).join("/");
  const encFile = file.split("/").map(encodeURIComponent).join("/");
  return `${HF_HOST}/${encRepo}/resolve/main/${encFile}`;
}

export function localFilePath(repo: string, file: string): string {
  return path.join(MODELS_DIR, "huggingface", repo, file);
}

async function listLocalHfFiles(): Promise<{ name: string; path: string; size: number }[]> {
  const base = path.join(MODELS_DIR, "huggingface");
  if (!fs.existsSync(base)) return [];
  const out: { name: string; path: string; size: number }[] = [];
  // Two-level walk: <owner>/<repo>/<file>
  for (const owner of fs.readdirSync(base, { withFileTypes: true })) {
    if (!owner.isDirectory()) continue;
    const ownerPath = path.join(base, owner.name);
    for (const repo of fs.readdirSync(ownerPath, { withFileTypes: true })) {
      if (!repo.isDirectory()) continue;
      const repoPath = path.join(ownerPath, repo.name);
      for (const f of fs.readdirSync(repoPath, { withFileTypes: true })) {
        if (!f.isFile()) continue;
        const full = path.join(repoPath, f.name);
        const stat = fs.statSync(full);
        out.push({
          name: `${owner.name}/${repo.name}/${f.name}`,
          path: full,
          size: stat.size,
        });
      }
    }
  }
  return out;
}

export async function listHuggingfaceModels(): Promise<
  { name: string; family?: string; size?: number; modified?: string; path?: string }[]
> {
  const files = await listLocalHfFiles();
  return files.map((f) => ({
    name: f.name,
    family: "huggingface",
    size: f.size,
    path: f.path,
  }));
}

export async function pullHuggingfaceModel(
  input: HfPullInput,
  onProgress: (pct: number, status: string, bytes?: number, total?: number) => void,
  signal?: AbortSignal
): Promise<{ path: string; ollama?: string | null }> {
  const url = huggingfaceFileUrl(input.repo, input.file);
  const dst = localFilePath(input.repo, input.file);
  fs.mkdirSync(path.dirname(dst), { recursive: true });

  onProgress(0, `requesting ${input.repo}/${input.file}`);

  const headers: Record<string, string> = {
    // HF serves .gguf as application/octet-stream; ask explicitly so a
    // misconfigured proxy doesn't try to gzip a 5GB blob.
    accept: "application/octet-stream",
  };
  if (input.token) headers["authorization"] = `Bearer ${input.token}`;

  const r = await fetch(url, { headers, signal, redirect: "follow" });
  if (!r.ok || !r.body) {
    throw new Error(`Hugging Face request failed: HTTP ${r.status} ${r.statusText}`);
  }
  const total = Number(r.headers.get("content-length") || 0);
  const tmp = dst + ".partial";
  const ws = fs.createWriteStream(tmp);

  let received = 0;
  const reader = r.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        ws.write(value);
        received += value.byteLength;
        const pct = total > 0 ? Math.floor((received / total) * 100) : 0;
        onProgress(pct, "downloading", received, total);
      }
    }
  } catch (e) {
    ws.destroy();
    try { fs.unlinkSync(tmp); } catch {}
    throw e;
  }
  await new Promise<void>((res, rej) => ws.end((err: Error | null | undefined) => (err ? rej(err) : res())));
  fs.renameSync(tmp, dst);
  onProgress(100, "downloaded", received, total || received);

  let ollama: string | null = null;
  if (input.ollamaName) {
    try {
      ollama = await registerWithOllama(dst, input.ollamaName, onProgress);
    } catch (e: any) {
      // Surface the failure but keep the downloaded file — the user can
      // register manually if Ollama isn't installed or the modelfile shape
      // doesn't match this quant.
      onProgress(100, `downloaded; ollama register failed: ${e?.message || "unknown"}`);
    }
  }
  return { path: dst, ollama };
}

async function registerWithOllama(
  ggufPath: string,
  name: string,
  onProgress: (pct: number, status: string) => void
): Promise<string> {
  onProgress(100, "registering with ollama");
  const modelfileDir = path.dirname(ggufPath);
  const modelfilePath = path.join(modelfileDir, "Modelfile");
  fs.writeFileSync(modelfilePath, `FROM ${ggufPath}\n`);

  return new Promise<string>((resolve, reject) => {
    const child = spawn("ollama", ["create", name, "-f", modelfilePath], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let err = "";
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", (e) => {
      // ENOENT — ollama isn't installed. Make the error actionable.
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new Error("Ollama CLI not found on PATH. Install Ollama, then re-run with this same name to register."));
      } else {
        reject(e);
      }
    });
    child.on("close", (code) => {
      if (code === 0) resolve(name);
      else reject(new Error(err.trim() || `ollama create exited ${code}`));
    });
  });
}

export type HuggingfaceCuratedEntry = {
  repo: string;
  file: string;
  /** Suggested ollama tag — UI prefills this so chat works immediately. */
  ollamaName: string;
  description: string;
  ram: string;
  size: string;
};

// A small starter set of well-known open-weight GGUF builds. These are the
// quant releases the community converges on; bumping later just means
// editing this list. UI ordering matches what most users want first.
export const HUGGINGFACE_CURATED: HuggingfaceCuratedEntry[] = [
  {
    repo: "bartowski/Llama-3.2-3B-Instruct-GGUF",
    file: "Llama-3.2-3B-Instruct-Q4_K_M.gguf",
    ollamaName: "hf-llama3.2-3b-q4",
    description: "Llama 3.2 3B Instruct, Q4_K_M quant — small, fast, good for 8GB Macs",
    ram: "8GB",
    size: "2.0 GB",
  },
  {
    repo: "bartowski/Meta-Llama-3.1-8B-Instruct-GGUF",
    file: "Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf",
    ollamaName: "hf-llama3.1-8b-q4",
    description: "Llama 3.1 8B Instruct, Q4_K_M — strong general model for 16GB",
    ram: "16GB",
    size: "4.7 GB",
  },
  {
    repo: "Qwen/Qwen2.5-Coder-7B-Instruct-GGUF",
    file: "qwen2.5-coder-7b-instruct-q4_k_m.gguf",
    ollamaName: "hf-qwen2.5-coder-7b-q4",
    description: "Qwen 2.5 Coder 7B, Q4_K_M — coding-focused, runs on 16GB",
    ram: "16GB",
    size: "4.4 GB",
  },
  {
    repo: "bartowski/Phi-3.5-mini-instruct-GGUF",
    file: "Phi-3.5-mini-instruct-Q4_K_M.gguf",
    ollamaName: "hf-phi3.5-mini-q4",
    description: "Phi-3.5 mini 3.8B, Q4_K_M — compact and fast, fits 8GB",
    ram: "8GB",
    size: "2.4 GB",
  },
];
