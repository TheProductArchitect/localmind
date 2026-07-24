import { getSettings } from "../db/queries";
import { ollamaProvider } from "./ollama";
import { anthropicProvider } from "./anthropic";
import { geminiProvider } from "./gemini";
import { mindstudioProvider } from "./mindstudio";
import { makeOpenAICompatibleProvider } from "./openai-compatible";
import type { Provider } from "./types";

const cache: Record<string, Provider> = {};

export const CHAT_PROVIDERS = [
  "ollama",
  "openai",
  "anthropic",
  "groq",
  "openrouter",
  "lmstudio",
  "gemini",
  "mindstudio",
] as const;

export type ChatProviderName = (typeof CHAT_PROVIDERS)[number];

export function getProviderByName(name: string): Provider {
  if (cache[name]) return cache[name];
  let p: Provider;
  switch (name) {
    case "anthropic":
      p = anthropicProvider;
      break;
    case "gemini":
      p = geminiProvider;
      break;
    case "mindstudio":
      p = mindstudioProvider;
      break;
    case "openai":
      p = makeOpenAICompatibleProvider("openai");
      break;
    case "groq":
      p = makeOpenAICompatibleProvider("groq");
      break;
    case "openrouter":
      p = makeOpenAICompatibleProvider("openrouter");
      break;
    case "lmstudio":
      p = makeOpenAICompatibleProvider("lmstudio");
      break;
    case "ollama":
    default:
      p = ollamaProvider;
  }
  cache[name] = p;
  return p;
}

export function getProvider(): Provider {
  return getProviderByName(getSettings().provider);
}

export { ollamaProvider, anthropicProvider, geminiProvider, mindstudioProvider };
