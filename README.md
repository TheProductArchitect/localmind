# LocalMind

A local-first AI control panel for Mac. Chat with **Sora**, your personal assistant —
automate workflows, search and read the web, control your Mac, and audit everything
in the browser. Watch every agent on the **Ops board**, keep a personal **Brain**,
and steer what Sora knows about you in the Knowledge hub. Nothing leaves your
machine unless you choose a cloud provider.

## Install

```bash
./install.sh
```

Installs Homebrew, Node.js, Ollama, and PM2 if missing, builds the app, registers it as a
login process, and opens http://localhost:3000.

## Develop

```bash
npm install
npm run dev    # http://localhost:3001
npm test
npm run build
npm run start  # http://localhost:3000 — rebuild after route/UI changes
```

### Desktop app (LocalMind's own browser)

```bash
npm run build && npm run app   # Electron shell; reuses :3000 server or spawns one
npm run app:dev                # against a running `npm run dev` (:3001)
```

The Electron shell turns `/browse` into a real browser: the LocalMind UI is
the chrome, and each tab is a sandboxed Chromium `WebContentsView` — real
sessions, real JS, real logins, driven from the same app Sora lives in. On
the web build, `/browse` falls back to the screenshot Live mode + Reader.

**Report improvement** (rail flag, ⌘⇧F, Help menu, or ⌘K → “Report improvement”)
captures the current route, your note, recent errors, and an optional screenshot,
then asks the active local model for concrete suggestions. Reports stay in
`~/.localmind` — nothing is uploaded.

Main process: `electron/main.js` (tab manager, server boot); privileged
bridge: `electron/preload.js` (chrome window only — tab content is fully
sandboxed with no preload).

**Sora on your tabs (phase 3).** Sora rides in a side panel next to the
tabs — plain chat by default. Click **Grant Sora** on a tab and the server
attaches to that one tab over CDP (`127.0.0.1:9223`, loopback-only), turning
it into a `browse_session` Sora can read and act on; a green
"Sora can see and act on this tab" strip — drawn by the chrome, unreachable
by page content — shows while access is live. Grants are per-tab, revocable
in one click, die with the tab, gate through the web-guard, and audit as
security events. `LM_AGENT_BRIDGE=0` disables the bridge entirely.

The Sora panel is collapsible — **Hide** in its header (or `⌘/`) reclaims the
width for the page; a floating **Ask Sora** orb summons it back. The panel stays
mounted while hidden, so the conversation and any active tab grant survive.

PM2 production stack (app + background worker):

```bash
pm2 start ecosystem.config.js
```

The **worker** handles scheduled tasks, condition monitors, embedding jobs, and the agent
critic queue. Cron tasks are **not** duplicated in the Next.js process unless you set
`LOCALMIND_IN_PROCESS_SCHEDULER=1` for local dev without PM2.

## Architecture

| Layer | Stack |
|-------|--------|
| Frontend | Next.js 15 App Router, React 19, Tailwind, Radix |
| Database | SQLite (`~/.localmind/config.db`, `conversations.db`, knowledge DB) + Markdown Brain vault (`~/.localmind/brain/`) |
| AI | Provider abstraction — Ollama (default), LM Studio, Anthropic, OpenAI, Groq, OpenRouter |
| Retrieval | Local `nomic-embed-text` embeddings + sqlite-vec; Context Broker packs cited slices within a token budget |
| Agent | Tool-calling loop with streaming SSE, subagents, task graphs, routing rules, pillar tagging |
| Worker | `worker.js` — cron, monitors, jobs, critic, idle self-improvement (via `/api/internal/*`) |
| Security | Permission guard, audit hash chain, loopback auth, sandboxed filesystem |

### Assistant (Sora)

Sora is prompted as a **personal assistant**: answer clearly, act when useful, and call
tools only when the request needs the outside world. Main chat has the full tool
registry; `request_tool_access` is reserved for **subagents** that hit a narrow tool
ceiling.

Built-ins that matter for web work:

| Tool | Role |
|------|------|
| `read_secure_webpage` | First-class alias for Secure Browser (prefer this for a concrete URL) |
| `web_research` | Search + read top pages through Secure Browser |
| `web_search` | Snippets / discovery only |
| `browser` | Raw Chromium — confirmation on every call |
| `schedule_task` | Create/list/update/disable recurring tasks (NL → cron, confirmed) |
| `spawn_agents` | Preferred unified spawn — one goal or a batch; mode inferred (defaults sequential) |
| `spawn_subagent` | Single specialist child (chain when B needs A's output) |
| `spawn_subagents_sequential` | Batch, one child at a time (legacy / explicit) |
| `spawn_subagents_parallel` | Batch with governor-capped concurrency |
| `coding_project` | Register git repos; start/discard undoable worktree sessions |
| `git` | Session-scoped status/diff/commit/push/open_pr (never pushes main) |

Chat shows spawn work as a high-level agent card; expand **Show what this agent did**
to drill into child tool Input/Output. Small models that narrate tool JSON as text
are recovered by `parseTextToolCalls` and still run through the permission guard.

Agent mode defaults to **auto** (non-destructive actions run freely; deletes and
other destructive floors still confirm). Toggle Auto / Plan / Ask in chat or Settings.

### Agent capabilities

- **Tools** — filesystem, web search, web research, secure page read, memory, calendar,
  reminders, contacts, email, mac automation, browser, knowledge base, MCP plugins,
  subagents, `schedule_task`, and more
- **Automations** — scheduled tasks, condition monitors, multi-step workflows with human approval;
  Sora can self-serve recurring work via `schedule_task` (confirmed before it commits)
- **Orchestration** — personas, routing rules (model per task shape), task graphs, fleet federation
  (paired LAN devices sync chats + small image attachments with per-device attribution;
  **Run on → Auto** is the default when peers are paired and places turns on the least-loaded
  peer that accepts chat relay; task graphs use the same placement runner)
- **Projects** — autonomous coding on registered git repos via worktree sessions (`/projects`);
  SWE loop (plan → implement → test → review → PR); **Discard** undoes the session;
  Ops board shows coding cards with PR / discard links
- **Pillars** — every unit of work is tagged `ideate · research · execute · coordinate · communicate · maintain`
  so the Ops board can filter and group it; the **Strategist** persona runs divergent→convergent ideation
- **Channels** — Telegram, SMS/voice (Twilio); reply YES/NO to approve gated actions

### Agent Ops board (`/ops`)

A live Kanban of every unit of agent work, in its own rail glyph. Cards flow
through **Proposals → Queued → Running → Needs you → Done → Failed**, sourced in
one fetch from `agent_processes` (`GET /api/orchestration/processes?board=1`)
with workflow approvals and self-improvement proposals folded in. Toggle
**Kanban** vs **By pillar**, filter by pillar, and open a card for the live SSE
trace. Inline controls reuse the existing pause/resume/cancel and approval
endpoints. Complements `/orchestration` (deep control) and `/graphs` (DAG view).

### The Brain

A plain-Markdown, Obsidian-compatible vault at `~/.localmind/brain/` — one file
per entity (people, companies, topics, ideas). A zero-LLM write hook parses
`[[wikilinks]]` into a typed `brain_edges` graph (`works_at`, `mentioned_in`,
`related_to`, …). Indexed by the existing local embeddings, so it feeds
retrieval without anything leaving the machine.

### Context Broker (efficient memory)

Instead of dumping whole files into the model, the broker (`src/lib/agent/context-broker.ts`)
retrieves only the top-relevant slices per turn: it embeds the query locally
(`nomic-embed-text`), searches the knowledge base + memory, dedupes, and packs
citations within a **token budget** (default 15% of the context window), with an
explicit "not in memory" note when coverage is thin. Retrieval is 100% local.

### User Context Graph (Knowledge → "About you")

A durable, user-rooted view of what Sora understands about **you** — goals,
preferences, people, and topics — assembled from goals + memory + the Brain and
rendered as a force graph. It lives as the **"About you"** tab inside
`/knowledge`, so "what Sora knows" and "what Sora knows about you" sit on one
page. Inferred nodes are visually distinct from stated ones. Read-only in phase 1;
per-user scoped; nothing leaves the machine. Distinct from `/ops`, which tracks
the *agent's* activity. (`/context` redirects to `/knowledge?tab=context`.)

### Reach (Settings → "What Sora can reach")

One place to see and govern everything Sora can act on or reach through — its
tools (with permission tiers), the channels it messages on, its web access
(kill switch + per-site grants), and MCP/plugin integrations.

### Idle self-improvement (opt-in, two-gate)

When enabled (**off by default**) and the machine is idle within a nightly
window, a worker cycle runs the test suite (read-only w.r.t. app code, recorded
to `self_checks`) and — only when `LM_SELF_IMPROVE=propose` — turns failing checks into
**improvement proposal cards** on the Ops board (Gate 1). After the owner Approves,
Gate 2 starts a **coding session** (worktree) + SWE loop when a project is registered
on `/projects` (or `LM_SELF_IMPROVE_PROJECT_ID`). Sora never merges to main — final
merge is always human.

### Web access model

All agent web reach goes through a three-layer guard (`src/lib/agent/web-guard.ts`),
enforced in tool code — not in the prompt — so injected instructions can't skip it:

1. **Kill switch** (Settings → Data & Privacy → Web access) — severs `web_search`,
   the Secure Browser, and the raw browser for every agent, instantly.
2. **Site grants** — per-domain standing policy, like camera permissions.
   `never` blinds agents to a domain (and its subdomains); `allow` opts it in.
3. **Sensitive-context blindness** — banking, government, health, and webmail
   domains are blind by default; pages with a password field are withheld by the
   Secure Browser itself unless the domain has an explicit `allow` grant.

Normal page reading uses **`read_secure_webpage`** (Secure Browser MCP under
`mcp-servers/secure-browser/`): SSRF checks → headless fetch → strip scripts/hidden
nodes → sensitive-field gate → Markdown → local prompt-injection scan. The raw
`browser` tool requires user confirmation on every call, even in auto mode.
`filesystem` rejects `http(s)` paths and points the model at `read_secure_webpage`.
Every page read is written to the security audit log.

**Browse** (`/browse`, ⌘K → "Browse the web") is the same pipeline as a user-facing
reader — what you see is exactly what Sora would see, with an "Ask Sora about this
page" handoff into chat.

Bootstrap Secure Browser from **Fleet → MCP** (or `mcp-servers/secure-browser/bootstrap.sh`)
before first use. The launcher (`run.sh`) prefers the real Playwright browser cache if
a sandbox `PLAYWRIGHT_BROWSERS_PATH` is incomplete.

### UI

- Chat header (model / mode / auto-read) and composer stay fixed; only the thread scrolls
- **Settings → General → App font size** sets `--lm-root-fs` (12–28px) for the whole app

### Multimodal input

Attach images in the chat composer (paperclip) to send them with your message.
Images are downscaled client-side (max 1024px) to keep payloads lean, stored
with the message, and passed to the model. Understanding them requires a
**vision model** (e.g. `llava`, `llama3.2-vision`, or a cloud vision model) —
pull/select one under **Models**. Video isn't supported yet: local vision models
process still images, not video (frame extraction / a cloud video model is a
future path).

### Models

LocalMind works with small Ollama models (e.g. `llama3.2` ~3B), but tool judgment improves
materially with larger ones (8B+). Pull and select models under **Models**.

### Key paths

- `docs/architecture.md` — surface map + agent/spawn/data code graphs (mermaid)
- `docs/PRD-personal-assistant-v3.md` — v3 PRD (coding polish, presentations, automation, mesh pins, frontier models) — shipped
- `docs/personal-assistant-v3-implementation.md` — v3 feature → code status
- `docs/PRD-mesh-depth-v4.md` — v4 PRD (workspace RPC, token stream, MindStudio/Unipile, PDF, code-server)
- `docs/mesh-depth-v4-implementation.md` — v4 feature → code status
- `docs/architecture.md` — surface map + fleet / migrations
- `docs/sora-v2-implementation.md` — Sora v2 PRD feature → code status
- `src/lib/agent/` — engine, routing, web-guard, confirmations, critic, system prompt,
  `context-broker.ts` (RAG), `pillar-classify.ts`, `idle.ts` / `idle-cycle.ts`,
  `text-tool-calls.ts` (narrated-JSON recovery)
- `src/lib/tools/` — built-in tools (`read-secure-webpage`, web research, subagent sequential/parallel, `schedule`, …)
- `src/lib/db/brain.ts` — Brain entity graph (`brain_edges`); `proposals.ts` / `self-checks.ts`
- `src/lib/context-graph.ts` — User Context Graph assembler (`/api/context/graph`)
- `src/components/context-graph-view.tsx` — the "About you" tab (in `/knowledge`)
- `src/components/rail.tsx` / `command-palette.tsx` — primary nav + ⌘K
- `src/app/ops/` — Agent Ops Kanban board
- `src/app/browse/` — user-facing secure reader
- `src/lib/workflow/` — workflow executor and delivery
- `src/middleware.ts` — JWT + role enforcement
- `worker.js` — background scheduler + idle self-improvement tick
- `mcp-servers/secure-browser/` — Secure Browser MCP

## Environment variables

| Variable | Purpose |
|----------|---------|
| `LOCALMIND_INTERNAL_TOKEN` | Shared secret for worker → `/api/internal/*` (auto-generated if unset) |
| `LOCALMIND_CRITIC_ENABLED=1` | Enable subagent critic reviews |
| `LOCALMIND_USE_GRAPHS=0` | Disable task-graph path for `runAgentCollect` |
| `LOCALMIND_IN_PROCESS_SCHEDULER=1` | Run cron inside Next.js (dev without worker) |
| `BRAVE_API_KEY` | Brave Search API for `web_search` |
| `LOCALMIND_EMBED_MODEL` | Local embedding model for RAG / Context Broker (default `nomic-embed-text`) |
| `LM_CONTEXT_BUDGET_FRACTION` | Fraction of the context window the Context Broker may spend on retrieved context (default `0.15`) |
| `LM_CONTEXT_FLOOR_TOKENS` | Minimum retrieval budget in tokens (default `400`) |
| `LM_CONTEXT_TOPK` | Max retrieved chunks per turn (default `6`) |
| `LM_SELF_IMPROVE` | `propose` lets the idle cycle write proposal cards to the Ops board; `off` (default) disables it entirely. No auto-build/auto-merge value exists |
| `LM_IDLE_RUN_TESTS` | `0` disables the idle test runner (default: runs when idle-eligible) |
| `LM_AGENT_BRIDGE=0` | Disable the Electron CDP bridge for "Grant Sora" on tabs |
| `PLAYWRIGHT_BROWSERS_PATH` | Optional; Secure Browser falls back to `~/Library/Caches/ms-playwright` if incomplete |
| `SECURE_BROWSER_DEVICE` | `cpu` \| `mps` \| `cuda` for the injection scanner |

The web-search backend is selectable in **Settings** (`web_search_provider`:
`auto` · `brave` · `you` · `duckduckgo`); `you` uses the you.com API with a key
stored encrypted in `api_keys`. `auto` prefers you.com if keyed, then Brave,
then DuckDuckGo — so the local-first default needs no key.

## Dependencies

CI (`.github/workflows/ci.yml`) runs `npm ci && lint && test && tsc && build` plus
an isolation check on every PR. **Renovate** (`renovate.json`) opens dependency
PRs on an off-hours schedule: minor/patch are grouped and auto-merged **only when
CI is green**; majors always get their own reviewable PR and never auto-merge;
`next`, `react`, `electron`, `better-sqlite3`, and `playwright` are pinned and
upgraded deliberately by a human.

## Non-negotiables

- Filesystem tool rejects paths outside approved directories (and rejects http(s) URLs)
- Every tool call is append-only in the audit log
- API keys encrypted AES-256-GCM; PIN bcrypt-hashed
- Permission guard runs server-side only
- `/api/internal/*` requires loopback **and** per-install token
- Web tools respect the kill switch / site grants / sensitive-domain heuristics
