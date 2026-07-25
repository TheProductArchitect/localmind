# PRD — Mesh depth & deferred wave (v4)

> **Product:** LocalMind / Sora  
> **Status:** Shipped (M1–M5 + D1–D4); WAN (W0) intentionally out of scope  
> **Predecessor:** [`PRD-personal-assistant-v3.md`](./PRD-personal-assistant-v3.md) (Features A–F shipped; several items explicitly deferred)  
> **Tracker:** [`mesh-depth-v4-implementation.md`](./mesh-depth-v4-implementation.md)

## 1. Why this wave

v3 shipped **placement pins** (compute vs workspace schema + UI + inbound `workspace-relay` handler) but **did not close the loop**: nothing initiates workspace RPCs, coding sessions still create worktrees only on the local disk, and “Run on” compute choice is ephemeral. Deferred items (token streaming, PDF print, MindStudio, Unipile, code-server, WAN) remained docs-only.

This wave finishes the mesh promise and lands the deferred items that are product-ready, with clear non-goals for WAN.

## 2. Locked decisions

| Topic | Decision |
|---|---|
| Mesh topology | **LAN paired devices only** — no WAN/NAT/STUN/TURN in this wave |
| Repo transfer | **Never** sync full git trees — allowlisted RPC only (`git`, `coding_project`, `filesystem`) |
| Split placement MVP | **Compute local + workspace peer** fully supported; remote compute + remote workspace relies on the executor’s own pin resolution |
| Token streaming | Ship **chunked token SSE** over the existing fleet TLS path for chat-relay |
| Confirmations across mesh | Propagate **ask** gates as structured events back to the initiator (fail-open to deny if timeout) |
| MindStudio / Unipile | **Opt-in cloud**, off by default, labeled cloud, keys via existing `api_keys` / channels encryption |
| code-server | Optional embed behind Settings flag; spawn local `code-server` binary if present |
| PDF decks | Real Chromium/Playwright `page.pdf()`; keep HTML companion as fallback |
| WAN | **Out of scope** — future sketch only in §8 |

## 3. Build order

1. **M1 — Workspace-relay initiator + tool routing** (P0)  
2. **M2 — Remote worktree create/discard + session mirror** (P0)  
3. **M3 — Persist/honor compute_placement** (P0)  
4. **M4 — Cross-mesh token streaming** (P1)  
5. **M5 — Remote confirmation propagation** (P1)  
6. **D1 — Chromium print-to-PDF** (local deferred)  
7. **D2 — MindStudio provider** (opt-in cloud)  
8. **D3 — Unipile channel** (opt-in cloud)  
9. **D4 — code-server embed path** (optional)  
10. **W0 — WAN** — documentation only  

## 4. Feature specs (summary)

### M1–M2 Workspace RPC
- New `workspace-relay-initiator.ts` mirroring chat-relay initiator (audit, `sendToPeer`, 120s timeout).
- Engine routes allowlisted tools through relay when `coding_session.workspace_peer_id` is a trusted peer (≠ local node, ≠ `"local"`).
- `coding_project.start_session` / `discard_session` with workspace pin = peer → RPC; local DB stores a **mirror session** (same id as remote when possible) with peer columns set.
- Unit tests with mocked `sendToPeer`.

### M3 Compute pin persistence
- Chat “Run on” writes `compute_placement` on conversation (or settings when no active chat), same pattern as Workspace.
- `/api/fleet/chat-placement` always receives `conversation_id` when available.
- Load pins when opening a conversation.

### M4 Token streaming
- Executor runs streaming agent; fleet protocol emits token chunks (HTTP chunked or multi-envelope stream).
- Initiator SSE maps `token` events into the assistant bubble (parity with local chat).

### M5 Confirmations
- When executor hits `ask`, return a pending-confirm payload; initiator shows ConfirmationCard; decision RPC resumes executor (or deny on timeout).

### D1 PDF
- `exportPresentation(..., "pdf")` uses Playwright Chromium to print HTML → `export.pdf`.

### D2 MindStudio
- `src/lib/providers/mindstudio.ts` + Models/Settings cloud tab; never default; clear “Cloud — MindStudio” label.

### D3 Unipile
- Channel adapter + Settings connect flow; webhook HMAC; web-guard / kill-switch respected; LinkedIn automation requires explicit consent copy.

### D4 code-server
- If `code_server_enabled` and binary on PATH (or configured path), coding window loads code-server against the **workspace** root (local path or “open on workspace peer” deep link).

### W0 WAN
- Not built. Sketch: future optional relay broker with pinned peer identity — separate PRD.

## 5. Acceptance criteria

- [x] Unit/integration: workspace route + initiator with mocked `sendToPeer` (`__tests__/workspace-relay.test.ts`).
- [x] Pins persist per conversation and as global defaults (UI + settings/conv PATCH).
- [x] Audit log records workspace-relay tool executions with peer id (initiator + inbound federated rows).
- [x] Remote chat streams tokens (NDJSON → SSE).
- [x] Deck PDF export produces a real `.pdf` when Chromium is available (HTML fallback otherwise).
- [x] MindStudio / Unipile disabled by default; enabling requires key + cloud label.
- [x] Docs never claim WAN mesh.
- [x] Remote `ask` confirmation propagation (M5) — NDJSON `confirm` frames + `confirm-decision` RPC; timeout denies. Unit/integration covered; two-device E2E still recommended.
- [ ] Two paired devices E2E: compute=Device1, workspace=Device2 (manual QA).
- [ ] Discard on compute removes remote worktree via RPC (covered in unit path; needs two-device E2E).

## 6. Guardrails

- ❌ Don’t sync full repos.
- ❌ Don’t allow `shell` on workspace-relay allowlist.
- ❌ Don’t enable Unipile/MindStudio by default.
- ❌ Don’t ship NAT traversal in this wave.
- ❌ Don’t break local-only coding when no peers are paired.

### D4 note (as shipped)
Loads a configured `code_server_url` in the Electron coding window when
`code_server_enabled` is on. Does **not** auto-install or spawn a `code-server`
binary — operator must run it separately.

## 7. DGX hub extension (post-v4)

Shipped alongside M5 for the “DGX thinks, PC acts” personal-assistant setup:

- **GPU-aware Auto placement** — `preferGpu` in chat placement.
- **Tool home = initiator** — `tool-relay` allowlist + `accept_tool_relay` policy + Chat **Tools** control.
- **Heartbeat `primary_addr` refresh** — DHCP renumbers without re-pairing.
- See setup notes in [`mesh-depth-v4-implementation.md`](./mesh-depth-v4-implementation.md).

## 8. WAN sketch (future — not this wave)

Out of scope for v4. A future PRD may explore:

1. Optional **relay broker** that only forwards signed LocalMind envelopes between already-paired node identities (no cleartext tool payloads at rest).
2. Peers still authenticate with the same pinned mTLS certs / Ed25519 node ids from LAN pairing — pairing remains physical/QR, not public discovery.
3. No STUN/TURN embedded in the app; operators who need reachability use their own tunnel/VPN and keep `primary_addr` pointed at a reachable endpoint.
4. Rate limits + `accept_*_relay` gates remain mandatory; WAN must not widen default trust.
