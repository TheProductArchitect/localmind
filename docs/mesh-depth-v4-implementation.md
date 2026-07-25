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
| **M5** | Remote confirmation propagation | ✅ Done | `handlers/confirm-decision.ts`, `confirm-decision-initiator.ts`, `/api/fleet/peers/*/confirm`, chat-relay `onEvent`, NDJSON `confirm`/`confirm_timeout` frames, `page.tsx` remote decide | — |
| **DGX-A** | GPU-aware chat placement + addr refresh | ✅ Done | `graph/placement.ts` (`preferGpu`), `chat-placement.ts`, `capabilities.ts` (`primary_addr`, `accepts_tool_relay`), `db/fleet.ts` (`updatePeerPrimaryAddr`) | `__tests__/placement-gpu.test.ts` |
| **DGX-B** | Tool home = initiator (PA on my PC) | ✅ Done | `handlers/tool-relay.ts`, `tool-relay-initiator.ts`, `tool-relay-context.ts`, `tool-cache-wrapper.ts`, chat-relay `tool_home`, Chat UI Tools control | `__tests__/tool-relay.test.ts` |
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

## DGX Spark hub over WiFi/LAN — setup

Goal: a powerful box (e.g. DGX Spark) does the LLM thinking; each personal PC keeps
files / calendar / mail / browser actions local.

1. **Same LAN.** Put the DGX and each PC on the same WiFi/subnet. The fleet
   listener binds `0.0.0.0:9443` (`LOCALMIND_FLEET_PORT`). Heartbeats now
   advertise `primary_addr`, so a DHCP renumber refreshes `fleet_peers.primary_addr`
   automatically — no re-pairing needed after an IP change.
2. **Pair** each PC with the DGX (Fleet → pair via QR). Pairing pins mTLS certs.
3. **On the DGX**, pull the big models (e.g. `llama3.1:70b`). Chat Auto placement
   is GPU-aware: a fresh GPU peer with a large model wins over an idle laptop.
4. **On each PC**, in Fleet → the DGX peer's Policy, enable **Accept tool relay**
   so the DGX's model may run allowlisted PA tools back on that PC.
5. **In chat**, set compute to the DGX (or Auto) and leave **Tools → On this device**.
   The model runs on the DGX while filesystem/calendar/email/reminders/contacts/
   browser/mac_automation execute on your PC. `shell` and git/coding stay off the
   tool-relay path (git/coding use workspace-relay).
6. **Confirmations** (destructive `ask`/`pin` actions) raised on the DGX now stream
   back to the initiating PC for approval (M5); `pin`-tier gates are validated
   against the DGX's own PIN.
