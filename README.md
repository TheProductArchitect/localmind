# LocalMind

A local-first AI control panel for Mac. Chat with **Sora**, your personal assistant —
automate workflows, search and read the web, control your Mac, and audit everything
in the browser. Nothing leaves your machine unless you choose a cloud provider.

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
| Database | SQLite (`~/.localmind/config.db`, `conversations.db`, knowledge DB) |
| AI | Provider abstraction — Ollama (default), Anthropic, OpenAI, Groq, OpenRouter |
| Agent | Tool-calling loop with streaming SSE, subagents, task graphs, routing rules |
| Worker | `worker.js` — cron, monitors, jobs, critic (via `/api/internal/*`) |
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
| `spawn_subagent` / `spawn_subagents_parallel` | Specialist personas (researcher, coder, …) |

Chat shows spawn work as a high-level agent card; expand **Show what this agent did**
to drill into child tool Input/Output.

### Agent capabilities

- **Tools** — filesystem, web search, web research, secure page read, memory, calendar,
  reminders, contacts, email, mac automation, browser, knowledge base, MCP plugins,
  subagents, and more
- **Automations** — scheduled tasks, condition monitors, multi-step workflows with human approval
- **Orchestration** — personas, routing rules (model per task shape), task graphs, fleet federation
- **Channels** — Telegram, SMS/voice (Twilio); reply YES/NO to approve gated actions

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

### Models

LocalMind works with small Ollama models (e.g. `llama3.2` ~3B), but tool judgment improves
materially with larger ones (8B+). Pull and select models under **Models**.

### Key paths

- `src/lib/agent/` — engine, routing, web-guard, confirmations, critic, system prompt
- `src/lib/tools/` — built-in tools (`read-secure-webpage`, web research, subagent, …)
- `src/app/browse/` — user-facing secure reader
- `src/lib/workflow/` — workflow executor and delivery
- `src/middleware.ts` — JWT + role enforcement
- `worker.js` — background scheduler
- `mcp-servers/secure-browser/` — Secure Browser MCP

## Environment variables

| Variable | Purpose |
|----------|---------|
| `LOCALMIND_INTERNAL_TOKEN` | Shared secret for worker → `/api/internal/*` (auto-generated if unset) |
| `LOCALMIND_CRITIC_ENABLED=1` | Enable subagent critic reviews |
| `LOCALMIND_USE_GRAPHS=0` | Disable task-graph path for `runAgentCollect` |
| `LOCALMIND_IN_PROCESS_SCHEDULER=1` | Run cron inside Next.js (dev without worker) |
| `BRAVE_API_KEY` | Brave Search API for `web_search` |
| `PLAYWRIGHT_BROWSERS_PATH` | Optional; Secure Browser falls back to `~/Library/Caches/ms-playwright` if incomplete |
| `SECURE_BROWSER_DEVICE` | `cpu` \| `mps` \| `cuda` for the injection scanner |

## Non-negotiables

- Filesystem tool rejects paths outside approved directories (and rejects http(s) URLs)
- Every tool call is append-only in the audit log
- API keys encrypted AES-256-GCM; PIN bcrypt-hashed
- Permission guard runs server-side only
- `/api/internal/*` requires loopback **and** per-install token
- Web tools respect the kill switch / site grants / sensitive-domain heuristics
