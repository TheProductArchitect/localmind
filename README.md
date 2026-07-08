# LocalMind

A local-first AI control panel for Mac. Chat with an agentic assistant, automate workflows,
search the web, control your Mac, and audit everything — all in your browser. Nothing leaves
your machine unless you choose a cloud provider.

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

### Agent capabilities

- **Tools** — filesystem, web search, web research, memory, calendar, reminders, contacts,
  email, mac automation, browser, knowledge base, MCP plugins, subagents, and more
- **Automations** — scheduled tasks, condition monitors, multi-step workflows with human approval
- **Orchestration** — personas, routing rules (model per task shape), task graphs, fleet federation
- **Channels** — Telegram, SMS/voice (Twilio); reply YES/NO to approve gated actions

### Key paths

- `src/lib/agent/` — agent engine, routing, confirmations, critic, graph executor
- `src/lib/tools/` — built-in tools
- `src/lib/workflow/` — workflow executor and delivery
- `src/middleware.ts` — JWT + role enforcement
- `worker.js` — background scheduler

## Environment variables

| Variable | Purpose |
|----------|---------|
| `LOCALMIND_INTERNAL_TOKEN` | Shared secret for worker → `/api/internal/*` (auto-generated if unset) |
| `LOCALMIND_CRITIC_ENABLED=1` | Enable subagent critic reviews |
| `LOCALMIND_USE_GRAPHS=0` | Disable task-graph path for `runAgentCollect` |
| `LOCALMIND_IN_PROCESS_SCHEDULER=1` | Run cron inside Next.js (dev without worker) |
| `BRAVE_API_KEY` | Brave Search API for `web_search` |

## Non-negotiables

- Filesystem tool rejects paths outside approved directories
- Every tool call is append-only in the audit log
- API keys encrypted AES-256-GCM; PIN bcrypt-hashed
- Permission guard runs server-side only
- `/api/internal/*` requires loopback **and** per-install token
