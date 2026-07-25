# Mesh depth & deferred wave (v4) — implementation status

Maps [`PRD-mesh-depth-v4.md`](./PRD-mesh-depth-v4.md) to shipped work.

Predecessor: [`personal-assistant-v3-implementation.md`](./personal-assistant-v3-implementation.md).

## Status

| # | Item | Status | Key files | Tests |
|---|------|--------|-----------|-------|
| **M1** | Workspace-relay initiator + tool routing | ✅ Done | `workspace-relay-initiator.ts`, `workspace-route.ts`, `tool-cache-wrapper.ts`, inbound ALS guard | `__tests__/workspace-relay.test.ts` |
| **M2** | Remote worktree create/discard + session mirror | ✅ Done | `workspace-session-mirror.ts`, `db/coding.ts` (`id` override), discard local mark | same |
| **M3** | Persist/honor compute_placement | ✅ Done | `src/app/page.tsx` (Run on PATCH + load), chat-placement `conversation_id` | placement-pins |
| **M4** | Cross-mesh token streaming | ✅ Done | fleet NDJSON stream, `sendToPeerNdjson`, chat SSE `token` events, `runAgent` on executor | chat-relay tests still apply |
| **M5** | Remote confirmation propagation | ⏳ Partial | still fail-closed on executor `ask` (documented); design in PRD | — |
| **D1** | Chromium print-to-PDF | ✅ Done | `db/presentations.ts` Playwright `page.pdf()` + HTML fallback | presentations-deck |
| **D2** | MindStudio provider (opt-in) | ✅ Done | `providers/mindstudio.ts`, Models/Settings cloud label | — |
| **D3** | Unipile channel (opt-in) | ✅ Done | `channels/unipile.ts`, webhook/status routes, Settings card | — |
| **D4** | code-server embed path | ✅ Done | settings v38, open-window + Electron URL; does not spawn binary | — |
| **W0** | WAN / NAT | Docs only | PRD § — out of scope | n/a |

## Notes

- Config schema: **v38** (`code_server_enabled`, `code_server_url`).
- Workspace relay never allowlists `shell`; inbound handler uses ALS to prevent A→B→A re-relay.
- MindStudio uses OpenAI-compatible HTTP (`MINDSTUDIO_BASE_URL`); real MindStudio app-run API may need a follow-up adapter.
- Unipile HMAC is required to enable the channel; unsigned webhooks are rejected (public route). Confirm scheme against Unipile’s live docs when wiring production.
- WAN remains explicitly out of scope.
