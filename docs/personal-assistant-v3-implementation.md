# Personal Assistant v3 — implementation status

Maps the features in [`PRD-personal-assistant-v3.md`](./PRD-personal-assistant-v3.md) to what shipped, with code pointers and test coverage.

Predecessor status: [`sora-v2-implementation.md`](./sora-v2-implementation.md). Architecture map: [`architecture.md`](./architecture.md).

## Shipped

| # | Feature | Status | Key files | Tests |
|---|---------|--------|-----------|-------|
| **E** | Frontier models / Gemini / unified picker / per-chat override | ✅ Done | `src/lib/providers/gemini.ts`, `providers/index.ts`, `src/app/models/page.tsx`, `src/lib/agent/routing.ts`, chat header model picker (`src/app/page.tsx`), conv `model_provider`/`model_name` (conv mig v6), persona `provider` (config mig v33) | `__tests__/gemini-provider.test.ts`, `__tests__/routing.test.ts` |
| **C** | Workflow automation (page watch, templates, `manage_workflow`, reminders) | ✅ Mostly done | `src/lib/automations/page-content.ts`, `monitor.ts` (`page_content_change`), `src/lib/tools/manage-workflow.ts`, `src/lib/workflow/templates.ts`, `/automations`, Sora grant mig v34 | `__tests__/page-content-monitor.test.ts` |
| **A** | Coding assistant polish | ✅ Done | `src/lib/coding/worktree.ts` (discard + orphan cleanup), `gate2.ts` + `markProposalNeedsProject`, `src/lib/tools/git.ts` (main/master guard), Ops needs-project cards (`orchestration/processes`), `/projects` | `__tests__/coding-worktree.test.ts`, `__tests__/gate2.test.ts` |
| **D** | Mesh compute vs workspace pins | ✅ Done | `src/lib/fleet/capabilities.ts` (`accepts_workspace_relay`), `placement-pins.ts`, `chat-placement.ts`, `handlers/workspace-relay.ts`, settings + conv pins (mig v36 / conv v7), coding session peer cols (mig v37), chat Workspace picker, Fleet `accept_workspace_relay` toggle | `__tests__/placement-pins.test.ts` |
| **B** | Presentations | ✅ Done | `ARTIFACTS_DIR` / `PRESENTATIONS_DIR` in `paths.ts`, `presentations` table (mig v35), `src/lib/presentations/deck.ts`, `src/lib/db/presentations.ts`, `src/lib/tools/presentation.ts`, PPTX via `pptxgenjs`, HTML/PDF companion export, `/api/presentations`, `/presentations`, ⌘K entry | `__tests__/presentations-deck.test.ts` |
| **F** | Self-extension prompt/copy polish | ✅ Done | `assemble-system-prompt.ts` “Extending capabilities” (MCP → plugins → Ops Gate-2, no hot-patch), `/plugins` empty-state copy | prompt smoke via existing assemble path |

## Build order (from PRD §9)

1. **E** — Frontier models ✅  
2. **C** — Workflow automation ✅ (mostly)  
3. **A** — Coding polish ✅  
4. **D** — Mesh pins ✅  
5. **B** — Presentations ✅  
6. **F** — Self-extension polish ✅  

## Deferred (explicitly out of v3)

- Unipile / MindStudio (paid cloud)
- WAN mesh / NAT
- True cross-mesh token streaming
- code-server embed in coding window
- Sora v2 Context Graph GraphQL / `user_context` tool
- Full Chromium print-to-PDF for decks (HTML export ships; print is optional)

## Notes

- Config schema after this slice: **v37** (placements + coding session peer ids; presentations at v35).
- Conversations schema: **v7** (`compute_placement` / `workspace_placement`).
- Coding / fleet / automations / multi-provider bases from Sora v2 are extended in place — no forked engines.
- Security: web-guard, audit hash chain, and confirm floors unchanged; workspace-relay is allowlisted (`git` / `coding_project` / `filesystem`) and peer-policy gated.
