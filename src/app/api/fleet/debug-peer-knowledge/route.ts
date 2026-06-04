/**
 * V6.7 self-test: peer_knowledge tool end-to-end.
 *
 * Strategy:
 *   1. Pair self loopback-style + create a note with unique seeded content.
 *   2. Set policy=fleet-readable for the note (so both search + fetch
 *      should succeed against the loopback peer).
 *   3. Invoke peer_knowledge with operation=search — expect the seeded
 *      content's snippet to appear in the result.
 *   4. Invoke peer_knowledge with operation=fetch — expect full content.
 *   5. Invoke peer_knowledge with operation=search when no peers are paired
 *      — expect the "no paired peers" fast-path message.
 */

import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { getKnowledgeDb, getConfigDb } from "@/lib/db";
import { getNodeIdentity, exportPublicKey } from "@/lib/fleet/identity";
import { getTlsMaterial } from "@/lib/fleet/tls";
import { isRunning, activeFleetPort, startFleetServer } from "@/lib/fleet/server";
import { pairPeer, unpairPeer, recordCapabilities, setKnowledgePolicy } from "@/lib/db/fleet";
import { peerKnowledgeTool } from "@/lib/tools/peer-knowledge";

export const runtime = "nodejs";

export async function GET() {
  const results: Array<{ name: string; ok: boolean; detail: string }> = [];
  const id = getNodeIdentity();

  if (!isRunning()) {
    try { await startFleetServer(); } catch (e) {
      return NextResponse.json({ ok: false, reason: `fleet listener failed: ${(e as Error).message}` });
    }
  }
  if (!activeFleetPort()) {
    return NextResponse.json({ ok: false, reason: "fleet listener not bound" });
  }

  // Setup: pair self, create a unique seeded note, mark fleet-readable.
  unpairPeer(id.node_id);
  const tls = getTlsMaterial();
  pairPeer({
    peer_node_id: id.node_id,
    pubkey_pem: exportPublicKey(),
    label: "self (V6.7 peer-knowledge test)",
    primary_addr: `127.0.0.1:${activeFleetPort()}`,
  });
  recordCapabilities(id.node_id, { tls_cert_pem: tls.cert_pem, tls_fingerprint_sha256: tls.fingerprint_sha256 });

  const seed = `peer-kn-${Date.now()}-${nanoid(8)}`;
  const noteId = nanoid(12);
  getKnowledgeDb()
    .prepare(
      "INSERT INTO notes (id, title, content, created_at, updated_at, linked_note_ids, tags) VALUES (?,?,?,?,?,'[]','[]')"
    )
    .run(
      noteId,
      `V6.7 peer test ${seed}`,
      `Federated knowledge integration test. The marker is ${seed}. End.`,
      Date.now(),
      Date.now()
    );
  setKnowledgePolicy({ document_id: noteId, policy: "fleet-readable" });

  const cleanup = () => {
    try { getConfigDb().prepare("DELETE FROM knowledge_share_policy WHERE document_id=?").run(noteId); } catch { /* ignore */ }
    try { getKnowledgeDb().prepare("DELETE FROM notes WHERE id=?").run(noteId); } catch { /* ignore */ }
    try { unpairPeer(id.node_id); } catch { /* ignore */ }
  };

  const ctx = { conversationId: "peer-knowledge-test", approvedDirs: [] as string[] };

  // 1. search — should find the seeded snippet.
  try {
    const r = await peerKnowledgeTool.execute({ operation: "search", query: seed, limit_per_peer: 5 }, ctx);
    const hasSeed = r.output.includes(seed);
    const hasPeerLabel = r.output.includes("self");
    results.push({
      name: "search_finds_seeded_snippet",
      ok: r.ok && hasSeed && hasPeerLabel,
      detail: `ok=${r.ok} has_seed=${hasSeed} has_peer_label=${hasPeerLabel} summary="${r.summary ?? ""}"`,
    });
  } catch (e) {
    results.push({ name: "search_finds_seeded_snippet", ok: false, detail: (e as Error).message });
  }

  // 2. search_one — peer-specific.
  try {
    const r = await peerKnowledgeTool.execute(
      { operation: "search_one", peer_node_id: id.node_id, query: seed },
      ctx
    );
    results.push({
      name: "search_one_finds_seeded_snippet",
      ok: r.ok && r.output.includes(seed),
      detail: `ok=${r.ok} summary="${r.summary ?? ""}"`,
    });
  } catch (e) {
    results.push({ name: "search_one_finds_seeded_snippet", ok: false, detail: (e as Error).message });
  }

  // 3. fetch — full content.
  try {
    const r = await peerKnowledgeTool.execute(
      { operation: "fetch", peer_node_id: id.node_id, document_id: noteId },
      ctx
    );
    const hasMarker = r.output.includes(seed);
    const summarySaysFetched = (r.summary ?? "").startsWith("Fetched");
    results.push({
      name: "fetch_returns_full_content",
      ok: r.ok && hasMarker && summarySaysFetched,
      detail: `ok=${r.ok} marker_present=${hasMarker} summary="${r.summary ?? ""}"`,
    });
  } catch (e) {
    results.push({ name: "fetch_returns_full_content", ok: false, detail: (e as Error).message });
  }

  // 4. search with no peers — clear peer first, run, then re-pair for cleanup.
  try {
    unpairPeer(id.node_id);
    const r = await peerKnowledgeTool.execute({ operation: "search", query: "anything" }, ctx);
    const noPeerMessage = r.output.includes("no paired peers") || r.output.includes("no paired peer");
    results.push({
      name: "search_no_peers_fast_path",
      ok: r.ok && noPeerMessage,
      detail: `ok=${r.ok} no_peer_msg=${noPeerMessage} output="${r.output.slice(0, 80)}"`,
    });
  } catch (e) {
    results.push({ name: "search_no_peers_fast_path", ok: false, detail: (e as Error).message });
  }

  cleanup();

  return NextResponse.json({
    node_id: id.node_id,
    seed,
    note_id: noteId,
    all_ok: results.every((r) => r.ok),
    results,
  });
}
