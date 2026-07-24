/**
 * Fleet HTTPS sidecar.
 *
 * Bound to a dedicated port (default 9443, override via `LOCALMIND_FLEET_PORT`).
 * Lives in the same process as Next so it shares the SQLite handles, agent
 * engine, audit log, etc. Doesn't entangle with Next's HTTP server — peer
 * traffic and browser traffic are physically separated.
 *
 * Auth model:
 *   - TLS server cert pins peer trust on the *outbound* side
 *   - Inbound requests are authed by SignedEnvelope verification — the sender
 *     id in the envelope must match a paired peer's public key
 *   - The peer's `trusted` flag must be 1; we never accept envelopes from
 *     untrusted-but-recorded peers (a future feature, hold pattern below)
 *   - The exception is the `pair-request` kind which V6.2 handles without a
 *     pre-existing peer record — gated by an in-process pairing window
 *
 * Dispatcher:
 *   POST /fleet/<kind>  → routed to a handler by kind. Body is the SignedEnvelope.
 *   GET  /fleet/health  → tiny liveness ping (no auth, no cert pinning needed
 *                        because it returns nothing actionable)
 *
 * All handlers return a SignedEnvelope themselves, signed by THIS node and
 * addressed to the inbound sender's node_id. This keeps the wire protocol
 * symmetric — both sides verify.
 */

import https from "https";
import http from "http";
import { setTimeout as delay } from "timers/promises";
import { getTlsMaterial, opensslAvailable } from "./tls";
import { getNodeIdentity } from "./identity";
import { verify, sign, type SignedEnvelope, type EnvelopeKind } from "./envelope";
import { getPeer, pairPeer, recordCapabilities, markPeerSeen, parsePeerPolicy } from "../db/fleet";
import { snapshotCapability } from "./capabilities";
import { consumeToken } from "./pairing";
import { parsePeerPublicKey, fingerprintOfPubkey } from "./identity";

const DEFAULT_FLEET_PORT = Number(process.env.LOCALMIND_FLEET_PORT || 9443);
const FLEET_BIND_HOST = process.env.LOCALMIND_FLEET_BIND || "0.0.0.0";
const MAX_BODY_BYTES = 1 * 1024 * 1024; // 1 MiB — capability/heartbeat envelopes are <2KiB; tasks larger but never near 1 MiB

// Next dev compiles routes in separate module contexts from the instrumentation
// hook, so a plain module-scoped `let` doesn't survive across the boundary.
// Pinning the singleton on globalThis is the standard escape hatch.
type GlobalFleet = {
  server: https.Server | null;
  port: number | null;
  handlersRegistered: boolean;
};
const GLOBAL_KEY = Symbol.for("localmind.fleet.server");
const globalSlot = globalThis as unknown as Record<symbol, GlobalFleet>;
if (!globalSlot[GLOBAL_KEY]) {
  globalSlot[GLOBAL_KEY] = { server: null, port: null, handlersRegistered: false };
}
const fleetState: GlobalFleet = globalSlot[GLOBAL_KEY];

export type HandlerCtx<P> = {
  envelope: SignedEnvelope<P>;
  senderNodeId: string;
};

export type Handler<Req, Res> = (ctx: HandlerCtx<Req>) => Promise<Res>;

const HANDLERS = new Map<EnvelopeKind, Handler<unknown, unknown>>();

/** Register a handler for a given envelope kind. Idempotent — last write wins. */
export function registerHandler<Req, Res>(kind: EnvelopeKind, handler: Handler<Req, Res>): void {
  HANDLERS.set(kind, handler as Handler<unknown, unknown>);
}

/** Read the request body up to MAX_BODY_BYTES, rejecting anything larger. */
function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (c: Buffer) => {
      total += c.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error(`Body exceeds ${MAX_BODY_BYTES} bytes`));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function writeJson(res: http.ServerResponse, status: number, body: unknown): void {
  const buf = Buffer.from(JSON.stringify(body), "utf8");
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": String(buf.length),
  });
  res.end(buf);
}

/** Replies with a signed envelope from THIS node to the original sender. */
function writeEnvelopeResponse(
  res: http.ServerResponse,
  senderNodeId: string,
  kind: EnvelopeKind,
  payload: unknown,
  status = 200
): void {
  const envelope = sign(kind, senderNodeId, payload);
  writeJson(res, status, envelope);
}

async function dispatch(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url || "/", `https://localhost`);

  // Liveness — no auth, no body. Useful for "is this node reachable" without
  // burning a signed envelope round-trip.
  if (req.method === "GET" && url.pathname === "/fleet/health") {
    writeJson(res, 200, { ok: true, node_id: getNodeIdentity().node_id });
    return;
  }

  if (req.method !== "POST" || !url.pathname.startsWith("/fleet/")) {
    writeJson(res, 404, { error: "Unknown fleet endpoint." });
    return;
  }

  const kind = url.pathname.slice("/fleet/".length) as EnvelopeKind;
  const handler = HANDLERS.get(kind);
  if (!handler) {
    writeJson(res, 404, { error: `No handler for kind '${kind}'` });
    return;
  }

  let envelope: SignedEnvelope<unknown>;
  try {
    const body = await readBody(req);
    envelope = JSON.parse(body.toString("utf8")) as SignedEnvelope<unknown>;
  } catch (e) {
    writeJson(res, 400, { error: `Could not parse envelope: ${(e as Error).message}` });
    return;
  }

  // The `pair-request` and `pair-confirm` kinds are special — they arrive
  // before the peer is in our fleet_peers table. Dispatch them with a
  // sentinel sender pubkey supplied by the handler's own bootstrap state.
  const isPairing = kind === "pair-request" || kind === "pair-confirm";

  if (!isPairing) {
    const peer = getPeer(envelope.sender);
    if (!peer) {
      writeJson(res, 401, { error: "Unknown sender — not a paired peer." });
      return;
    }
    if (peer.trusted !== 1) {
      writeJson(res, 403, { error: "Peer is recorded but not trusted." });
      return;
    }
    const verifyResult = verify(envelope, {
      senderPubkeyPem: peer.pubkey_pem,
      expectedRecipient: getNodeIdentity().node_id,
    });
    if (!verifyResult.ok) {
      writeJson(res, 401, { error: `Envelope verify failed: ${verifyResult.reason}` });
      return;
    }
    markPeerSeen(envelope.sender);
  }

  // Pairing handlers manage their own verification (they have the peer pubkey
  // from the QR payload). They still get a parsed envelope.
  try {
    // Streaming chat-relay: NDJSON token lines then a final signed result envelope.
    const wantsStream =
      kind === "chat-relay" &&
      envelope.payload &&
      typeof envelope.payload === "object" &&
      (envelope.payload as { stream_tokens?: boolean }).stream_tokens === true;

    if (wantsStream) {
      res.writeHead(200, {
        "content-type": "application/x-ndjson; charset=utf-8",
        "transfer-encoding": "chunked",
        "cache-control": "no-cache",
      });
      const writeLine = (obj: unknown) => {
        res.write(Buffer.from(JSON.stringify(obj) + "\n", "utf8"));
      };
      const { handleChatRelay } = await import("./handlers/chat-relay");
      const payload = await handleChatRelay({
        envelope: envelope as SignedEnvelope<import("./handlers/chat-relay").ChatRelayRequest>,
        senderNodeId: envelope.sender,
        onToken: (text) => {
          writeLine({ type: "token", text });
        },
      });
      const resultEnv = sign(`${kind}-result` as EnvelopeKind, envelope.sender, payload);
      writeLine({ type: "result", envelope: resultEnv });
      res.end();
      return;
    }

    const payload = await handler({ envelope, senderNodeId: envelope.sender });
    writeEnvelopeResponse(res, envelope.sender, `${kind}-result` as EnvelopeKind, payload);
  } catch (e) {
    writeJson(res, 500, { error: (e as Error).message || "Handler threw." });
  }
}

/**
 * Start the fleet HTTPS listener. Idempotent — second call is a no-op when
 * the server is already running (which happens under Next dev's instrumen-
 * tation re-fire).
 */
export async function startFleetServer(opts: { port?: number; host?: string } = {}): Promise<{ port: number; cert_fingerprint: string }> {
  if (fleetState.server && fleetState.port) {
    return { port: fleetState.port, cert_fingerprint: getTlsMaterial().fingerprint_sha256 };
  }
  if (!opensslAvailable()) {
    throw new Error("openssl not available — fleet server cannot start. Install openssl and restart.");
  }

  const tls = getTlsMaterial();
  const port = opts.port ?? DEFAULT_FLEET_PORT;
  const host = opts.host ?? FLEET_BIND_HOST;

  registerBuiltinHandlers();

  fleetState.server = https.createServer(
    {
      cert: tls.cert_pem,
      key: tls.key_pem,
      requestCert: false,            // app-layer auth via envelopes
      rejectUnauthorized: false,
      // Pinning is symmetric: our cert never rotates without the user's
      // explicit reset, so SNI/ALPN can stay defaults.
    },
    (req, res) => {
      dispatch(req, res).catch((e) => {
        try { writeJson(res, 500, { error: (e as Error).message }); } catch { /* socket already closed */ }
      });
    }
  );

  await new Promise<void>((resolve, reject) => {
    fleetState.server!.once("error", reject);
    fleetState.server!.listen(port, host, () => {
      fleetState.server!.off("error", reject);
      resolve();
    });
  });
  fleetState.port = port;
  return { port, cert_fingerprint: tls.fingerprint_sha256 };
}

/** Stop the listener (graceful, waits up to 2s for in-flight). */
export async function stopFleetServer(): Promise<void> {
  if (!fleetState.server) return;
  const srv = fleetState.server;
  fleetState.server = null;
  fleetState.port = null;
  await new Promise<void>((resolve) => {
    let done = false;
    srv.close(() => { if (!done) { done = true; resolve(); } });
    delay(2000).then(() => { if (!done) { done = true; resolve(); } });
  });
}

export function isRunning(): boolean {
  return fleetState.server !== null;
}

export function activeFleetPort(): number | null {
  return fleetState.port;
}

// -------------------------------------------------------------------------
// Built-in handlers
// -------------------------------------------------------------------------

function registerBuiltinHandlers(): void {
  if (fleetState.handlersRegistered) return;
  fleetState.handlersRegistered = true;

  // capabilities — peer pushes us their snapshot; we record it.
  registerHandler<Record<string, unknown>, { ack: boolean; node_id: string }>(
    "capabilities",
    async ({ envelope, senderNodeId }) => {
      const peer = getPeer(senderNodeId);
      if (peer) {
        const policy = parsePeerPolicy(peer);
        if (policy.advertise_capabilities === false) {
          // Receive but don't store — the peer opted out of cap exchange.
        } else {
          recordCapabilities(senderNodeId, envelope.payload);
        }
      }
      return { ack: true, node_id: getNodeIdentity().node_id };
    }
  );

  // capabilities-pull — peer asks for our current capabilities snapshot.
  registerHandler<Record<string, never>, Awaited<ReturnType<typeof snapshotCapability>>>(
    "capabilities-pull",
    async () => snapshotCapability()
  );

  // pair-confirm — responder (B) calls us (A, the initiator) carrying the
  // pairing token from A's QR. The dispatcher skipped envelope verification
  // for pairing kinds; we do it here using the pubkey that came in the
  // payload, then validate the token before writing the peer row.
  type PairConfirmPayload = {
    pairing_token: string;
    node_id: string;
    pubkey_pem: string;
    cert_fingerprint_sha256: string;
    cert_pem: string;
    primary_addr: string;
    label_for_initiator?: string;
  };
  type PairConfirmResult = {
    ack: true;
    initiator_label?: string;
  };
  registerHandler<PairConfirmPayload, PairConfirmResult>("pair-confirm", async ({ envelope }) => {
    const p = envelope.payload;
    if (!p || typeof p !== "object") throw new Error("Pairing payload missing.");
    for (const k of ["pairing_token", "node_id", "pubkey_pem", "cert_fingerprint_sha256", "cert_pem", "primary_addr"]) {
      if (typeof (p as Record<string, unknown>)[k] !== "string") throw new Error(`Pairing payload field missing: ${k}`);
    }

    // The envelope arrived without prior peer-row verification. Run the same
    // checks here using the pubkey the responder declared inside the payload.
    let pubKey;
    try { pubKey = parsePeerPublicKey(p.pubkey_pem); } catch { throw new Error("Responder pubkey is malformed."); }
    void pubKey;
    const declaredFp = fingerprintOfPubkey(p.pubkey_pem);
    if (declaredFp !== p.node_id) {
      throw new Error(`Pairing payload node_id ${p.node_id} does not match its pubkey fingerprint ${declaredFp}.`);
    }
    if (envelope.sender !== p.node_id) {
      throw new Error(`Envelope sender ${envelope.sender} does not match payload node_id ${p.node_id}.`);
    }
    // Verify the envelope signature with the pubkey that came in the payload.
    const { verify: verifyEnv } = await import("./envelope");
    const v = verifyEnv(envelope, {
      senderPubkeyPem: p.pubkey_pem,
      expectedRecipient: getNodeIdentity().node_id,
      allowClockSkew: true,
    });
    if (!v.ok) throw new Error(`Pair-confirm envelope verify failed: ${v.reason}`);

    // Token check — single-use, time-bounded. If this fails, the responder
    // didn't have the QR or the QR is too old.
    const window = consumeToken(p.pairing_token, p.node_id);
    if (!window) throw new Error("Pairing token is unknown, expired, or already used.");

    // Write the peer row. capabilities_json carries the responder's cert so
    // future sendToPeer() calls can pin it.
    pairPeer({
      peer_node_id: p.node_id,
      pubkey_pem: p.pubkey_pem,
      label: window.label_hint ?? null,
      primary_addr: p.primary_addr,
    });
    recordCapabilities(p.node_id, {
      tls_cert_pem: p.cert_pem,
      tls_fingerprint_sha256: p.cert_fingerprint_sha256,
    });

    return {
      ack: true,
      initiator_label: window.label_hint,
    };
  });

  // delegate — peer asks us to execute a single task node on their behalf.
  // Handler details in src/lib/fleet/handlers/delegate.ts. Audit-write
  // happens BEFORE execution, then we run, then we update the audit row
  // with the outcome and return our local_audit_id so the initiator can
  // cross-reference it.
  registerHandler<import("./handlers/delegate").DelegateRequest, import("./handlers/delegate").DelegateResponse>(
    "delegate",
    async ({ envelope, senderNodeId }) => {
      const { handleDelegate } = await import("./handlers/delegate");
      return handleDelegate({
        envelope_sender: senderNodeId,
        envelope_signature: envelope.sig,
        envelope_lamport: envelope.lamport,
        payload: envelope.payload,
      });
    }
  );

  // chat-relay — peer is driving an interactive chat session on us. Capability
  // gated (must be opted in per-peer), rate-limited, loop-guarded; the handler
  // runs through the local engine so the destructive-action floor and
  // permission profile still apply.
  registerHandler<import("./handlers/chat-relay").ChatRelayRequest, import("./handlers/chat-relay").ChatRelayResponse>(
    "chat-relay",
    async ({ envelope, senderNodeId }) => {
      const { handleChatRelay } = await import("./handlers/chat-relay");
      return handleChatRelay({ envelope, senderNodeId });
    }
  );

  // audit-query — peer asks for one of our audit rows so they can verify a
  // cross-reference they recorded. The handler only releases rows the
  // requester has a recorded fleet_audit_links entry for, so this isn't
  // a scrape vector.
  registerHandler<import("./handlers/audit-query").AuditQueryRequest, import("./handlers/audit-query").AuditQueryResponse>(
    "audit-query",
    async ({ envelope, senderNodeId }) => {
      const { handleAuditQuery } = await import("./handlers/audit-query");
      return handleAuditQuery({
        envelope_sender: senderNodeId,
        payload: envelope.payload,
      });
    }
  );

  // knowledge-query — peer searches our shareable knowledge. Per V6 plan §9
  // sync with a 5s timeout (caller-enforced); we return snippets only.
  registerHandler<import("./handlers/knowledge-query").KnowledgeQueryRequest, import("./handlers/knowledge-query").KnowledgeQueryResponse>(
    "knowledge-query",
    async ({ envelope, senderNodeId }) => {
      const { handleKnowledgeQuery } = await import("./handlers/knowledge-query");
      return handleKnowledgeQuery({
        envelope_sender: senderNodeId,
        envelope_signature: envelope.sig,
        envelope_lamport: envelope.lamport,
        payload: envelope.payload,
      });
    }
  );

  // knowledge-fetch — peer pulls full content of a doc with policy
  // 'fleet-readable'. Stricter than query because they have to know the id
  // (which they only get by going through a prior query).
  registerHandler<import("./handlers/knowledge-fetch").KnowledgeFetchRequest, import("./handlers/knowledge-fetch").KnowledgeFetchResponse>(
    "knowledge-fetch",
    async ({ envelope, senderNodeId }) => {
      const { handleKnowledgeFetch } = await import("./handlers/knowledge-fetch");
      return handleKnowledgeFetch({
        envelope_sender: senderNodeId,
        envelope_signature: envelope.sig,
        envelope_lamport: envelope.lamport,
        payload: envelope.payload,
      });
    }
  );

  // conversation-sync — bidirectional chat history mesh. Peers with
  // sync_conversations exchange deltas so every device sees the same threads;
  // origin_node_id / origin_label tell you which machine authored each turn.
  registerHandler<
    import("./conversation-sync").ConversationSyncRequest,
    import("./conversation-sync").ConversationSyncResponse
  >("conversation-sync", async ({ envelope, senderNodeId }) => {
    const { handleConversationSync } = await import("./conversation-sync");
    return handleConversationSync({
      envelope_sender: senderNodeId,
      payload: envelope.payload,
    });
  });

  // workspace-relay — peer asks us to run allowlisted git/coding/fs ops on our disk.
  registerHandler<
    import("./handlers/workspace-relay").WorkspaceRelayRequest,
    import("./handlers/workspace-relay").WorkspaceRelayResponse
  >("workspace-relay", async ({ envelope, senderNodeId }) => {
    const { handleWorkspaceRelay } = await import("./handlers/workspace-relay");
    return handleWorkspaceRelay({ envelope, senderNodeId });
  });
}
