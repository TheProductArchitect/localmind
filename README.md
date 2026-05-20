# LocalMind

A local-first AI control panel for Mac. Chat with a local AI assistant, give it tools to act
on your Mac, and audit everything — all in your browser, nothing sent to the cloud unless you
choose to.

## Install

Download the repo and run the one-time installer:

```bash
./install.sh
```

It installs Homebrew, Node.js, Ollama and PM2 if missing, builds the app, registers it as a
login process, and opens http://localhost:3000. After this you never need the terminal again.

## Develop

```bash
npm install
npm run dev
```

Open http://localhost:3000. On first run you'll go through a six-step onboarding wizard.

## Architecture (Phase 1)

- **Frontend** — Next.js 14 App Router, React, Tailwind.
- **Database** — SQLite (`~/.localmind/config.db`, `~/.localmind/conversations.db`) with a
  versioned migration runner.
- **AI runtime** — Ollama at `http://localhost:11434` behind a provider abstraction.
- **Agent engine** (`src/lib/agent`) — agent loop, permission guard, audit logger with a
  SHA-256 tamper-evident hash chain.
- **Tools** (`src/lib/tools`) — filesystem (sandboxed to approved dirs), web search, memory.
- **Streaming** — server-sent events from `POST /api/chat`.

## Non-negotiables enforced

- Filesystem tool rejects any path outside approved directories.
- Every tool call is written to the append-only audit log; there is no delete route.
- API keys encrypted with AES-256-GCM; PIN hashed with bcrypt.
- Permission guard runs server-side only.
- Deletes are soft (files → trash, conversations → 7-day recovery).
