# Sora v2 — implementation status

Maps the features in [`PRD-sora-v2.md`](./PRD-sora-v2.md) to what shipped, with
code pointers and test coverage. Built free/local-first features first; paid
cloud integrations are deferred.

## Shipped

| # | Feature | Status | Key files | Tests |
|---|---------|--------|-----------|-------|
| B | Hide / summon Sora on Browse | ✅ | `src/components/browse/app-browser.tsx`, `sora-panel.tsx` | typecheck/lint |
| D | `schedule_task` tool | ✅ | `src/lib/tools/schedule.ts`, `src/lib/db/automations.ts` (`updateTask`), `permission-guard.ts` (`schedule_write` floor) | `__tests__/schedule-tool.test.ts` |
| A | Ops Kanban `/ops` | ✅ | migration v21, `src/app/ops/page.tsx`, `src/components/ops/pillars.tsx`, `agent-processes.ts` (`getBoard`/`bucketLanes`), `?board=1` | `__tests__/ops-board.test.ts` |
| G.3 | Context Broker | ✅ | `src/lib/agent/context-broker.ts`, wired into `assemble-system-prompt.ts` | `__tests__/context-broker.test.ts` |
| C1 | you.com search backend | ✅ (opt-in, keyed) | migration v22, `src/lib/tools/websearch.ts`, `web_search_provider` setting | `__tests__/websearch-provider.test.ts` |
| C2 | Brain vault + `brain_edges` | ✅ | migration v23, `src/lib/db/brain.ts`, `paths.ts` (`BRAIN_DIR`) | `__tests__/brain.test.ts` |
| F | Pillars + Ideate persona | ✅ | migration v24 (Strategist), `src/lib/agent/pillar-classify.ts`, `engine.ts` tagging | `__tests__/pillar-classify.test.ts` |
| G.1/G.2 | Idle cycle + self-improve proposals | ✅ | migration v25, `src/lib/db/proposals.ts` / `self-checks.ts`, `src/lib/agent/idle.ts` / `idle-cycle.ts`, `/api/ops/proposals/*`, `/api/internal/idle-tick`, worker tick | `__tests__/proposals.test.ts`, `__tests__/idle.test.ts` |
| H | User Context Graph `/context` | ✅ Phase 1 (REST + viz) | `src/lib/context-graph.ts`, `/api/context/graph`, `src/app/context/page.tsx`, `src/components/force-graph.tsx` | `__tests__/context-graph.test.ts` |
| E | Renovate + CI | ✅ | `renovate.json` (CI already present) | — |

Config schema is at **v25**; every migration is verified idempotent on a fresh
in-memory DB. Full suite: 32 files, 221 tests. Typecheck + lint clean.

## Integration caveats (follow-ups)

- **Context Broker** is now live in the engine: each main-chat turn retrieves
  the relevant memory/brain/knowledge slice for the user's query and folds a
  cited brief (within a token budget) into the system prompt — local, best-effort,
  and silent when nothing relevant is found. (Subagents don't run it yet.)
- **Self-improve Gate 2 build** (`pi_code` branch/PR) is authorized + audited by
  the approve endpoint; the actual build runs in the worker and isn't exercised
  in CI. Guardrails (approval-gated, human-merge-only, no auto-build/-merge) are
  enforced by the proposal transition state machine.
- **H** is Phase 1 (read-only viz + REST ingestion). The GraphQL layer and
  confirm/edit/delete of inferred nodes are the documented later phase.

## Deferred — paid cloud (await owner decision)

Both send data to paid third-party services, so they are parked per the
local-first / free-first priority:

- **C4 — Unipile** (messaging/email/LinkedIn relay).
- **C5 — MindStudio** (hosted model router; adds an npm dependency).

Each is buildable as an opt-in, disabled-by-default, keyed integration and would
be unit-tested against mocked HTTP.
