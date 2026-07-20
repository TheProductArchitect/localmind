# LocalMind / Sora v2 — Product Requirements Document

> **Status:** Draft for implementation
> **Audience:** An engineering LLM (and human reviewers) building these features into the existing LocalMind codebase.
> **Author:** Generated from a full read of the current codebase + research on the proposed external tools.
> **Scope:** Seven feature areas requested by the owner, plus cross-cutting dependency management.

---

## 0. Context — what LocalMind is today (so you build *with* the grain)

LocalMind is a **local-first AI control panel for Mac** (Next.js 15 App Router, React 19, Tailwind/Radix, Node ≥20.19). The assistant persona is **Sora**. Everything runs on the user's machine unless they explicitly choose a cloud model provider.

Architecture you must respect and reuse:

| Layer | Reality in the repo |
|---|---|
| **Agent engine** | `src/lib/agent/engine.ts` — streaming SSE tool-calling loop (max 12 iterations, 25 tool calls), subagents, confirmations, audit. |
| **System prompt** | `src/lib/agent/assemble-system-prompt.ts` — composable blocks (`identity`, `permissions`, `tools`, `memory`, `date_context`) stored per-persona in SQLite. |
| **Tools** | `src/lib/tools/*` — built-ins registered in `BUILTIN[]` in `src/lib/tools/index.ts` (incl. `spawn_agents`, `schedule_task`, …). Contract in `src/lib/tools/types.ts`: `{ definition, actionType, execute, classify?, preview?, cacheable?, forcedTier?, version? }`. |
| **Providers** | `src/lib/providers/*` — `getProviderByName()`; Ollama (default), Anthropic, OpenAI, Groq, OpenRouter, LM Studio, HuggingFace. |
| **Databases** | `better-sqlite3`, three files in `~/.localmind/`: `config.db`, `conversations.db`, `knowledge.db`. Migrations in `src/lib/db/migrations.ts`. |
| **Process tracking** | `src/lib/db/agent-processes.ts` — `agent_processes` table (`process_id, process_type, status, current_step, ...`) + `/api/orchestration/processes`. Already surfaced in `/work` (timeline) and `/orchestration` (control + trace). |
| **Scheduling** | `worker.js` (PM2) ticks every 5s; `scheduled_tasks`, `monitors`, `workflows` tables in `src/lib/db/automations.ts`; cron matcher in `src/lib/cron.ts` incl. `nlToCron()`. Internal routes `/api/internal/*` gated by loopback + `LOCALMIND_INTERNAL_TOKEN`. |
| **RAG / embeddings** | `src/lib/knowledge/embeddings.ts` — local Ollama `nomic-embed-text`; `src/lib/db/vec.ts` sqlite-vec (native or JS cosine fallback); `semanticSearch()` in `src/lib/knowledge/search.ts`. |
| **Memory** | User memory (`config.db`, `memory` tool) + agent lessons (`agent_memory` table, `agent_memory` tool). **No `memory.md` file exists today.** |
| **Web guard** | `src/lib/agent/web-guard.ts` — kill switch + per-site grants + sensitive-domain blindness, enforced in tool code. |
| **Browse** | `/browse` → Electron `AppBrowser` (`src/components/browse/app-browser.tsx`) with real Chromium tabs + `BrowseSoraPanel` (`src/components/browse/sora-panel.tsx`) side chat; per-tab "Grant Sora" over CDP (`app-bridge.ts`). Web build falls back to reader mode. |
| **Channels** | Telegram, Twilio SMS/voice already exist under `src/lib/channels/`. |
| **Security invariants** | Every tool call is audited (append-only hash chain); API keys AES-256-GCM; permission guard is server-side; web tools respect kill switch/grants. **Do not weaken these.** |

**Guiding principle for every feature below:** extend existing subsystems, do not fork them. New capabilities become **tools**, **providers**, **worker jobs**, **DB tables + migrations**, and **pages/components** — the same shapes already in the repo.

---

## 1. Priority summary & my recommendations (read this first)

| # | Feature | Verdict | Notes |
|---|---|---|---|
| A | **Agent Ops dashboard (Kanban)** | ✅ Build | High value, low risk. Extends `agent_processes` + `/work`. |
| B | **Hide/summon Sora on Browse** | ✅ Build (small) | Trivial UX addition to `app-browser.tsx`. Do first. |
| C1 | **you.com** search/research | ✅ Build | Clean fit as a `web_search`/`web_research` backend or MCP. Local-first stays intact (it's just a search API). |
| C2 | **Obsidian-compatible markdown brain** | ✅ Build | Aligns with local-first. Make the brain a plain-markdown vault. |
| C3 | ~~gbrain~~ **(dropped)** | ❌ Not used | Owner decision: no dependency on gbrain. A few of its *ideas* (markdown-git brain, entity graph, overnight consolidation) are implemented natively — see §4.0/§4.3. |
| C4 | **Unipile** (messaging/email/LinkedIn) | ✅ Build behind opt-in | Cloud service → data leaves machine. Gate like a cloud provider; powers the "communicate" pillar. |
| C5 | **MindStudio SDK** (many models) | ⚠️ Optional cloud provider only | Hosted model router = data leaves machine. Add as an explicitly-flagged cloud provider, never default. |
| D | **Sora schedules cron jobs via a tool** | ✅ Shipped | `schedule_task` in `src/lib/tools/schedule.ts`; granted to Sora (migrations v27+). |
| E | **Dependency auto-update** | ✅ Build (PR-gated) | Renovate + CI. **Never auto-merge majors.** See §8. |
| F | **Five pillars (ideate/research/execute/coordinate/communicate)** | ✅ Frame + fill gaps | Mostly a mapping over existing tools; only "ideate" and "communicate" need new surface. |
| G | **Idle self-improvement + `memory.md` + efficient local RAG** | ⚠️ Build carefully | Idle "consolidation cycle" + retrieval broker = yes. **Self-improvement is two-gate: Sora only proposes to the Kanban; it builds a branch/PR *only after the owner approves*, and never hot-patches or merges into the running app.** See §7. |
| H | **User Context Graph (the user's goals/needs/people/prefs) + GraphQL where it fits** | ✅ Build (scoped GraphQL) | A user-rooted graph of *what the user wants & needs* (not agent activity), assembled from goals/memory/notes/brain, that the user can steer and Sora retrieves from. **GraphQL is a narrow read-mostly traversal layer over it — not an app-wide REST replacement.** See §12. |

Two hard pushbacks up front:

1. **Do not dump whole files (memory.md, brain) into the model.** The owner explicitly asked for "only what's needed." This is a *retrieval budget* problem — solved by a **Context Broker** (§7.3) over the existing local embeddings, not by prompt-stuffing.
2. **Do not let Sora rewrite and run its own source unsupervised.** "Improve itself" is a **two-gate** flow: (1) during idle, Sora only writes an *improvement proposal card* to the Kanban — no code, no branch; (2) **only after the owner approves the card** does Sora build it into a branch/PR. It never merges or hot-patches the running app; final merge is always human. See §7.2.

---

## 2. Feature A — Agent Ops Dashboard (Kanban)

### 2.1 Problem
Today `/work` is a flat reverse-chronological timeline and `/orchestration` is a control panel with a trace side-panel. Neither gives an at-a-glance "what is every agent doing right now, and what's stuck waiting on me" board. The owner wants a **Kanban purview**.

### 2.2 Goal
A single board at **`/ops`** (add to the Work cluster) that shows every unit of agent work as a card flowing through lanes, updating live, with inline controls (pause/resume/cancel/approve) and drill-in to the existing trace.

### 2.3 Non-goals
- Not a replacement for `/orchestration` (keep it as the deep-control page) or `/graphs` (DAG view).
- No drag-to-reprioritize in v1 (status is system-driven, not user-dragged). Revisit later.

### 2.4 Data model — reuse, don't reinvent
The `agent_processes` table already has the right shape. Lanes map from `status`:

| Lane | Sourced from |
|---|---|
| **Proposals** | Sora's self-improvement proposal cards (`improvement_proposals` where `status = proposed`) — the owner-approval gate for Feature G (§7.2). Approving a card here is what authorizes Sora to build. |
| **Queued** | `status = pending`; long-running jobs not yet picked up; scheduled tasks whose next fire is imminent. |
| **Running** | `status = running`. |
| **Needs you** | `status IN (waiting_confirmation, paused)` **plus** pending workflow approvals (`listPendingWorkflowApprovals()`) **plus** loop-suspended conversations **plus** built proposals awaiting merge review (`improvement_proposals.status = ready_for_review`). |
| **Done** | `status = completed` (last 24h). |
| **Failed** | `status IN (failed, cancelled)` (last 24h). |

> The **Proposals** lane is the concrete surface for the owner's requirement that Sora "write to the Kanban and only build when approved." Cards there have **Approve** / **Reject** actions (owner-only); Approve enqueues the build job — see §7.2.

Add columns to `agent_processes` via a migration in `src/lib/db/migrations.ts`:
- `pillar TEXT` — one of `ideate|research|execute|coordinate|communicate|maintain` (see §6). Nullable; back-fill `null`.
- `parent_process_id TEXT` — link subagents to their spawner so the board can nest/group.
- `progress REAL` — 0..1 optional, for a progress bar (jobs already track `current_iteration/max_iterations`).

`startProcess()` / `updateProcess()` in `src/lib/db/agent-processes.ts` gain optional `pillar`, `parent_process_id`, `progress`.

### 2.5 API
- **Reuse** `GET /api/orchestration/processes` (+ `?history=1`). Extend response to include the new columns and to also fold in: long-running jobs (`/api/jobs`), pending workflow approvals, and scheduled tasks due within the next tick — so the board is one fetch. Add `?board=1` to return pre-bucketed lanes:
  ```json
  { "lanes": { "queued": [...], "running": [...], "needs_you": [...], "done": [...], "failed": [...] }, "counts": {...} }
  ```
- Live updates: reuse the existing per-process SSE at `/api/orchestration/processes/[id]/trace/stream` for the open card, and add a lightweight board-level stream `GET /api/ops/stream` (SSE) that emits `process_upsert` events off the `agent_processes` writes. If a board stream is too much for v1, **poll every 1.5s** exactly like `/orchestration` already does (`setInterval(refresh, 1500)`).

### 2.6 UX / workflow
- New page `src/app/ops/page.tsx`; add nav entry in `src/components/rail.tsx` under Work (or a top-level "Ops"), and a `⌘K` command in `src/components/command-palette.tsx` ("Agent Ops board").
- Five columns, horizontally scrollable on narrow screens. Each **card** shows: pillar icon + color, `display_name`, `agent_name`/persona, `current_step`, elapsed time (live), model badge, and a status pill reusing the `STATUS_TONE` map already in `/orchestration`.
- Card actions inline: **View** (opens the existing trace side-panel component — extract it from `orchestration/page.tsx` into `src/components/ops/trace-panel.tsx` and share), **Pause/Resume/Cancel** (existing endpoints), **Approve/Deny** for `needs_you` (reuse `/api/chat/confirm` and workflow approval endpoints).
- **Grouping toggle:** "Group by pillar" vs "Group by status (Kanban)". Subagents nest under their parent via `parent_process_id` (collapsible).
- **Filters:** by pillar, by persona/agent, by owner (multi-user installs). Persist filter in `localStorage`.
- Empty states mirror the friendly copy already used in `/work` and `/orchestration`.

### 2.7 Acceptance criteria
- [ ] Starting a chat, a scheduled task, a long-running job, and a subagent each appear as a card in the correct lane within 2s.
- [ ] A tool awaiting confirmation lands in **Needs you** and can be approved from the card, unblocking the run.
- [ ] Pause/Resume/Cancel from a card mutate the process and reflect within one refresh.
- [ ] Board survives 100+ active processes without jank (virtualize lanes if needed).
- [ ] No new data leaves the machine; all endpoints stay behind existing auth (`route-map.ts` → `authenticated`).

### 2.8 Effort
~2–3 days. Mostly UI + one migration + one aggregation endpoint. Reuses all control endpoints.

---

## 3. Feature B — Hide / Summon Sora on the Browse view

### 3.1 Problem
In `AppBrowser` the Sora side panel is **always rendered** (`<div className="w-[min(380px,32vw)] shrink-0 hidden md:flex ...">`). It permanently eats ~380px. The owner wants to hide it and re-summon Sora on demand.

### 3.2 Goal
A collapsible Sora panel with a persistent, unobtrusive **"Ask Sora"** affordance to bring it back.

### 3.3 Technical design (small, self-contained in `app-browser.tsx`)
- Add state `const [soraOpen, setSoraOpen] = useState(true)` persisted to `localStorage` (`lm-browse-sora-open`).
- When open: render the panel as today, with a header **collapse** control (chevron/`PanelRightClose` icon) that sets `soraOpen=false`.
- When closed: the panel collapses to zero width. Show a floating pill button anchored bottom-right of the browser content area — the Sora orb + "Ask Sora" — that sets `soraOpen=true`. Reuse the existing `Orb` component (`src/components/orb.tsx`) for brand consistency.
- **Preserve conversation state** across hide/show: keep `<BrowseSoraPanel>` mounted but visually collapsed (e.g. `w-0 overflow-hidden`) rather than unmounting, so the conversation and grant context survive. (Simplest correct approach; avoids re-creating the conversation on every summon.)
- Call `syncBounds()` after toggling so the native `WebContentsView` reclaims/relinquishes the width via `lm.setBounds`.
- The green "Sora can see and act on this tab" grant strip stays chrome-drawn and visible even when the panel is hidden (security signal must never hide with the panel).

### 3.4 Acceptance criteria
- [ ] Panel hides/shows via header control and floating button; state persists across app restarts.
- [ ] Native browser view resizes to fill reclaimed space when hidden.
- [ ] Conversation history and any active tab grant survive hide→show.
- [ ] Keyboard shortcut (e.g. `⌘/`) toggles the panel.

### 3.5 Effort
~half a day. **Recommend shipping this first** as a warm-up.

---

## 4. Feature C — Brain enrichment: you.com + Unipile + Obsidian + MindStudio

This is the ambiguous cluster. I'm decomposing it into independent, individually-shippable integrations, each gated and optional, unified by one concept: **the Brain**.

> **Owner decision:** gbrain is **not** a dependency. LocalMind builds its own brain natively. A few of gbrain's *ideas* (markdown-git brain, zero-LLM entity graph, overnight consolidation) are worth borrowing conceptually — those are captured in §4.0 and §4.3 — but no gbrain code, npm package, MCP wiring, or Bun runtime is introduced.
>
> **Nothing breaks by dropping it.** gbrain was never wired into the codebase — it appears *only* in this PRD, never in `package.json`, the lockfile, or any source file. Dropping it is a **design decision with zero code-removal work**; there is no import, install step, or runtime to unwind. Every feature that references "the Brain" resolves to the **native Brain foundation (§4.3.1)**, which is built entirely from components already in the repo. The dependency/impact matrix in §4.3.2 confirms no workflow depends on gbrain.

### 4.0 The unifying concept — "the Brain"
LocalMind already has the pieces of a personal brain scattered across three stores (knowledge base, user memory, agent lessons). The owner's references (Obsidian, "visualize", "enrich") point at **consolidating these into one coherent, human-inspectable, graph-aware brain** that Sora reads via retrieval and enriches over time.

Design the Brain as:
- **Source of truth:** plain **Markdown files** in `~/.localmind/brain/` (people, companies, topics, meetings, ideas — one file per entity), optionally a git repo (`git init` on first use) so the owner can `git diff` what Sora learned. This is the Obsidian/plain-text-ownership insight and it's genuinely good.
- **Index:** the existing `knowledge.db` + sqlite-vec for embeddings, plus a new lightweight **entity graph** table (`brain_edges`) for typed relationships (`works_at`, `mentioned_in`, `related_to`).
- **Retrieval:** the Context Broker (§7.3).
- **Visualization:** the existing `src/components/note-graph.tsx` (d3) pointed at `brain_edges`; and **Obsidian compatibility** so power users open `~/.localmind/brain/` as a vault.

Everything below plugs into this Brain.

### 4.1 you.com — search & research backend ✅
**What it is:** LLM-ready web search API (`https://api.you.com/v1/search`), `livecrawl` full-page Markdown, and a Research API for multi-source synthesis. Also available as an MCP server (`https://api.you.com/mcp`).

**Recommendation:** Add you.com as a **selectable backend** for the existing `web_search` and `web_research` tools, alongside Brave/DDG. It slots in cleanly and improves quality.

**Technical design:**
- Add a setting `web_search_provider: "brave" | "you" | "duckduckgo"` (config.db settings) and store the you.com key encrypted via `src/lib/db/apikeys.ts` (like other providers).
- In `src/lib/tools/websearch.ts`, add a `you` branch before the Brave branch:
  ```
  POST https://api.you.com/v1/search { query, count, freshness?, livecrawl?, livecrawl_formats:["markdown"] }
  Authorization: Bearer <key>
  ```
  Map results to the existing `- title\n  url\n  description` output shape. **Keep `checkWebAccess()` (web guard) as the first gate** — do not bypass it.
- For `web_research` (`src/lib/tools/web-research.ts`), optionally call you.com Research API for "deep" queries; otherwise keep routing page reads through the Secure Browser so the sensitive-domain gate still applies. Livecrawl content must still pass the prompt-injection scan before hitting the model.
- Alternative/además: register you.com's hosted MCP as an optional MCP server via the existing MCP plumbing (`install_mcp_server`), so users can wire the free profile with no key. Prefer the native tool path for the guard integration.

**Pushback:** none material. It's a search API; local-first is preserved because only the query leaves the machine (same as Brave today). Just make it opt-in and keyed.

### 4.2 Obsidian — the brain as a vault ✅
**What it is:** Obsidian reads a folder of Markdown with `[[wikilinks]]` and shows a graph. LocalMind already writes Markdown and already has a d3 note-graph.

**Recommendation:** Don't build an Obsidian *plugin*. Instead:
- Make `~/.localmind/brain/` a **valid Obsidian vault** (plain `.md`, `[[wikilink]]` entity references, YAML front-matter for metadata/edges).
- Add a Settings toggle **"Open brain in Obsidian"** that deep-links `obsidian://open?vault=...` (best-effort; if Obsidian isn't installed, just reveal the folder in Finder).
- Optional **two-way sync**: watch the vault folder (chokidar-style via `fs.watch`) and re-embed changed files into `knowledge.db` (reuse the embedding job queue → `/api/internal/process-jobs`). Writes by Sora go through the `filesystem`/`knowledge` tools into the vault, which triggers re-index.
- Visualize natively in-app via `note-graph.tsx` fed by `brain_edges`, so users who don't have Obsidian still get the graph.

**Pushback:** "visualize" is 80% already built (`note-graph.tsx` + `d3`). Point it at the entity graph rather than adding a heavy dependency.

### 4.3 Native brain patterns (gbrain dropped — build these ourselves) ✅
Per owner decision, **gbrain is not a dependency** — no npm package, no MCP wiring, no Bun runtime, nothing vendored. Instead, implement the three genuinely valuable ideas directly on LocalMind's existing Node/SQLite stack, so there is one runtime, one dependency surface, and the existing security model is untouched:

1. **Entity-graph write path (zero-LLM):** when Sora writes a brain note (via the `filesystem`/`knowledge` tools into `~/.localmind/brain/`), run a cheap regex/NER pass to extract `[[entity]]` references and upsert typed edges into the `brain_edges` table (§4.0). No model calls — pure parsing. This is what powers the note graph and the User Context Graph (§4.2, §12).
2. **Synthesis retrieval:** the Context Broker (§7.3) returns *synthesized, cited* context (top-k chunks → short synthesis via a small local model) rather than raw chunks, with an explicit "what the brain doesn't know yet" gap note.
3. **Overnight consolidation ("dream cycle"):** an idle worker job (§7.1) that dedupes entities, fixes broken `[[links]]`, summarizes long notes, and retires stale lessons.

**Do NOT** introduce gbrain in any form. These patterns are built with the tools already in the repo (`filesystem`, `knowledge`, `embeddings`, `vec`, the worker, and the new `brain_edges` table).

### 4.3.1 The native Brain — self-contained component spec (the foundation everything else rests on)
Because §4.2 (Obsidian view), §7.1 (idle consolidation), §7.3 (Context Broker), and §12 (User Context Graph) all build on "the Brain," here is the **complete, native, buildable definition** so none of them is left depending on anything external. Every component below already exists in the repo or is a small, well-scoped addition — **no gbrain, no Bun, no new runtime.**

| # | Component | Built from (existing) | New work | Owner feature |
|---|---|---|---|---|
| 1 | **Markdown store** `~/.localmind/brain/` (one `.md` per entity, YAML front-matter, `[[wikilinks]]`) | `filesystem` tool (already sandboxes `~/.localmind`), macOS FS | create dir on first use; optional `git init` for `git diff` history | §4.0 |
| 2 | **`brain_edges` table** (typed relationships) | `better-sqlite3`, `src/lib/db/migrations.ts` | one migration + a `src/lib/db/brain.ts` accessor | §4.0, §12 |
| 3 | **Zero-LLM entity/edge extraction** on note write | plain regex over `[[refs]]` (exactly what `/api/knowledge/notes/graph` already does for notes) + optional front-matter edges | a write hook in the `knowledge`/`filesystem` tools that upserts edges | §4.3 |
| 4 | **Embedding + index** | `embed()` (Ollama `nomic-embed-text`) + `knowledge.db` + `src/lib/db/vec.ts` (sqlite-vec) — **all already local and working** | point the existing embedding job queue at brain files | existing |
| 5 | **Retrieval / synthesis** | `semanticSearch()` (already exists) | the Context Broker wraps it (§7.3) | §7.3 |
| 6 | **Consolidation ("dream cycle")** | the PM2 `worker.js` + `/api/internal/*` pattern (already exists) | one idle job (§7.1) | §7.1 |
| 7 | **Visualization** | `src/components/note-graph.tsx` + `d3` (already in `package.json`) | generalize into `force-graph.tsx` | §4.2, §12 |

**`brain_edges` schema (the one genuinely new table):**
```sql
CREATE TABLE brain_edges (
  id TEXT PRIMARY KEY,
  src_entity TEXT NOT NULL,          -- slug/filename of source note (or 'user' root)
  dst_entity TEXT NOT NULL,          -- slug/filename of target note
  edge_type TEXT NOT NULL,           -- works_at | mentioned_in | related_to | wants | needs | ...
  source TEXT NOT NULL DEFAULT 'inferred',  -- stated | inferred | imported
  weight REAL NOT NULL DEFAULT 1.0,
  created_at INTEGER NOT NULL,
  UNIQUE(src_entity, dst_entity, edge_type)
);
CREATE INDEX idx_brain_edges_src ON brain_edges(src_entity);
CREATE INDEX idx_brain_edges_dst ON brain_edges(dst_entity);
```

**Build order for the Brain foundation (so downstream features never dangle):** 1 → 2 → 3 (store + edges + extraction) must land first; 4–5 (index + retrieval) reuse existing code and light up immediately; 6–7 (consolidation + viz) are additive. Only after 1–3 exist should §12's GraphQL layer be built.

**Backwards compatibility:** the Brain is *additive* to the three existing stores (user `memory`, `agent_memory`, `knowledge`). It does not replace or migrate them — it links them. Existing `memory`/`notes`/`goals` continue to work unchanged; the Brain adds an entity/edge layer on top and (per §12.4) bridges to `goals`/`memory` by stable `ref` id so edits stay in sync.

### 4.3.2 Dependency / impact matrix — proof no workflow depends on gbrain
| Feature / workflow | Did it ever need gbrain? | Native path now | Breaks if gbrain absent? |
|---|---|---|---|
| C2 Obsidian vault + in-app graph | No — vault is plain markdown + d3 | §4.2 + Brain foundation §4.3.1 | **No** |
| C3 entity graph / synthesis / consolidation | Borrowed *ideas* only | §4.3 built natively | **No** |
| C1 you.com, C4 Unipile, C5 MindStudio | Never related to gbrain | unchanged | **No** |
| A Ops Kanban | Independent (agent processes) | §2 | **No** |
| D `schedule_task` | Independent | §5 | **No** |
| F Pillars / Ideate | Independent | §6 | **No** |
| G.1 idle consolidation | Borrowed "dream cycle" idea | §7.1 native worker job | **No** |
| G.3 Context Broker + `memory.md` | Borrowed "cited synthesis" idea | §7.3 over existing local embeddings | **No** |
| H User Context Graph | Reuses the Brain store | §12 on Brain foundation §4.3.1 | **No** |
| E Dependency updates | Independent | §8 | **No** |

Every row resolves to code that exists or is specified natively above. **There is no feature whose workflow is blocked, broken, or left ambiguous by removing gbrain.**

### 4.4 Unipile — the "communicate" data plane ⚠️ opt-in
**What it is:** one REST API (`https://api.unipile.com/api/v1/...`, Bearer auth) unifying LinkedIn, WhatsApp, Instagram, Telegram, Gmail/Outlook/IMAP, and Google/Outlook calendars. Webhooks for realtime. Has an SDK.

**Recommendation:** Add Unipile as an **optional channel + tool** that powers Sora's outbound/inbound communication and feeds the Brain.
- **New tool** `communicate` (`src/lib/tools/communicate.ts`) with operations: `list_chats`, `read_thread`, `send_message`, `list_emails`, `send_email`, `create_event`. Register in `BUILTIN[]`. Every send is a **gated action** (permission guard tier `ask`/`pin`, audited) — never auto-send without the existing confirmation flow.
- **Channel adapter** under `src/lib/channels/unipile.ts` mirroring the Telegram/Twilio pattern, with a **webhook route** `POST /api/channels/unipile/webhook` (public in `route-map.ts`, but HMAC-verified) so inbound messages can trigger Sora and the YES/NO approval replies keep working.
- **Enrichment:** inbound messages/emails and contacts optionally create/update Brain entity notes (people/companies), which is exactly the "enrich" the owner wants.
- Store the Unipile key + `dsn` encrypted; add a Settings → Channels → Unipile connect flow (Unipile provides hosted auth links, so we just open them).

**Pushback:** Unipile is a **cloud relay — data leaves the machine**, which conflicts with local-first. Make it **explicitly opt-in**, clearly labeled in Settings as "Cloud service — messages transit Unipile," disabled by default, and covered by the web-guard kill switch semantics (a global off switch). Do not enable LinkedIn automation that risks the owner's account without a clear consent screen.

### 4.5 MindStudio SDK — optional cloud model router ⚠️
**What it is:** `@mindstudio-ai/agent` (npm) — one API key → 200+ models (text/image/video/audio) + 850+ connector actions + its own MCP server.

**Recommendation:** Add MindStudio as **one more provider** in `src/lib/providers/` (`mindstudio.ts`) implementing the `Provider` interface (`chat()`, `getModels()`, `testConnection()`), wired in `getProviderByName()`. Surface its models in the Models page. Optionally expose its media-generation actions (image/video/TTS) as a separate opt-in tool later.

**Pushback:** It's a **hosted router → prompts leave the machine** and it's a young package (first published Feb 2026, rapid 0.1.x releases). So:
- Never make it the default provider; Ollama stays default.
- Flag it in the UI as "Cloud — runs on MindStudio's routers."
- Pin the version and let Renovate (§8) propose upgrades behind CI.
- Treat it as **breadth of models**, not as an orchestration layer (LocalMind already has orchestration; don't duplicate it).

### 4.6 Feature C acceptance criteria
- [ ] `web_search`/`web_research` can be switched to you.com in Settings; results pass through the web guard; injection scan still runs on crawled content.
- [ ] `~/.localmind/brain/` opens cleanly as an Obsidian vault; in-app graph renders entities/edges; edits re-embed within one worker tick.
- [ ] The native brain patterns (§4.3) are implemented on the existing stack; **no gbrain dependency, MCP wiring, or Bun runtime is present anywhere in the repo.**
- [ ] Unipile is off by default; connecting requires explicit consent; every send is gated + audited; inbound webhooks are HMAC-verified.
- [ ] MindStudio appears as a clearly-labeled cloud provider; Ollama remains default; switching providers requires no code change.

---

## 5. Feature D — Sora schedules cron jobs via a tool

### 5.1 Status: ✅ shipped

`schedule_task` lives at `src/lib/tools/schedule.ts`, is registered in `BUILTIN[]`, and is on Sora's `enabled_tools` (config migrations v27 / v29 / v31). Recurring creates stay confirmation-gated via the permission guard. See `docs/sora-v2-implementation.md` for the live surface.

Remaining polish (optional): richer Ops-board tagging of scheduled runs; monitors via the same tool.

---

## 6. Feature F — The Five Pillars (ideate · research · execute · coordinate · communicate)

### 6.1 Framing
The owner wants Sora to "ideate, research, execute, coordinate, communicate efficiently." Most of this already exists — this feature is about **naming the capabilities, tagging work by pillar (feeds the Ops board), and filling two gaps.**

| Pillar | Already have | Gap to build |
|---|---|---|
| **Research** | `web_search`, `web_research`, `read_secure_webpage`, knowledge base, (you.com §4.1) | Tag research processes `pillar=research`. |
| **Execute** | `pi_code`, `filesystem`, `mac_automation`, `datastore`, `spreadsheet`, long-running jobs | Tag `pillar=execute`. |
| **Coordinate** | `spawn_agents` (preferred) + triad `spawn_subagent` / `spawn_subagents_sequential` / `spawn_subagents_parallel`, task graphs, orchestration, resource governor, critic | Tag `pillar=coordinate`; expose on Ops board with nesting. |
| **Communicate** | Telegram, Twilio, email | Unipile (§4.4) for LinkedIn/WhatsApp/unified inbox; tag `pillar=communicate`. |
| **Ideate** | — (no dedicated surface) | **New:** an ideation/planning mode (below). |

### 6.2 The one genuinely new pillar — Ideate
Add a lightweight **Ideate mode** (not a new engine): a persona/system-prompt block that puts Sora in divergent→convergent brainstorming — generate options, pressure-test them (optionally via a `spawn_subagents_parallel` "red team"), and converge to a plan — then write the chosen plan into the Brain as an `idea` note (§4.0) and optionally spin up a task graph or scheduled tasks to execute it.
- Implement as a **persona** ("Strategist") + a system-prompt block, reachable via the persona selector and `⌘K`. No engine changes.
- Ideation output is a structured plan (goal, options, chosen approach, next actions) saved as a Brain note and linked to any follow-on `execute`/`coordinate` processes.

### 6.3 Efficiency mechanism (the "efficiently" ask)
"Efficiently" = don't over-spawn and don't over-stuff context.
- **Over-spawn** is already guarded (resource governor caps parallelism at 16; loop guard). Keep.
- **Over-stuff** is the Context Broker (§7.3): pillars pull only the retrieval slices they need (research pulls web + relevant brain notes; execute pulls the target files; communicate pulls the relevant person/thread notes).

### 6.4 Technical touchpoints
- `startProcess()` sets `pillar` based on the entry point (chat classification via existing routing heuristics in `routing.ts`; scheduled task carries its pillar; subagent inherits or sets its own).
- Add pillar → icon/color map shared by Ops board and orchestration.
- New "Strategist" persona seeded in `src/lib/default-*` and editable in `/agents`.

### 6.5 Acceptance criteria
- [ ] Every process is tagged with a pillar (or `null` if genuinely unclassifiable) and filterable on the Ops board.
- [ ] Ideate mode produces a saved plan note and can hand off to execute/coordinate.
- [ ] No regression in spawn limits or loop guarding.

---

## 7. Feature G — Idle self-improvement, `memory.md`, and efficient local RAG

This is the most powerful and the most dangerous request. Split into three deliverables with strict guardrails.

### 7.1 Idle detection + the Consolidation ("dream") cycle
**Goal:** when the machine is idle, Sora does useful upkeep — run tests, consolidate memory, enrich the Brain, propose improvements — without burning resources or touching production code unsafely.

**Design:**
- **Idle signal:** a new worker responsibility. In `worker.js` (or a new `/api/internal/idle-tick`), consider the system idle when: no active `agent_processes` (`listActive()` empty), no chat SSE session open (`sse-hub`), and system load is low (reuse `check_resources`/`resource-governor` RAM+CPU signals). Add a user setting **"Let Sora work during idle time"** (default **off** — opt-in) and a nightly window (e.g. only 1am–6am, configurable) so it never competes with the user.
- **Job types run during idle** (each a tracked process with `pillar=maintain`, fully audited):
  1. **Test runner:** execute `npm test` (Vitest) in a sandbox (`src/lib/tools/sandbox.ts` Docker path already exists) or as a spawned process with output captured. Record pass/fail into a `self_checks` table; surface on the Ops board. **Read-only w.r.t. the app** — it runs tests, it does not edit code.
  2. **Memory consolidation:** dedupe/merge Brain notes, fix broken `[[links]]`, summarize long notes, retire stale `agent_memory` lessons (the overnight "dream cycle").
  3. **Brain enrichment:** for recently-seen entities, fetch missing facts via you.com (respecting web guard) and append cited additions to their notes.
  4. **Improvement *ideation only* (see 7.2).** During idle, Sora may only *identify* improvements and write proposal cards to the Kanban. It does **not** write code, branches, or diffs until a human approves the card.
- Idle work is **preemptible**: any new user activity cancels the idle process immediately (the engine already supports cancel/abort).

### 7.2 "Improve itself" — approval-gated on the Kanban, then PR, never hot-patch ⚠️ (hard guardrail)
The owner wants Sora to improve itself, **but approval must come first**: Sora writes a proposal to the Kanban and does nothing further until the owner approves; it "only builds when approved," never on its own initiative. This is a strict **two-gate** flow:

**Gate 1 — Propose (idle, no code written).** During idle, Sora analyzes failing tests / TODOs / lint / recurring errors and creates an **improvement proposal card** on the Kanban (Feature A) in a dedicated **"Proposals"** lane. The card contains: title, rationale, the files/areas it would touch, expected benefit, risk/scope estimate, and a plain-English change summary. **No branch, no diff, no code is produced at this stage.** The card sits idle until the owner acts.

**Gate 2 — Build only after approval.** When the owner clicks **Approve** on the card, and *only* then, Sora is authorized to build it: it spawns a `maintain`/`execute` process that uses the existing `pi_code` tool inside an **approved directory / sandbox** to produce a **git branch + diff** (and a PR if a remote is configured). The result is attached back to the card, which moves to "Needs you" for final review. If the owner clicks **Reject** (or ignores it), Sora never touches code.

**Final merge stays human, always.** Approving a proposal authorizes Sora to *build and open a branch/PR* — it does **not** merge, modify the running install, or restart the app. A human reviews the diff, runs CI, and merges; the improvement takes effect only on the next build. There is **no** mode in which LocalMind rewrites and reloads its own running code unsupervised.

**Data model:** a new `improvement_proposals` table (`id, title, rationale, target_paths, status ∈ {proposed, approved, building, ready_for_review, rejected, merged}, created_at, approved_at, branch, pr_url, audit_ref`). The Kanban reads it as its own lane; `POST /api/ops/proposals/[id]/approve` (owner-only in `route-map.ts`) flips `proposed → approved` and enqueues the build job for the worker. Every state transition is audited.

**Rationale (non-negotiable):** LocalMind's security model (audit chain, server-side permission guard) assumes the running code is trusted. An agent self-modifying the live server would break that guarantee. Approval-before-build + human-merge keeps a person in the loop at both the "should we?" and "is the diff safe?" decisions.

**Config:** `LM_SELF_IMPROVE = propose | off` (default **off**). When `off`, Sora doesn't even create proposal cards. There is intentionally **no** `auto-build` or `auto-merge` value.

### 7.3 Efficient local RAG — the Context Broker (the core of "only what's needed")
**Goal:** stop dumping whole files (memory.md, brain, history) into the model. Retrieve only the top-relevant slices, locally.

**Design — a single module `src/lib/agent/context-broker.ts`:**
- On each turn (and for each subagent), before building the prompt, the broker:
  1. Embeds the user query locally (`embed()` in `embeddings.ts`, Ollama `nomic-embed-text` — already local, already there).
  2. Runs `semanticSearch()` across the Brain / knowledge / memory vec index (`src/lib/db/vec.ts`), returning top-k chunks above the 0.5 score threshold.
  3. Applies a **token budget** (e.g. ≤ N% of the model's context window from `settings.context_window`), packing highest-scoring chunks first, deduping near-duplicates by cosine similarity.
  4. Optionally **synthesizes** the retrieved chunks into a short, cited brief via a *small* local model, so the main model gets a dense summary + citations instead of raw chunks — and an explicit "not in memory" note when coverage is thin.
- The existing `memory` builtin block in `assemble-system-prompt.ts` changes from "inject all key/value memory" to "inject the broker's top-k retrieved memory for this turn." Small installs (few memories) still fit fully; large brains get retrieval. This directly implements the owner's "not everything needs a total dump."
- `memory.md`: create a canonical human-readable memory doc at `~/.localmind/brain/memory.md` (git-tracked, Obsidian-visible) that the consolidation cycle keeps current. **It is the human-facing artifact, not the injection source** — the model reads *retrieved slices*, the human reads the whole file. The `agent_memory` tool and consolidation cycle write to it; the broker indexes it.

**Why this satisfies the ask:** local embeddings (already local), retrieval budget (new), synthesized/cited context (new), and a real `memory.md` that stays updated (new) — without ever prompt-stuffing.

### 7.4 Acceptance criteria
- [ ] Idle work only runs when opted-in, in the configured window, and only when genuinely idle; any user activity preempts it within ~1 tick.
- [ ] Test runs are recorded and visible on the Ops board; they never modify app code.
- [ ] Self-improvement is **approval-gated**: idle Sora only creates proposal cards on the Kanban; **no branch/diff/code is produced until the owner approves the card.** Rejected/ignored proposals never touch code.
- [ ] After approval, Sora builds a branch/PR only; it never merges, hot-patches, or restarts the running app. Final merge is human. There is no auto-build or auto-merge mode.
- [ ] The Context Broker keeps injected memory/brain context under the configured token budget; retrieval is 100% local (no network for embeddings).
- [ ] `~/.localmind/brain/memory.md` exists, is git-tracked, and is updated by consolidation; the model is fed retrieved slices, not the whole file.

### 7.5 Effort
Context Broker ~2 days; idle cycle + test runner ~2 days; self-improve proposals ~2 days (mostly guardrails + review UX). Ship the Context Broker first — it's the highest leverage.

---

## 8. Feature E — Dependencies: add new, keep updated (PR-gated)

### 8.1 New dependencies introduced by this PRD
| Package / integration | For | Type | Note |
|---|---|---|---|
| `@mindstudio-ai/agent` | §4.5 provider | npm dep | Pin; cloud; optional. |
| Unipile | §4.4 channel | REST (SDK optional) | Prefer raw `fetch` to avoid another dep; key in apikeys. |
| you.com | §4.1 search | REST | No dep — just `fetch`. |
| `chokidar` (optional) | §4.2 vault watch | devless dep | Only if `fs.watch` proves flaky on macOS. |

Add only what a shipped feature uses; keep the local-first core dependency-light.

### 8.2 Keeping dependencies updated (the "as they release" ask)
Use **Renovate** (preferred over Dependabot for grouping + auto-merge policies), **PR-gated with CI**:
- Add `renovate.json` at repo root:
  - Group minor+patch updates; **separate majors into their own PRs**.
  - **Auto-merge**: allow *patch* and *minor* auto-merge **only if** `npm test` + `next build` + lint pass in CI; **never auto-merge majors** or `next`, `react`, `electron`, `better-sqlite3`, `playwright`, `@mindstudio-ai/agent` (pin these; upgrade deliberately).
  - Schedule weekly (off-hours) to avoid churn.
  - Enable `lockFileMaintenance`.
- Add a CI workflow `.github/workflows/ci.yml` running `npm ci && npm run lint && npm test && npm run build` on PRs so Renovate has a gate. (Repo already has Vitest, ESLint, and a build.)
- **Local mirror of the idle cycle:** a `maintain` idle job may run `npm outdated`/`npm audit` and, if `LM_SELF_IMPROVE=propose`, **write a dependency-bump proposal card to the Kanban** (§7.2 Gate 1). Only after the owner approves the card does Sora open the branch bumping safe deps (Gate 2); merge stays human. This gives the owner the "Sora keeps deps fresh" experience with approval-before-build and no unsafe auto-apply.

**Pushback:** fully automatic dependency upgrades (esp. `next`/`react`/`electron`/native `better-sqlite3`) routinely break builds. Auto-merge is limited to green-CI patch/minor; everything else is a reviewable PR.

### 8.3 Acceptance criteria
- [ ] `renovate.json` + CI workflow present; PRs open automatically; majors never auto-merge; core framework/native pkgs pinned.
- [ ] New integration deps are optional and pinned; local-first core has no new mandatory cloud deps.

---

## 9. Cross-cutting: security, privacy, audit (applies to every feature)
- All new tools are audited via the existing append-only log; no exceptions.
- Cloud integrations (you.com, Unipile, MindStudio) are **opt-in, keyed (AES-256-GCM), clearly labeled cloud, and covered by a global off switch** consistent with the web-guard kill switch.
- New API routes get correct roles in `src/lib/auth/route-map.ts` (`authenticated` for user-facing; `owner` for settings/keys; `/api/internal/*` stays loopback + token). Webhooks are `public` but signature-verified.
- Idle/self-improve/schedule actions that commit future autonomy are `ask`/`pin` tier in the permission guard.
- The Brain vault may contain sensitive personal data → it lives under `~/.localmind/` (already sandboxed by the filesystem tool) and is excluded from any backup that leaves the machine unless the user opts in.

---

## 10. Suggested build order (dependency-aware)
1. **B — Hide/Summon Sora** (½d, warm-up).
2. ~~**D — `schedule_task` tool**~~ ✅ shipped.
3. **A — Ops Kanban** + `pillar`/`parent_process_id` migration (2–3d). Foundational surface everything else reports into.
4. **G.3 — Context Broker** (2d). Highest-leverage intelligence upgrade; unblocks efficient memory/brain use.
5. **C.1 you.com** (1d) + **C.2 Obsidian vault/brain scaffolding + `brain_edges`** (2d).
6. **F — Pillars tagging + Ideate persona** (1–2d, mostly config once A + broker exist).
7. **G.1/G.2 — Idle cycle + test runner + self-improve proposals** (Gate 1 proposal cards from failing self-checks are wired; Gate 2 build-after-approve remains).
8. **C.4 Unipile** (3–4d) → enables the communicate pillar fully.
9. **C.5 MindStudio provider** (1–2d) + **E Renovate/CI** (1d).

> **Where H (User Context Graph + GraphQL) slots in:** the `/context` *visualization + ingestion* (§12.6/§12.5) is best built after **C.2 (brain_edges)** and the **Context Broker (§7.3)** exist, since it reuses the Brain store and feeds retrieval. The *GraphQL layer* (§12.8) comes last, once the user graph is rich enough that flexible traversal pays off. Don't build GraphQL before there's a graph to query. This feature is **distinct from Feature A** — H models the *user*, A tracks the *agent*.

---

## 11. Open questions for the owner
1. **Multi-user vs single-operator:** much of this (esp. the Brain) leans single-operator. Is LocalMind still meant to support multiple `owner/member` users, or optimize for one? (Affects Brain scoping and Ops board filters.)
2. **Cloud tolerance:** you.com/Unipile/MindStudio each send some data off-machine. Confirm which, if any, you want enabled — or should all cloud integrations ship **disabled by default** (my assumption)?
3. **Self-improvement ceiling:** confirm "propose PRs, human merges" is acceptable (my strong recommendation) vs. wanting anything more autonomous (I'd advise against).
4. **Obsidian vs native graph:** is opening the vault in Obsidian a must-have, or is the in-app d3 graph enough for v1?
5. **Ideate:** should "Ideate" be a persona/mode (my plan) or a full separate workspace surface?
6. **GraphQL scope:** confirm you're happy with GraphQL as a **read-mostly traversal layer over the User Context Graph only** (my strong recommendation), rather than migrating existing REST routes. And: is the in-app `/context` view enough, or do you also want it queryable by Sora as a tool (§12.10)?
7. **Context ingestion aggressiveness:** how proactively should Sora infer user context from conversations (always as unconfirmed `inferred` nodes for you to confirm — my default), and do you want the opt-in calendar/contacts/reminders importer in v1?

---

## 12. Feature H — User Context Graph (who the user is, what they want & need) + GraphQL where it fits

> **Scope correction (owner clarification):** this feature is **not** a map of what Sora/the agent is doing — that's the Ops board (Feature A). Feature H is a **model of the *user*** — their goals, needs, people, projects, commitments, preferences, and interests — so that (a) the user can see and steer how the assistant understands them, and (b) Sora can ground every response in *what this person actually wants and needs*. The two are complementary: **Ops = the agent's activity (transient); Context Graph = the user's world (durable).**

### 12.1 Problem
As a personal assistant, Sora is only as good as her model of the user. Today that model is **fragmented and mostly unstructured** (verified in the codebase): flat key/value `memory`, a `goals` table shown on `/today`, free-text `notes` with `[[wiki]]` links, and live-but-ephemeral macOS reads (calendar/contacts/reminders). Nothing connects a goal to the people involved, the project it belongs to, the deadline that drives it, or the user's stated preferences. So Sora can't reliably answer "what matters to me right now?" and the user can't see (or correct) what the assistant thinks it knows about them.

### 12.2 Goal
A single **User Context Graph** — a durable, user-rooted graph of the user's world — that:
1. **The user can view and steer** at `/context`: a graph centered on a **You** node, branching into goals, needs, projects, people, commitments, preferences, and interests, where the user can confirm, correct, or delete anything the assistant inferred about them.
2. **Sora reads via retrieval** (the Context Broker, §7.3) so every turn is grounded in the relevant slice of the user's goals/needs/preferences — "only what's needed," not a dump.
3. **Is queried via GraphQL** where flexible traversal genuinely helps (below).

### 12.3 What already exists to build on (don't reinvent)
| Source (verified) | Contributes | Table / file |
|---|---|---|
| **Goals** | commitment nodes w/ target date, milestones, progress | `goals` table; `src/lib/db/goals.ts`; `/api/goals` |
| **User memory** | durable facts → preference/attribute nodes | `memory` table (flat key/value, `user_id`); `src/lib/db/queries.ts` |
| **Notes + wiki-graph** | project/idea/topic nodes + `[[link]]` edges | `notes` table; `/api/knowledge/notes/graph` returns `{nodes,links}` |
| **Brain entities (§4.0)** | people/companies/topics as markdown entities + `brain_edges` | `~/.localmind/brain/`, `brain_edges` |
| **Calendar / contacts / reminders** | commitments, people, to-dos (live macOS reads) | `src/lib/tools/{calendar,contacts,reminders}.ts` |
| **users / settings** | the You node identity + communication prefs | `users.display_name`; `settings` (locale, personality) |

**Reuse the Brain (§4.0) as the persistence layer.** The User Context Graph is not a new store — it is the Brain's entity/edge model (`~/.localmind/brain/` markdown + `brain_edges`) **plus** first-class node kinds for `goal`, `need`, `preference`, and `commitment`, rooted at a single `user` node. This keeps one graph, one store, one viz.

### 12.4 Data model — the user-rooted graph
Extend the Brain's node/edge model (no separate DB):

- **Node kinds:** `user` (the root, singleton per owner), `goal`, `need`, `project`, `person`, `commitment` (event/deadline), `task`, `preference`, `interest` (topic), `resource` (note/doc/link).
- **Edge kinds (typed, user-centric):** `wants` (user→goal), `needs` (user→need), `responsible_for` (user→project), `knows` (user→person), `cares_about` (user→interest), `part_of` (goal→project, task→project), `involves` (goal/project→person), `due` (goal/task→commitment), `prefers` (user→preference), `blocks` (x→goal/task), `about` (resource→anything).
- Each node carries `source` (`stated` = user told us, `inferred` = Sora derived it, `imported` = calendar/contacts) and `confidence` + `confirmed_at`. **This is the steering mechanism** — the UI lets the user promote `inferred → confirmed` or delete, so the user's self-model is never silently wrong.
- Migration: add `node_kind`, `source`, `confidence`, `confirmed_at` to the Brain entity store; the four new user-specific kinds (`goal`/`need`/`preference`/`commitment`) bridge to their existing tables (`goals`, `memory`) via a stable `ref` id so `/today`, the memory UI, and the graph stay in sync (edit in one place, reflected everywhere).

### 12.5 How the graph gets populated (ingestion — the "context around the user")
This is the substance of the feature: turning scattered signals into a connected user model.
- **From goals:** each `goals` row → a `goal` node linked `wants` from the user; `target_date` → a `due` edge to a `commitment` node; milestone text scanned for `[[people]]`/`[[projects]]`.
- **From memory:** flat `memory` key/values are classified (cheap, local, no-LLM heuristics + optional small-model pass during the idle cycle) into `preference`, `need`, or `attribute` nodes rather than a flat list. E.g. `communication_style: concise` → a `preference` node.
- **From conversations:** during the idle consolidation cycle (§7.1), extract stated goals/preferences/people the user mentioned ("I need to finish the deck by Friday", "I prefer morning meetings") into `inferred` nodes for later confirmation. Never auto-`stated`; always `inferred` until the user confirms.
- **From calendar/contacts/reminders:** an opt-in importer structures recurring people/commitments into `person`/`commitment` nodes (these tools return plaintext today, so add a thin parse+persist step). Off by default; local-only.
- **From the Brain:** people/company/topic entities already flow in via §4.3's zero-LLM edge extraction.

### 12.6 UX — the `/context` page (the user's view of themselves)
- New page `src/app/context/page.tsx`; nav entry in `rail.tsx` (Knowledge cluster, next to Memory) + `⌘K` "My context — what Sora knows about me."
- **Reusable force-graph:** generalize `src/components/note-graph.tsx` (keep its D3-from-CDN pattern so D3 stays out of the server bundle) into `src/components/force-graph.tsx` taking `{ nodes, links }` with `kind` for color and `source` for styling (e.g. dashed ring = `inferred`/unconfirmed). `NoteGraph` becomes a thin wrapper.
- The **You** node sits at the center; goals/needs/projects/people/preferences radiate out. Click a node → side panel with details + **Confirm / Edit / Delete**; unconfirmed `inferred` nodes get a subtle "Sora thinks…" badge and a one-click confirm/dismiss.
- Filters by kind; a "Needs confirmation" filter surfaces everything `inferred` and unconfirmed so the user can curate in one pass.
- Empty/first-run state explains it fills in as the user talks to Sora and confirms facts.

### 12.7 How Sora *uses* it (the point of all this)
- The **Context Broker (§7.3)** retrieves the relevant user-context slice per turn (embeddings are already local via `nomic-embed-text`): the user's active goals, related people, and pertinent preferences for the current topic — packed within the token budget, not dumped. This directly upgrades the current `memory` prompt block (which today lists *all* key/values) to *retrieved, relevant* context.
- Preferences become behavioral: `prefers: concise` or `prefers: morning meetings` steer tone and scheduling suggestions.
- Proactivity: the existing morning briefing (`/api/proactive/briefing`) already reads goals; point it at the context graph so briefings reason over goals + due commitments + involved people, not just goal titles.

### 12.8 GraphQL — used narrowly, where traversal actually helps
**Honest verdict:** GraphQL is the right tool for **flexible, variable-shape traversal of a connected graph** ("the You node, plus active goals, plus the people each involves, plus their next commitment, 2 hops out"). The User Context Graph is exactly that shape, so it's a good fit **here**. It is the **wrong** tool for the rest of LocalMind — keep those on REST/SSE:
- Chat/tool streaming (bespoke SSE in `engine.ts`), state-changing actions (must stay behind permission guard + confirmation + audit), internal worker routes (loopback+token), auth/backup. **No migration of existing REST routes.**

**Design:**
- Single **read-mostly** endpoint `POST /api/graphql` (register in `route-map.ts` as `authenticated`). Writes stay on the existing REST endpoints (`/api/goals`, `/api/memory`, context confirm/delete) so the permission guard + audit still run; GraphQL exposes at most a tiny allowlisted mutation set that *delegates* to those handlers, or none in v1.
- **Server:** `graphql-yoga` mounted in an App Router route handler (`src/app/api/graphql/route.ts`) — lightweight, first-class Next support, in-process (no extra service, preserves local-first), built-in SSE subscriptions matching LocalMind's existing SSE pattern. (Apollo Server + `@as-integrations/next` is an acceptable heavier alternative.)
- **Efficient by construction:** `better-sqlite3` is synchronous/in-process → resolvers are trivial, no pool, no network hop. **DataLoader** batches neighbor reads. One endpoint replaces the growing set of bespoke aggregation shapes the graph view would otherwise need.
- **Auth nuance:** middleware authorizes by path, so `/api/graphql` carries one coarse `authenticated` gate; do **field/resolver-level auth** using the `x-user-id`/`x-user-role` headers the middleware injects, and **scope every query to the requesting user** (`user_id`) — a user only ever sees their own context. Never expose anything more permissive than its REST equivalent.
- **Abuse/cost controls (non-optional, the "efficient" mandate):** query **depth + cost limits** (e.g. `@escape.tech/graphql-armor`), a **persisted-query allowlist** in production (client ships hashed operations; arbitrary ad-hoc queries rejected), introspection **off** in prod.
- **Subscriptions:** `contextNodeUpserted` / `edgeAdded` over Yoga SSE so the `/context` graph patches live as Sora confirms/adds nodes.

### 12.9 Schema sketch (illustrative — refine during build)
```graphql
type Query {
  me: User!                                  # the You node
  context(kinds: [NodeKind!], needsConfirmation: Boolean): Graph!
  node(id: ID!): ContextNode
}

type User {
  id: ID!, displayName: String!
  goals(status: GoalStatus): [Goal!]!
  needs: [Need!]!
  people: [Person!]!
  preferences: [Preference!]!
  interests: [Interest!]!
  projects: [Project!]!
}

interface ContextNode { id: ID!, kind: NodeKind!, label: String!, source: Source!, confidence: Float, confirmedAt: DateTime }

type Goal implements ContextNode {
  id: ID!, kind: NodeKind!, label: String!, source: Source!, confidence: Float, confirmedAt: DateTime
  targetDate: DateTime, progress: Int!, status: GoalStatus!
  project: Project
  involves: [Person!]!        # people this goal touches (DataLoader-batched)
  due: Commitment
  blockedBy: [ContextNode!]!
}

type Person implements ContextNode {
  id: ID!, kind: NodeKind!, label: String!, source: Source!, confidence: Float, confirmedAt: DateTime
  relationship: String        # e.g. manager, spouse, collaborator
  relatedGoals: [Goal!]!, upcoming: [Commitment!]!
}

type Preference implements ContextNode { id: ID!, kind: NodeKind!, label: String!, source: Source!, confidence: Float, confirmedAt: DateTime, category: String, value: String! }

type Graph { nodes: [ContextNode!]!, edges: [Edge!]! }
type Edge { id: ID!, type: EdgeType!, source: ID!, target: ID! }

enum NodeKind { USER GOAL NEED PROJECT PERSON COMMITMENT TASK PREFERENCE INTEREST RESOURCE }
enum EdgeType { WANTS NEEDS RESPONSIBLE_FOR KNOWS CARES_ABOUT PART_OF INVOLVES DUE PREFERS BLOCKS ABOUT }
enum Source { STATED INFERRED IMPORTED }
enum GoalStatus { ACTIVE PAUSED DONE DROPPED }

type Subscription { contextNodeUpserted: ContextNode!, edgeAdded: Edge! }
```
Resolvers read existing accessors (`listGoals`, `listMemory`, `listNotes`, brain-edge queries, `users`) — GraphQL is a **query façade**, not a new store.

**Client:** `urql` + `@urql/exchange-graphcache` (lighter than Apollo Client) so the graph updates incrementally from subscription patches; `graphql-codegen` for typed ops. `/context` ships **phase 1 on REST** (a `GET /api/context/graph` returning `{nodes,links}` like the notes graph does), then swaps to a persisted GraphQL query behind `LM_GRAPHQL=1` — the two coexist and roll back cleanly.

### 12.10 Optional — expose it to Sora as a tool
Add a read-only `user_context` tool that runs **persisted** GraphQL queries (never arbitrary model-authored queries — allowlist only), so Sora can ask "what are my active goals involving Priya and their deadlines?" directly. Read-only, cacheable, audited. This is distinct from the Context Broker (which auto-injects the relevant slice); the tool is for explicit, on-demand lookups. Defer to a later phase.

### 12.11 What NOT to do (guardrails)
- ❌ Don't conflate this with the Ops board — this graph is about the **user**, not agent processes.
- ❌ Don't auto-mark inferred facts as `stated`/confirmed; the user must confirm. Never silently persist a wrong self-model.
- ❌ Don't migrate existing REST routes to GraphQL; additive, read-mostly only. Writes keep the permission guard + audit.
- ❌ Don't allow arbitrary client queries in prod (persisted allowlist + depth/cost limits); introspection off in prod.
- ❌ Don't add a separate GraphQL server process — mount in-process to preserve the single-binary local-first deploy.
- ❌ Don't send any of this off-machine; the user context graph is among the most sensitive data in the app.

### 12.12 Dependencies (GraphQL phase only)
| Package | Role | Note |
|---|---|---|
| `graphql`, `graphql-yoga` | in-process GraphQL server | Pin; runs inside the Next route handler. |
| `@escape.tech/graphql-armor` (or envelop plugins) | depth/cost limits, persisted queries | Security + perf gate. |
| `dataloader` | batch neighbor/edge reads | Avoid N+1. |
| `urql` + `@urql/exchange-graphcache` | client + normalized cache | Lighter than Apollo Client. |
| `@graphql-codegen/*` (dev) | typed operations | Dev-only. |

Add `/api/graphql` to `route-map.ts` (`authenticated`), add these to the Renovate pin/allow policy (§8.2), keep them behind `LM_GRAPHQL=1` until stable.

### 12.13 Acceptance criteria
- [ ] `/context` renders a user-rooted force-graph (You → goals/needs/projects/people/preferences/interests) built from goals + memory + notes + brain entities + (opt-in) calendar/contacts.
- [ ] Inferred nodes are visually distinct and can be confirmed/edited/deleted by the user; edits sync back to the underlying `goals`/`memory` stores.
- [ ] The Context Broker (§7.3) injects only the **relevant** user-context slice per turn within the token budget — no full dump; embeddings run locally.
- [ ] Phase 2: GraphQL is a single in-process read endpoint, per-user scoped, introspection off in prod, depth/cost limits + persisted-query allowlist enforced; no REST route removed; no write bypasses the guard/audit.
- [ ] Nothing about the user context leaves the machine; the graph is per-user isolated.

### 12.14 Effort
Phase 1 (`/context` viz on REST + ingestion from goals/memory/notes/brain) ~3–4 days. Calendar/contacts importer ~1–2 days (opt-in). GraphQL layer ~3–4 days. Optional `user_context` tool ~1 day. **Build the phase-1 viz + ingestion first; add GraphQL once the graph is rich enough that traversal pays off.**
