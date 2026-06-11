import { describe, it, expect } from "vitest";
import { huggingfaceFileUrl, localFilePath } from "../src/lib/providers/huggingface";

/**
 * HF URL + local-path contract.
 *
 * The download path is the security/correctness surface for the HF provider:
 *  - URL must encode each path segment so an unusual filename doesn't break the request.
 *  - Local path must stay inside MODELS_DIR/huggingface/<repo>/<file>; any
 *    accidental traversal would scatter downloaded blobs across the FS.
 */

describe("huggingfaceFileUrl", () => {
  it("constructs a canonical resolve/main URL", () => {
    const url = huggingfaceFileUrl("bartowski/Llama-3.2-3B-Instruct-GGUF", "Llama-3.2-3B-Instruct-Q4_K_M.gguf");
    expect(url).toBe(
      "https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf"
    );
  });

  it("encodes unusual characters in segments", () => {
    const url = huggingfaceFileUrl("owner/repo with space", "weird file (q4).gguf");
    expect(url).toContain("/owner/repo%20with%20space/");
    expect(url).toContain("/resolve/main/weird%20file%20(q4).gguf");
  });
});

describe("localFilePath", () => {
  it("places the file under MODELS_DIR/huggingface/<owner>/<repo>/<file>", () => {
    const p = localFilePath("bartowski/Phi-3.5-mini-instruct-GGUF", "Phi-3.5-mini-instruct-Q4_K_M.gguf");
    expect(p).toMatch(/\/models\/huggingface\/bartowski\/Phi-3\.5-mini-instruct-GGUF\/Phi-3\.5-mini-instruct-Q4_K_M\.gguf$/);
  });
});
