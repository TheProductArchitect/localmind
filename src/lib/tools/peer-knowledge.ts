/**
 * peer_knowledge — agent-facing tool that surfaces V6.6 federated knowledge.
 *
 * Operations:
 *   - search:   fanout across all paired peers, return snippets sorted by score
 *   - search_one: query one specific peer (when the agent knows which peer to ask)
 *   - fetch:    pull full content of one document from a specific peer (the peer
 *               must have set policy to `fleet-readable` for us)
 *
 * Every call is audited on BOTH sides (V6.4 cross-references; V6.6 inbound
 * audit on the responder). The agent doesn't need to know about audit — it
 * just sees a tool result.
 *
 * The peer-knowledge tool is intentionally separate from the local `knowledge`
 * tool. The agent can choose between local-only or federated based on context:
 * a user asking "what's in my notes" vs "what does the homelab have on this
 * topic". Splitting also keeps the local audit clean — federated calls show
 * up as a distinct external_query/external_fetch trail.
 */

import type { Tool } from "./types";
import { fanoutQuery, queryPeer, fetchFromPeer } from "../fleet/knowledge";

export const peerKnowledgeTool: Tool = {
  actionType: "memory_read",
  classify: (i) => (i.operation === "fetch" ? "memory_read" : "memory_read"),
  preview: (i) => {
    if (i.operation === "fetch") return `Fetch full document ${i.document_id} from peer ${i.peer_node_id}`;
    if (i.operation === "search_one") return `Search peer ${i.peer_node_id} for: ${i.query}`;
    return `Search all paired peers for: ${i.query}`;
  },
  version: "1",
  // Searches are cacheable; fetches return full content and are too large
  // (64KiB cap in the cache wrapper would skip most of them anyway).
  cacheable: (i) => i.operation === "search" || i.operation === "search_one",
  definition: {
    name: "peer_knowledge",
    description:
      "Search or fetch knowledge across paired peer machines on the fleet. Use this when local knowledge is insufficient AND the user has paired one or more other LocalMind machines. Operations: search (fanout all paired peers), search_one (one specific peer), fetch (pull full content by document_id from one peer).",
    parameters: {
      type: "object",
      properties: {
        operation: { type: "string", enum: ["search", "search_one", "fetch"] },
        query: { type: "string", description: "Search query — required for search / search_one." },
        peer_node_id: { type: "string", description: "Peer node id — required for search_one + fetch." },
        document_id: { type: "string", description: "Document or note id on the peer — required for fetch." },
        limit_per_peer: { type: "number", description: "Max results per peer for search (default 10, max 25)." },
      },
      required: ["operation"],
    },
  },
  async execute(input) {
    const op = String(input.operation || "");

    if (op === "search") {
      const q = String(input.query || "").trim();
      if (!q) return { ok: false, output: "query is required for search" };
      const limit = typeof input.limit_per_peer === "number" ? input.limit_per_peer : 10;
      const result = await fanoutQuery({ query: q, limit_per_peer: limit });
      if (result.per_peer.length === 0) {
        return {
          ok: true,
          output: "(no paired peers — use the 'knowledge_base' tool for local knowledge instead)",
          summary: "peer_knowledge: no peers paired",
        };
      }
      const lines: string[] = [];
      for (const s of result.merged.slice(0, limit * 2)) {
        const peerLabel = s.peer_label || s.peer_node_id.slice(0, 12);
        lines.push(`[${peerLabel}] ${s.kind} "${s.title}" (score=${s.score})\n  ${s.snippet}`);
      }
      const totalAcrossPeers = result.per_peer.reduce((sum, p) => sum + (p.ok ? p.results.length : 0), 0);
      const failedPeers = result.per_peer.filter((p) => !p.ok).map((p) => p.peer_label || p.peer_node_id);
      const summary =
        `Found ${totalAcrossPeers} snippet(s) across ${result.per_peer.filter((p) => p.ok).length} peer(s)` +
        (failedPeers.length ? `; ${failedPeers.length} peer(s) failed: ${failedPeers.join(", ")}` : "");
      return {
        ok: true,
        output: lines.length ? lines.join("\n\n") : "(no matching snippets on any paired peer)",
        summary,
      };
    }

    if (op === "search_one") {
      const q = String(input.query || "").trim();
      const peer = String(input.peer_node_id || "").trim();
      if (!q || !peer) return { ok: false, output: "query and peer_node_id are required for search_one" };
      const r = await queryPeer(peer, q, { limit: typeof input.limit_per_peer === "number" ? input.limit_per_peer : 10 });
      if (!r.ok) return { ok: false, output: `peer ${peer.slice(0, 16)}: ${r.reason ?? "search failed"}` };
      const lines = r.results.map(
        (s) => `${s.kind} "${s.title}" (score=${s.score})\n  ${s.snippet}`
      );
      return {
        ok: true,
        output: lines.length ? lines.join("\n\n") : "(no matching snippets on that peer)",
        summary: `Found ${r.results.length} snippet(s) on ${r.peer_label || peer.slice(0, 12)}`,
      };
    }

    if (op === "fetch") {
      const peer = String(input.peer_node_id || "").trim();
      const docId = String(input.document_id || "").trim();
      if (!peer || !docId) return { ok: false, output: "peer_node_id and document_id are required for fetch" };
      const r = await fetchFromPeer(peer, docId);
      if (!r.ok || !r.content) return { ok: false, output: `peer refused fetch: ${r.reason ?? "denied"}` };
      return {
        ok: true,
        output: `[${r.content.kind} "${r.content.title}"]\n\n${r.content.content}`,
        summary: `Fetched ${r.content.kind} "${r.content.title}" (${r.content.content.length} chars)`,
      };
    }

    return { ok: false, output: `Unknown operation: ${op}` };
  },
};
