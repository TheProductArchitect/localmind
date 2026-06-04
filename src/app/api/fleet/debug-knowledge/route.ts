/**
 * V6.6 self-test: full knowledge-sharing protocol against ourselves.
 *
 * Asserts every privacy boundary in §9 of the V6 plan:
 *
 *   1. Pair self loopback-style + create a note with unique seeded content.
 *   2. policy=private → peer query returns nothing for that note.
 *   3. policy=fleet-queryable → peer query returns a snippet, fetch refuses.
 *   4. policy=fleet-readable → peer query returns the snippet AND fetch
 *      returns full content.
 *   5. granted_peers allow-list:
 *      a. with our id NOT in the list → peer query/fetch refuses
 *      b. with our id IN the list → peer query/fetch succeeds
 *   6. External-query audit row landed with action_type='external_query' and
 *      a cross-reference link to the requesting peer (loopback = self).
 *   7. Cleanup: delete the test note + revert share policy + unpair self.
 */

import { NextResponse } from "next/server";
import { getKnowledgeDb } from "@/lib/db";
import { nanoid } from "nanoid";
import { getNodeIdentity, exportPublicKey } from "@/lib/fleet/identity";
import { getTlsMaterial } from "@/lib/fleet/tls";
import { isRunning, activeFleetPort, startFleetServer } from "@/lib/fleet/server";
import { pairPeer, unpairPeer, recordCapabilities, setKnowledgePolicy } from "@/lib/db/fleet";
import { queryPeer, fetchFromPeer } from "@/lib/fleet/knowledge";
import { getConfigDb } from "@/lib/db";

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

  // 1. Pair self + create test note.
  unpairPeer(id.node_id);
  const tls = getTlsMaterial();
  pairPeer({
    peer_node_id: id.node_id,
    pubkey_pem: exportPublicKey(),
    label: "self (V6.6 knowledge test)",
    primary_addr: `127.0.0.1:${activeFleetPort()}`,
  });
  recordCapabilities(id.node_id, {
    tls_cert_pem: tls.cert_pem,
    tls_fingerprint_sha256: tls.fingerprint_sha256,
  });

  // Unique seeded content so any prior test runs don't collide on cache.
  const seed = `kfed-${Date.now()}-${nanoid(8)}`;
  const noteId = nanoid(12);
  getKnowledgeDb()
    .prepare(
      "INSERT INTO notes (id, title, content, created_at, updated_at, linked_note_ids, tags) VALUES (?,?,?,?,?,'[]','[]')"
    )
    .run(
      noteId,
      `V6.6 Test Note ${seed}`,
      `This is a federated-knowledge test note. The marker phrase is ${seed}. End of marker.`,
      Date.now(),
      Date.now()
    );

  // Helper: undo policy for this note at the end.
  const cleanup = () => {
    try { getConfigDb().prepare("DELETE FROM knowledge_share_policy WHERE document_id=?").run(noteId); } catch { /* ignore */ }
    try { getKnowledgeDb().prepare("DELETE FROM notes WHERE id=?").run(noteId); } catch { /* ignore */ }
    try { unpairPeer(id.node_id); } catch { /* ignore */ }
  };

  // 2. policy=private (default — no row): query should NOT return the note.
  try {
    const r = await queryPeer(id.node_id, seed);
    const matched = r.results.some((s) => s.document_id === noteId);
    results.push({
      name: "private_excludes_from_query",
      ok: r.ok && !matched,
      detail: `ok=${r.ok} matched_test_note=${matched} total_results=${r.results.length}`,
    });
  } catch (e) {
    results.push({ name: "private_excludes_from_query", ok: false, detail: (e as Error).message });
  }

  // 3. policy=fleet-queryable: query returns snippet; fetch refuses.
  try {
    setKnowledgePolicy({ document_id: noteId, policy: "fleet-queryable" });
    const q = await queryPeer(id.node_id, seed);
    const matched = q.results.find((s) => s.document_id === noteId);
    const snippetHasMarker = !!matched?.snippet?.includes(seed);
    const f = await fetchFromPeer(id.node_id, noteId);
    results.push({
      name: "queryable_returns_snippet_only",
      ok: q.ok && !!matched && snippetHasMarker && !f.ok,
      detail: `query_matched=${!!matched} snippet_has_marker=${snippetHasMarker} fetch_ok=${f.ok} fetch_reason="${f.reason ?? ""}"`,
    });
  } catch (e) {
    results.push({ name: "queryable_returns_snippet_only", ok: false, detail: (e as Error).message });
  }

  // 4. policy=fleet-readable: query + fetch both work.
  try {
    setKnowledgePolicy({ document_id: noteId, policy: "fleet-readable" });
    const q = await queryPeer(id.node_id, seed);
    const matched = !!q.results.find((s) => s.document_id === noteId);
    const f = await fetchFromPeer(id.node_id, noteId);
    const fullHasMarker = !!f.content?.content?.includes(seed);
    results.push({
      name: "readable_allows_full_fetch",
      ok: q.ok && matched && f.ok && fullHasMarker,
      detail: `query_matched=${matched} fetch_ok=${f.ok} content_chars=${f.content?.content.length ?? 0} has_marker=${fullHasMarker}`,
    });
  } catch (e) {
    results.push({ name: "readable_allows_full_fetch", ok: false, detail: (e as Error).message });
  }

  // 5a. granted_peers with our id NOT in the list → refuses.
  try {
    setKnowledgePolicy({
      document_id: noteId,
      policy: "fleet-readable",
      granted_peers: ["OTHER-PEER-NEVER-PAIRED"],
    });
    const q = await queryPeer(id.node_id, seed);
    const matched = q.results.some((s) => s.document_id === noteId);
    const f = await fetchFromPeer(id.node_id, noteId);
    results.push({
      name: "granted_peers_excludes_others",
      ok: !matched && !f.ok,
      detail: `matched=${matched} fetch_ok=${f.ok} fetch_reason="${f.reason ?? ""}"`,
    });
  } catch (e) {
    results.push({ name: "granted_peers_excludes_others", ok: false, detail: (e as Error).message });
  }

  // 5b. granted_peers WITH our id → allows.
  try {
    setKnowledgePolicy({
      document_id: noteId,
      policy: "fleet-readable",
      granted_peers: [id.node_id, "OTHER-PEER-NEVER-PAIRED"],
    });
    const q = await queryPeer(id.node_id, seed);
    const matched = !!q.results.find((s) => s.document_id === noteId);
    const f = await fetchFromPeer(id.node_id, noteId);
    results.push({
      name: "granted_peers_allow_list_includes_us",
      ok: matched && f.ok,
      detail: `matched=${matched} fetch_ok=${f.ok}`,
    });
  } catch (e) {
    results.push({ name: "granted_peers_allow_list_includes_us", ok: false, detail: (e as Error).message });
  }

  // 6. Audit log: at least one external_query row should exist with a
  //    cross-reference to ourselves (loopback peer).
  try {
    const externalQueries = getConfigDb()
      .prepare(
        "SELECT id, action_type FROM audit_log WHERE action_type IN ('external_query','external_fetch') ORDER BY id DESC LIMIT 8"
      )
      .all() as Array<{ id: number; action_type: string }>;
    const linkedIds = externalQueries.map((r) => {
      const link = getConfigDb()
        .prepare("SELECT direction, peer_node_id FROM fleet_audit_links WHERE local_audit_id=? LIMIT 1")
        .get(r.id) as { direction: string; peer_node_id: string } | undefined;
      return { ...r, link };
    });
    const allLinked = linkedIds.every((r) => r.link?.peer_node_id === id.node_id);
    results.push({
      name: "external_queries_audited",
      ok: externalQueries.length > 0 && allLinked,
      detail: `external_rows=${externalQueries.length} all_linked_to_self=${allLinked}`,
    });
  } catch (e) {
    results.push({ name: "external_queries_audited", ok: false, detail: (e as Error).message });
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
