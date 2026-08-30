/** Client cache so Mic + Conversation buttons share one STT probe. */

type VoiceReady = { ready: boolean; hint?: string };

let mem: { at: number; value: VoiceReady } | null = null;
let inflight: Promise<VoiceReady> | null = null;
const TTL_MS = 5 * 60_000;

export async function fetchVoiceReady(): Promise<VoiceReady> {
  const now = Date.now();
  if (mem && now - mem.at < TTL_MS) return mem.value;
  if (inflight) return inflight;
  inflight = fetch("/api/voice/stt")
    .then((r) => r.json())
    .then((j) => {
      const value = { ready: !!j.ready, hint: j.hint as string | undefined };
      mem = { at: Date.now(), value };
      return value;
    })
    .catch(() => {
      const value = { ready: false };
      mem = { at: Date.now(), value };
      return value;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
