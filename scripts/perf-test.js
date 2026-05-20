// Sends 10 sequential chat messages and reports first-token latency.
const BASE = process.env.LOCALMIND_URL || "http://localhost:3000";

async function firstTokenLatency(conversationId, message) {
  const start = Date.now();
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ conversationId, message }),
  });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (dec.decode(value, { stream: true }).includes("text_chunk")) {
      reader.cancel();
      return Date.now() - start;
    }
  }
  return Date.now() - start;
}

(async () => {
  const conv = await (await fetch(`${BASE}/api/conversations`, { method: "POST" })).json();
  const latencies = [];
  for (let i = 0; i < 10; i++) {
    const ms = await firstTokenLatency(conv.conversation.id, `Reply with the number ${i}.`);
    latencies.push(ms);
    console.log(`message ${i + 1}: ${ms}ms`);
    await new Promise((r) => setTimeout(r, 2000));
  }
  latencies.sort((a, b) => a - b);
  const pct = (p) => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))];
  console.log(`\nmedian: ${pct(0.5)}ms  min: ${latencies[0]}ms  max: ${latencies[latencies.length - 1]}ms  p95: ${pct(0.95)}ms`);
})();
