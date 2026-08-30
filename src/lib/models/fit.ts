/**
 * Local-model memory fit.
 *
 * A local runtime asked to load a model larger than available memory does not
 * fail — it thrashes. On unified-memory machines (DGX Spark / Apple Silicon)
 * that starves the whole box, so the chat request hangs with no error and the
 * UI sits on "Preparing…" forever.
 *
 * These helpers turn "will this model actually run right now?" into a cheap,
 * testable decision so callers can refuse with a useful message instead.
 */

const GB = 1024 ** 3;

/** Weights are not the whole story: KV cache, context and runtime overhead. */
const RUNTIME_OVERHEAD = 1.15;

/** Leave room for the OS and for LocalMind itself. */
const OS_HEADROOM_BYTES = 2 * GB;

/** Below this fraction of free memory we still run, but warn. */
const TIGHT_FRACTION = 0.85;

export type FitVerdict = "fits" | "tight" | "too_large" | "impossible";

export type ModelFit = {
  verdict: FitVerdict;
  /** Estimated memory needed to serve the model, in GB. */
  required_gb: number;
  /** Memory currently available, in GB. */
  available_gb: number;
  /** Total machine memory, in GB. */
  total_gb: number;
  /** Human-readable explanation, safe to show in the UI or return as an error. */
  message: string;
};

const gb = (bytes: number) => Math.round((bytes / GB) * 10) / 10;

/**
 * @param sizeBytes On-disk size of the model (Ollama/LM Studio report this).
 *   Pass 0/undefined when unknown — the verdict is then "fits" because we
 *   must not block on a guess.
 */
export function assessModelFit(args: {
  sizeBytes?: number | null;
  availableBytes: number;
  totalBytes: number;
  modelName?: string;
}): ModelFit {
  const { sizeBytes, availableBytes, totalBytes, modelName } = args;
  const label = modelName ? `"${modelName}"` : "This model";

  if (!sizeBytes || sizeBytes <= 0) {
    return {
      verdict: "fits",
      required_gb: 0,
      available_gb: gb(availableBytes),
      total_gb: gb(totalBytes),
      message: "Model size is unknown, so no memory check was applied.",
    };
  }

  const required = sizeBytes * RUNTIME_OVERHEAD;
  const usable = Math.max(0, availableBytes - OS_HEADROOM_BYTES);
  const base = {
    required_gb: gb(required),
    available_gb: gb(availableBytes),
    total_gb: gb(totalBytes),
  };

  // Bigger than the machine: no amount of freeing up will help.
  if (required > totalBytes - OS_HEADROOM_BYTES) {
    return {
      ...base,
      verdict: "impossible",
      message:
        `${label} needs about ${base.required_gb} GB but this machine has only ` +
        `${base.total_gb} GB of memory in total. Choose a smaller model.`,
    };
  }

  if (required > usable) {
    return {
      ...base,
      verdict: "too_large",
      message:
        `${label} needs about ${base.required_gb} GB but only ${base.available_gb} GB ` +
        `is free right now. Free up memory (stop other model servers) or pick a smaller model.`,
    };
  }

  if (required > usable * TIGHT_FRACTION) {
    return {
      ...base,
      verdict: "tight",
      message:
        `${label} needs about ${base.required_gb} GB of the ${base.available_gb} GB free. ` +
        `It should run, but expect slow responses and little headroom.`,
    };
  }

  return {
    ...base,
    verdict: "fits",
    message: `${label} needs about ${base.required_gb} GB of ${base.available_gb} GB free.`,
  };
}

/** True when the model should not be started at all. */
export function isBlockingVerdict(v: FitVerdict): boolean {
  return v === "too_large" || v === "impossible";
}
