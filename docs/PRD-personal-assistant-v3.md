# LocalMind — Personal Assistant v3 Product Requirements Document

> **Status:** Draft for implementation
> **Audience:** An engineering LLM (and human reviewers) building these features into the existing LocalMind codebase.
> **Author:** Generated from the owner's personal-assistant vision + a full read of the post–Sora-v2 codebase.
> **Scope:** Six feature areas that turn LocalMind into the best local-first personal assistant that can code, present, research, automate workflows, route compute across a LAN mesh, and pick frontier models — plus cross-cutting invariants.
> **Predecessor:** [`PRD-sora-v2.md`](./PRD-sora-v2.md) (mostly shipped; see [`sora-v2-implementation.md`](./sora-v2-implementation.md)). This PRD **extends** that foundation; it does not replace it.
> **Tracking:** [`personal-assistant-v3-implementation.md`](./personal-assistant-v3-implementation.md)

---

## 0. Context — what LocalMind is today (so you build *with* the grain)

LocalMind is a **local-first AI control panel for Mac** (Next.js 15 App Router, React 19, Tailwind/Radix, Electron shell, Node ≥20.19). The assistant persona is **Sora**. Work stays on-device unless the user opts into a cloud model or search provider.

**Product vision this PRD serves:** LocalMind should be the personal assistant that can **code**, **create presentations**, **search the web**, **automate recurring work** (scraping digests, reminder emails, watches), and **extend itself** when a capability is missing — while letting the user **pin where compute runs vs where repos live** across paired LAN devices, and **pick models from frontier labs** via encrypted API keys.

Architecture you must respect and reuse (post–Sora-v2):

| Layer | Reality in the repo |
|---|---|
| **Agent engine** | `src/lib/agent/engine.ts` — streaming SSE tool-calling loop, subagents, confirmations, audit, Context Broker injection. |
| **System prompt** | `src/lib/agent/assemble-system-prompt.ts` — composable blocks per persona. |
| **Tools** | `src/lib/tools/*` registered in `BUILTIN[]` (`src/lib/tools/index.ts`). Contract: `src/lib/tools/types.ts`. MCP tools merge via `listAllTools()`. |
| **Providers** | `src/lib/providers/*` — `getProvider()` / `getProviderByName()`; Ollama (default), Anthropic, OpenAI, Groq, OpenRouter, LM Studio. Keys: `src/lib/db/apikeys.ts` (AES-256-GCM). |
| **Databases** | `better-sqlite3` under `~/.localmind/` (`config.db`, `conversations.db`, knowledge DB). Migrations: `src/lib/db/migrations.ts` (schema at **v32+** when this lands). |
| **Ops / processes** | `agent_processes` + `/ops` Kanban; proposals two-gate self-improve. |
| **Scheduling & workflows** | `scheduled_tasks`, `monitors`, `workflows` in `src/lib/db/automations.ts`; executor `src/lib/workflow/executor.ts`; scheduler `src/lib/scheduler.ts`; UI `/automations`. |
| **Coding** | Worktrees `src/lib/coding/worktree.ts`, SWE graph `swe-graph.ts`, Gate 2 `gate2.ts`, tools `coding_project` / `git`, UI `/projects`. |
| **Fleet mesh (LAN)** | Pairing/TLS/capabilities/chat placement/relay under `src/lib/fleet/*`; graph placement `src/lib/graph/placement.ts`. |
| **Web** | `web_search` / `web_research` / Secure Browser / web-guard (`src/lib/agent/web-guard.ts`). |
| **Mac local** | `email`, `calendar`, `reminders`, `contacts`, `mac_automation` tools. |
| **Extensibility** | `install_mcp_server`, plugin marketplace (`src/lib/plugins/*`), Gate-2 coding PRs. |
| **Security invariants** | Append-only audit hash chain; server-side permission guard; web kill switch + site grants; confirm floors. **Do not weaken these.** |

**Guiding principle:** extend existing subsystems — tools, providers, worker jobs, DB tables + migrations, pages/components. Do **not** fork a second agent loop, second workflow engine, or second key store.

---

## 1. Priority summary & locked decisions (read this first)

| # | Feature | Verdict | Notes |
|---|---|---|---|
| A | **Coding assistant polish** | ✅ Build (extend) | Harden the landing coding stack; no second coding product. |
| B | **Presentations** | ✅ Build (greenfield) | Outline → Markdown deck → PPTX + PDF; chat + `/presentations`. |
| C | **Workflow automation** | ✅ Build (extend) | Scraping monitors, reminder-email templates, `create_workflow` tool — on top of existing automations. |
| D | **Mesh compute vs workspace pins** | ✅ Build (extend) | LAN only; independently pin compute peer and repo peer. |
| E | **Frontier models / API keys UX** | ✅ Build (extend) | Gemini + unified Models catalog + `{provider, model}` selection + per-chat override. |
| F | **Self-extension** | ✅ Frame + small polish | MCP + plugins + Gate-2 PRs only; no unsupervised hot-patch. |

**Locked product decisions (not optional):**

| Decision | Choice |
|---|---|
| Mesh scope | **LAN paired devices only** — no WAN/NAT in v3 |
| Compute vs repo | User can **independently pin** chat/SWE *compute peer* and *workspace/repo peer* |
| Self-extension | MCP install + Gate-2 coding PRs; **never** unsupervised hot-patch or auto-merge |
| Automations | **Extend** `scheduled_tasks` / `monitors` / `workflows` / `deliver()` |
| Email reminders | Prefer **local Mail** (`email` tool) + schedule/workflow; Unipile stays deferred |
| Presentations | Artifact store + export **PPTX** (`pptxgenjs`) **and PDF** |
| Frontier models | Unify Models UI; add **Google Gemini**; selection is `{provider, model}`; OpenRouter remains the aggregator path |
| Cloud paid | **Unipile** and **MindStudio** remain deferred (same as Sora v2) |

Two hard pushbacks up front:

1. **Do not invent a parallel automation or scraper product.** Page watches and reminder emails plug into monitors + workflows + web-guard.
2. **Do not let Sora rewrite and run its own source unsupervised.** Self-extension stays two-gate (Ops proposal → Approve → branch/PR; human merges). See Feature F and Sora v2 §7.2.

---

## 2. Feature A — Coding assistant polish

### 2.1 Problem
Autonomous coding (worktrees, SWE graph, Gate 2, `/projects`) has landed but needs reliability and UX polish before it feels like “LocalMind can code for me.” Mesh placement for coding is still “same peer for everything,” and the coding window is thin (no embedded IDE yet — deferred).

### 2.2 Goal
Make the existing coding path **trustworthy and discoverable**: register a repo → open a session → plan/implement/test/review → open a PR on a feature branch → Discard fully undoes. Gate 2 reliably starts a session when the owner approves an Ops proposal and a project is registered.

### 2.3 Non-goals
- Not a full IDE replacement; **no code-server embed in v3** (optional later, called out in follow-ups).
- Not rewriting the SWE graph into a new orchestration framework.
- Not auto-merging to `main`/`master` under any setting.

### 2.4 Technical design — reuse
| Piece | Path |
|---|---|
| Worktrees | `src/lib/coding/worktree.ts`, `~/.localmind/workspaces/` |
| Sessions DB | `src/lib/db/coding.ts` |
| SWE loop | `src/lib/coding/swe-graph.ts` (already uses `createPlacementRunner`) |
| Gate 2 | `src/lib/coding/gate2.ts` + `src/app/api/internal/idle-tick/route.ts` |
| Tools | `src/lib/tools/coding-project.ts`, `git.ts`, `pi-code.ts` |
| UI | `src/app/projects/page.tsx`, Electron open-window API |

**Harden:**
- Discard = remove worktree + delete session branch; never leave orphan worktrees.
- PR path: push feature branch + open PR only; force-push stays confirmation-gated; refuse push to `main`/`master`.
- Gate 2: if no `coding_project` and no `LM_SELF_IMPROVE_PROJECT_ID`, leave proposal in a clear “needs project” state on `/ops` instead of silent no-op.
- Prompt quality: coding-oriented blocks in `assemble-system-prompt.ts` when a coding session is active.
- Tests: keep `__tests__/coding-worktree.test.ts` and `__tests__/swe-graph.test.ts` green; add regression cases for discard and main-guard.

### 2.5 API / UX
- Keep `/projects` as the registry + session list; ⌘K “Projects” already wired.
- Session detail: status, branch, last SWE step, **Open PR** / **Discard** actions.
- Electron coding window remains optional chrome around the same session APIs.

### 2.6 Acceptance criteria
- [ ] Register project → create session → SWE completes or fails with a visible `/ops` card.
- [ ] Agent never pushes to `main`/`master`; feature branch + PR only.
- [ ] Discard removes worktree and session branch; project root unchanged.
- [ ] Approving a Gate-2 proposal with a registered project starts a coding session; without a project, the card explains what to register.
- [ ] Existing coding tests pass; new discard/main-guard tests cover the failure modes above.

### 2.7 Effort
~2–3 days polish + tests (foundation already landed).

---

## 3. Feature B — Presentations

### 3.1 Problem
Users ask Sora for decks; today the best outcome is Markdown in chat or Brain notes. There is **no** slide artifact, export, or presentation tool.

### 3.2 Goal
Sora can **create and iterate presentations** as first-class artifacts: outline → slide deck (Markdown-backed) → export **PPTX** and **PDF**, listable under `/presentations`.

### 3.3 Non-goals
- Live Keynote/PowerPoint sync or round-trip editing of arbitrary PPTX.
- Fancy animations, speaker notes UI, collaborative multiplayer.
- Replacing Brain notes — decks are a separate artifact type.

### 3.4 Data model
New table `presentations` in `config.db` (migration):

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | nanoid |
| `title` | TEXT | |
| `owner_user_id` | TEXT | |
| `status` | TEXT | `draft` \| `ready` \| `exported` |
| `deck_path` | TEXT | relative path under artifacts dir |
| `slide_count` | INTEGER | |
| `created_at` / `updated_at` | INTEGER | epoch ms |

**On-disk:** `~/.localmind/artifacts/presentations/{id}/deck.md` (source of truth) plus `export.pptx` / `export.pdf` when generated. Add `ARTIFACTS_DIR` (or presentations subpath) to `src/lib/paths.ts`.

**Deck Markdown format (v1):** YAML frontmatter (`title`, `theme` optional) + slides separated by `---`, each slide:

```markdown
# Slide title

- Bullet one
- Bullet two

Optional body paragraph.
```

### 3.5 Tools
Add builtin `presentation` (or `create_presentation`) in `src/lib/tools/presentation.ts`:

| Action | Behavior |
|---|---|
| `create` | title + optional outline → write `deck.md`, DB row |
| `list` / `get` | metadata + slide preview |
| `update_slides` | replace or patch slides by index |
| `export` | `format: pptx \| pdf` → write export files; return paths |

**Export:**
- **PPTX:** `pptxgenjs` (pin in package.json; Renovate-aware).
- **PDF:** render slides to HTML and print via existing Chromium/Playwright path **or** a small headless print helper — must stay local; no cloud convert API.

Grant the tool to Sora via migration (`enabled_tools`). `actionType`: `read` for list/get; `write` for create/update/export (permission-guard floor consistent with filesystem writes).

### 3.6 API / UX
- `GET/POST /api/presentations`, `GET/PATCH /api/presentations/[id]`, `POST /api/presentations/[id]/export`
- Page `src/app/presentations/page.tsx`: list decks, open preview (Markdown → simple slide view), download PPTX/PDF.
- Rail or ⌘K entry under Work/Knowledge cluster (prefer **Work** cluster or Fleet-adjacent “Create”; ⌘K “Presentations” is enough if rail is crowded).
- Chat: Sora uses the tool; UI can deep-link `localmind://` or `/presentations?id=…` in the tool result.

### 3.7 Acceptance criteria
- [ ] From chat, Sora creates a multi-slide deck stored under `~/.localmind/artifacts/presentations/`.
- [ ] User can open `/presentations`, preview slides, download PPTX and PDF.
- [ ] Updating slides via tool persists to `deck.md` and bumps `updated_at`.
- [ ] No deck content leaves the machine during export.
- [ ] Unit tests cover Markdown parse ↔ slide model ↔ PPTX generation (mock filesystem).

### 3.8 Effort
~4–5 days (tool + DB + export + list page + tests).

### 3.9 Dependencies
| Package | Role |
|---|---|
| `pptxgenjs` | PPTX generation |

---

## 4. Feature C — Workflow automation (scraping, reminders, recurring jobs)

### 4.1 Problem
LocalMind already has scheduled tasks, monitors, and multi-step workflows, but users still struggle to express everyday automations: “scrape this page daily and email me a digest,” “remind me every Monday,” “watch this URL for content changes.” Discoverability from chat is weak; monitors only cover `url_reachable` / `url_unreachable` / `file_change` / `shell`.

### 4.2 Goal
Make automation **obvious and capable** for personal-assistant jobs:

1. **Page content watches** (scraping-lite) that respect web-guard.
2. **Reminder emails / notifications** via schedule + Mail / channels.
3. **Sora can create workflows and schedules** from natural language.
4. New **templates** for the common cases.
5. Runs visible on `/ops` when they fail or need approval.

### 4.3 Non-goals
- Full desktop RPA / click-recorder.
- Unsupervised scraping of sensitive domains (web-guard + confirm floors stay).
- Replacing Unipile — Gmail/LinkedIn cloud relay stays deferred; use macOS Mail + Telegram/Twilio for delivery.
- A second workflow executor or cron system.

### 4.4 Technical design — extend existing

**Reuse:**

| Piece | Path |
|---|---|
| Tables / CRUD | `src/lib/db/automations.ts` |
| Monitor runner | `src/lib/automations/monitor.ts` |
| Workflow executor | `src/lib/workflow/executor.ts` (steps: `agent`, `tool`, `condition`, `delay`, `notify`, `human_approval`, `loop`) |
| Delivery | `src/lib/workflow/deliver.ts`, `src/lib/channels/email-digest.ts` |
| Schedule tool | `src/lib/tools/schedule.ts` + `nlToCron()` in `src/lib/cron.ts` |
| Templates | `src/lib/workflow/templates.ts` + plugin `workflow-template` type |
| UI | `src/app/automations/page.tsx` |

#### 4.4.1 New monitor type: `page_content_change`

`check_config` JSON shape:

```json
{
  "url": "https://example.com/pricing",
  "selector": "main",
  "hash": "sha256-of-last-normalized-text"
}
```

Runner (`monitor.ts`):

1. Fetch/read page via **Secure Browser** path (`read_secure_webpage` internals or shared helper) — **must** call through web-guard (kill switch, site grants, sensitive blindness).
2. Extract text (optional CSS `selector`); normalize whitespace; SHA-256.
3. If hash differs from stored `hash`, update hash, set status `changed`, and optionally `trigger_workflow_id`.
4. First run seeds hash without triggering (avoid false positive on install).

If the URL is blocked by web-guard, mark monitor `error` with a clear message; do not bypass.

#### 4.4.2 Tool: `manage_workflow` (create / update / list / run)

Add `src/lib/tools/manage-workflow.ts` so Sora can:

- `create` — name, trigger (`manual` \| `schedule` + cron), steps array (validated against executor step types)
- `list` / `get` / `enable` / `disable` / `run_once`

`actionType`: `write` for mutations; require **confirmation** on create/update that includes `tool` steps with `browser` or outbound `email`/`telegram`. Reuse permission floors similar to `schedule`.

Improve `schedule` tool prompt docs so NL reminders (“every Monday at 9am email me…”) prefer: create scheduled task **or** workflow with `notify`/`email` step.

#### 4.4.3 New workflow templates

Add to `WORKFLOW_TEMPLATES` in `src/lib/workflow/templates.ts` (and optionally plugin registry builtins):

| id | Purpose |
|---|---|
| `url-watch-digest` | Monitor-triggered: summarize changed page → notify/email |
| `daily-scrape-digest` | Scheduled: `web_research` / `read_secure_webpage` on a URL list → digest → email/telegram |
| `email-reminder` | Scheduled: send reminder body via `email` tool or email-digest channel |
| `inbox-triage-digest` | Extend existing `new-email-triage` with email-digest delivery option |
| `morning-ops-brief` | Calendar + reminders + open Ops “Needs you” count → notify |

#### 4.4.4 Ops visibility
Ensure workflow runs and failed monitors surface as process cards (reuse `startProcess` / `updateProcess` patterns already used by the executor). Failed automation → **Failed** lane with last error snippet.

### 4.5 API / UX
- Extend monitor create API to accept `page_content_change`.
- Automations UI: new monitor type in the form; template gallery section with one-click install (already partially true for workflows).
- Settings copy: “Sora can schedule reminders and watch pages — ask in chat.”

### 4.6 Acceptance criteria
- [ ] User (or Sora) creates a `page_content_change` monitor; content change triggers linked workflow once; first seed does not trigger.
- [ ] Blocked URL cannot be monitored without a grant; attempt fails closed with audit entry.
- [ ] “Remind me every Monday at 9 to email myself X” creates a working schedule or workflow that delivers via Mail or digest.
- [ ] `manage_workflow` create is confirm-gated when steps send email or use browser.
- [ ] New templates appear in `/automations` and can be installed.
- [ ] Failed workflow run appears on `/ops` Failed (or Needs you if awaiting approval).
- [ ] Tests: monitor hash change detection; workflow template validation; tool confirm classification.

### 4.7 Effort
~4–5 days (monitor type + tool + templates + UI + tests).

---

## 5. Feature D — Mesh: pin compute vs workspace

### 5.1 Problem
Fleet LAN mesh can place chat (“Run on → Auto”) and task-graph nodes by load/capabilities, but the user cannot say: **“think on Device A, keep the git repo on Device B.”** Coding worktrees are local to whichever machine runs the tools.

### 5.2 Goal
On a paired LAN mesh, the user can **independently pin**:

- **Compute peer** — where the model/agent loop runs (`local` \| `peerId` \| `auto`)
- **Workspace peer** — where repo/worktree/filesystem coding tools execute (`local` \| `peerId`)

Switching pins is seamless for new turns/sessions (in-flight runs finish on the peer they started).

### 5.3 Non-goals
- WAN / cloud mesh, NAT traversal, or public discovery.
- True token-streaming across the mesh (still progressive-status SSE for remote chat; document as follow-up).
- Moving an existing worktree mid-session between peers (v3: pin applies at **session start**).

### 5.4 Technical design

**Capabilities** (`src/lib/fleet/capabilities.ts`): advertise at least:

- existing: models, tools, load, GPU, `accepts_chat_relay`
- new: `accepts_workspace_relay` (peer allows remote git/worktree/fs tool execution for coding)
- new: `coding_projects` summary (ids/names/paths registered) optional for UI

**Placement settings** (conversation override + global defaults in `settings`):

| Key | Values |
|---|---|
| `compute_placement` | `local` \| `auto` \| `<peer_id>` |
| `workspace_placement` | `local` \| `<peer_id>` |

Store per-conversation in conversation metadata (or a small `conversation_placement` table) and fall back to settings.

**Chat path:** extend `src/lib/fleet/chat-placement.ts` + chat UI “Run on” to read compute pin; keep relay handler `handlers/chat-relay.ts`.

**Coding path:**

1. Session create records `compute_peer_id` + `workspace_peer_id`.
2. SWE graph model steps run via placement runner on **compute** peer.
3. `git` / `coding_project` / worktree mutations execute on **workspace** peer:
   - If workspace is local → today’s code paths.
   - If workspace is remote → new fleet handler `workspace-relay` (or extend `delegate`) that runs an allowlisted set of coding/fs/git operations and returns results.
4. Never send the entire repo over the mesh; operations are remote procedure calls against the peer’s disk.

**Security:** workspace relay is owner-gated, confirm on first grant per peer (mirror chat-relay grant), audited, tool allowlist only (no arbitrary shell by default; `shell` stays confirm + local policy).

### 5.5 API / UX
- `GET/PATCH /api/fleet/placement` — defaults; conversation patch via existing chat settings or `/api/chat/...`.
- Chat header: **Compute** picker + **Workspace** picker (Workspace shown when coding tools enabled or a coding session is active; can always show on Fleet page).
- `/fleet` page: list peers with compute/workspace eligibility; toggle “Accept workspace relay.”

### 5.6 Acceptance criteria
- [ ] Two paired devices: set compute=Device1, workspace=Device2; coding session creates worktree on Device2; agent LLM turns run on Device1.
- [ ] Pins persist per conversation and as global defaults.
- [ ] Peer without `accepts_workspace_relay` cannot be selected as workspace (UI disables + API 400).
- [ ] Audit log records workspace-relay tool executions with peer id.
- [ ] LAN-only: no change to pairing model; WAN not claimed.
- [ ] Unit tests for placement resolution; integration-style test with mocked peer transport.

### 5.7 Effort
~5–7 days (handlers + session wiring + UI + tests). Depends on Feature A being stable enough to pin sessions.

---

## 6. Feature E — Frontier labs / API keys / model picker

### 6.1 Problem
Keys and “Set as active” live in Settings; `/models` is Ollama / Hugging Face / LM Studio–centric. Cloud providers can `getModels()` but there is no unified catalog. Personas/routing can override **model id only**, which mismatches when `provider` is still Ollama. Users want Gemini and an easy pick among frontier labs.

### 6.2 Goal
1. Add **Google Gemini** as a first-class provider.
2. **Unified Models** page (and/or Settings): browse models from every connected provider.
3. Selection is always a pair **`{ provider, model }`**.
4. **Per-chat model override** on the chat header (v1).
5. Routing rules / personas may set **both** provider and model.

### 6.3 Non-goals
- MindStudio hosted router (deferred).
- Building a billing/cost dashboard.
- Hugging Face Inference as a full chat provider in v3 (keep HF as GGUF download path unless trivial).

### 6.4 Technical design

**Provider:**

- Add `src/lib/providers/gemini.ts` implementing `Provider` (`testConnection`, `getModels`, streaming `chat`) against Google AI Studio / Gemini API.
- Wire into `getProviderByName()` in `src/lib/providers/index.ts`.
- Add `"gemini"` to `PROVIDERS` in `src/app/api/providers/route.ts` and Settings `ProvidersSection`.
- Store key in `api_keys` via existing encrypt helpers.

**Selection:**

- Keep `settings.provider` + `settings.active_model` but treat them as one atomic pair in all setters (API + UI).
- Extend routing rules table / persona fields: `provider` nullable + `model_name`; `resolveRoutedModel` in `src/lib/agent/routing.ts` returns `{ provider, model }` and engine calls `getProviderByName(provider)`.
- Conversation override: `conversations.model_provider` + `conversations.model_name` (nullable); engine prefers conversation → routing/persona → settings.

**Models UI:**

- Refactor `src/app/models/page.tsx`: tabs or sections for **Local** (Ollama, LM Studio) and **Cloud** (Anthropic, OpenAI, Groq, OpenRouter, Gemini).
- Each cloud section: “Connect” if no key → list models from `getModels()` → Activate sets both provider and model.
- Curated shortcuts optional (e.g. flagship Claude / GPT / Gemini) but live list is source of truth when the API responds.

**Chat UX:**

- Header badge opens a compact picker: provider select → model select → applies to this conversation (clear = inherit default).

### 6.5 Acceptance criteria
- [ ] User saves a Gemini API key, tests connection, lists models, activates one; chat uses Gemini.
- [ ] `/models` shows models for every provider with a valid key (or local daemon up).
- [ ] Activating a cloud model never leaves `settings.provider` on `ollama` with a Claude model id.
- [ ] Per-chat override changes provider+model for that conversation only.
- [ ] Routing rule with provider+model is honored by the engine.
- [ ] Keys remain AES-256-GCM; provider POST stays owner-gated.
- [ ] Tests: gemini provider (mocked HTTP); routing resolve pair; settings atomic update.

### 6.6 Effort
~3–4 days.

---

## 7. Feature F — Self-extension (capabilities LocalMind lacks)

### 7.1 Problem
The vision says: if Sora lacks a capability, it should be able to **build or add it** so the user is unblocked. Today that is possible via MCP install, plugins, and Gate-2 coding PRs — but it is under-documented in-product and easy to misunderstand as “hot-patch the running app.”

### 7.2 Goal
Make self-extension a **clear product pillar** with safe paths only:

| Path | When to use | Mechanism |
|---|---|---|
| **Install MCP** | External tool server already exists | `install_mcp_server` (confirm-gated) |
| **Plugin marketplace** | Template / MCP / prompt pack | `/plugins` + `src/lib/plugins/*` |
| **Build it** | New first-class behavior in LocalMind | Ops proposal → Approve → coding session / PR (Gate 2); **human merges** |

Success criterion: user can gain a new capability **without waiting for a LocalMind release**, via MCP/plugin, or via a PR they merge.

### 7.3 Non-goals / guardrails
- ❌ No runtime generation + hot-load of arbitrary new `BUILTIN[]` tools without MCP or a code deploy.
- ❌ No auto-merge to main; no unsupervised rewrite of LocalMind source while serving traffic.
- ❌ Do not weaken confirm floors on `install_mcp_server`.

### 7.4 Small polish in scope for v3
- System prompt block: when the user asks for a missing capability, Sora should prefer (1) search plugins/MCP, (2) propose install, (3) file an Ops improvement proposal — in that order.
- Plugins page empty-state copy points at “ask Sora to install an MCP.”
- Optional: one curated plugin entry for a common MCP (e.g. docs or calendar beyond Mac) — only if license/local-first OK.

### 7.5 Acceptance criteria
- [ ] Prompt/docs steer Sora to MCP → plugin → Gate-2 proposal (not “patch yourself”).
- [ ] `install_mcp_server` still confirm-gated and audited.
- [ ] Gate-2 path still ends in branch/PR only (covered by Feature A).

### 7.6 Effort
~0.5–1 day (prompt + copy); no new unsafe runtime.

---

## 8. Cross-cutting invariants

1. **Local-first defaults.** Cloud providers, you.com, Telegram, etc. stay opt-in and labeled. Never send Brain / user-context graph / private repos to a cloud API unless the user chose a cloud **model** or an explicit cloud tool for that turn.
2. **Audit.** Every tool call (including new presentation, workflow, workspace-relay) appends to the audit hash chain.
3. **Web-guard.** All scraping / page monitors / research go through `web-guard.ts`. Sensitive domains stay blind unless explicitly granted.
4. **Permission guard.** Server-side; UI never the only gate. Confirm floors for browser, outbound email, MCP install, workspace relay grant.
5. **Migrations.** Additive set-based migrations in `src/lib/db/migrations.ts`; grant new tools to Sora explicitly.
6. **Tests.** Each feature ships with unit tests under `__tests__/`; mock network/peer transports.
7. **Extend, don’t fork.** No second scheduler, provider map, or key vault.

---

## 9. Suggested build order

Dependency-aware; implement in this sequence unless blocked:

1. **E — Frontier models / Gemini / unified picker / per-chat override**  
   Unblocks better coding and research quality immediately; low coupling.
2. **C — Automation: `page_content_change`, templates, `manage_workflow`, reminder paths**  
   High user-visible personal-assistant value; builds on stable scheduler.
3. **A — Coding polish** (discard, main-guard, Gate-2 messaging, tests)  
   Stabilizes the coding pillar before mesh splits it.
4. **D — Mesh compute + workspace pins**  
   Depends on A (sessions) and existing fleet relay patterns.
5. **B — Presentations**  
   Greenfield; parallelizable after E if staffing allows, but ordered here to keep mesh/coding focus first.
6. **F — Self-extension prompt/copy polish**  
   Can land anytime after A’s Gate-2 path is solid; trivial alone.

**Explicit follow-ups (out of v3 scope):**
- Embed code-server in the coding window
- True cross-mesh token streaming
- WAN mesh
- Unipile / MindStudio
- Context Graph GraphQL phase / `user_context` tool (still Sora v2 follow-ups)

---

## 10. Open questions

Resolved defaults (implementers should not block):

| Topic | Decision in this PRD |
|---|---|
| Deck PPTX library | **`pptxgenjs`** |
| PDF export | Local HTML → print/PDF via Chromium/Playwright helper |
| Per-chat model override | **In v1** (chat header picker) |
| Mesh | **LAN only** |
| Email automation | **macOS Mail + email-digest**; not Unipile |

Remaining owner calls (non-blocking for start):

1. Should `/presentations` sit in the **Work** rail cluster or only ⌘K until usage is proven? Default: **⌘K + link from chat tool results**; add rail if crowded nav allows.
2. Default workspace relay: **off until peer grants** (recommended) vs on for all paired peers.

---

## 11. What NOT to do (global guardrails)

- ❌ Don’t fork a new workflow engine or scraper service.
- ❌ Don’t auto-merge Sora’s self-improve PRs or hot-patch the running app.
- ❌ Don’t claim WAN mesh or live token-streaming across peers in v3.
- ❌ Don’t add MindStudio/Unipile in this PRD’s implementation pass.
- ❌ Don’t leave provider/model mismatched (Claude id on Ollama provider).
- ❌ Don’t bypass web-guard for page monitors “because it’s automation.”
- ❌ Don’t sync full git repos across the mesh — RPC allowlisted ops only.

---

## 12. Effort rollup

| Feature | Effort |
|---|---|
| A Coding polish | 2–3 days |
| B Presentations | 4–5 days |
| C Workflow automation | 4–5 days |
| D Mesh pins | 5–7 days |
| E Frontier models | 3–4 days |
| F Self-extension polish | 0.5–1 day |
| **Total** | **~19–25 days** |

Ship incrementally in build-order slices; each slice should leave `main` releasable with tests green.
