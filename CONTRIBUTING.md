# Contributing to LocalMind

Thank you for your interest. LocalMind is a local-first, browser-controlled
AI assistant — most contributions land best when they keep those principles
intact: audio never leaves the box, every action is audited, no cloud storage
by default.

Before you start, please skim the [Code of Conduct](CODE_OF_CONDUCT.md). Be
kind, be specific, do good work.

## Reporting issues

- **Security bugs** — please file a private advisory via
  [GitHub Security](https://github.com/TheProductArchitect/localmind/security/advisories/new).
  See [SECURITY.md](SECURITY.md). Do not open public issues for vulnerabilities.
- **Bug reports & feature requests** — use the issue templates. A clear repro
  in 5 lines is worth more than a paragraph of context.
- **Open-ended questions** — use [GitHub Discussions](https://github.com/TheProductArchitect/localmind/discussions).

## Setting up locally

```bash
git clone https://github.com/<your-fork>/LocalMind.git
cd LocalMind
npm install        # also wires up the husky pre-commit hook
npm run dev        # http://localhost:3001
```

Requirements: Node 20+, macOS or Linux.

## What "ready to review" looks like

Every PR must pass these locally before you push:

```bash
npm run lint        # eslint (zero warnings)
npx tsc --noEmit    # typecheck
npm test            # vitest unit tests
npm run build       # production build succeeds
```

The pre-commit hook (`.husky/pre-commit`) runs eslint on the files you staged
plus a full typecheck. If it blocks you and you're confident the failure is
spurious, you can `git commit --no-verify` — but **fix the underlying issue
in the PR**, don't just bypass it.

For changes that touch the agent loop, tool dispatch, fleet pairing, or the
permission system, also run:

```bash
npm run test:isolation   # cross-user data isolation check
```

This requires the dev server running on port 3000 with a clean
`LOCALMIND_DATA_DIR`. CI does this for you on every PR.

## What we look for in a PR

- **Small and focused.** One feature, one fix, one refactor — not all three.
- **Tests for safety-critical code.** Any change to `src/lib/auth/**`,
  `src/lib/agent/permission-guard.ts`, `src/lib/agent/sanitize-tool-output.ts`,
  or anything in the destructive-action floor MUST add or update unit tests
  in `__tests__/`. These are the modules where a regression is a real
  vulnerability.
- **No new dependencies without a justification.** A bullet in the PR
  description explaining why the existing surface won't do is enough.
- **No silent cloud calls.** If your change introduces an outbound HTTP call,
  it must be gated behind an explicit user setting (Providers, Communications,
  etc.) and surface in the audit log.
- **Migrations are append-only.** Don't edit a past migration in
  `src/lib/db/migrations.ts`. Add a new versioned block.
- **Comments explain WHY, not WHAT.** If a future reader will be surprised by
  the code, leave a note. If they won't, don't.

## Branching & commits

- Branch from `main`. Name it `<type>/<short-description>`, e.g.
  `feat/per-agent-memory` or `fix/sanitizer-exfil-pattern`.
- Use conventional-style commit prefixes when they help readers:
  `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`, `ci:`.
- Sign commits if you have GPG/SSH signing set up — it's not required.

## Review process

- One maintainer review is required for non-trivial changes.
- The [CODEOWNERS](.github/CODEOWNERS) file routes safety-critical changes
  to maintainer review automatically.
- Address review comments via follow-up commits on the PR branch (don't
  force-push over them — reviewers lose context). Squash on merge.
- We aim to give a first response within 7 days. If you don't hear back, a
  polite ping on the PR is welcome.

## Areas where contributions are especially welcome

- More prompt-injection test cases for `sanitize-tool-output.ts` — the more
  adversarial corpora we test against, the safer the floor.
- New persona definitions and their tool-surface defaults.
- MCP server adapters that fit LocalMind's audit + permission model.
- Documentation for self-hosting on Linux (Docker, systemd, reverse proxy
  setup).
- Accessibility audits — run `npm run audit:a11y` and file fixes.

## Things we won't merge

- Code that auto-uploads user data to a third-party service.
- Changes that bypass the destructive-action floor.
- Telemetry that runs by default.
- Anything that reduces local-first guarantees without an opt-in.
- Code without commit attribution / under an incompatible license.

Thank you for helping make LocalMind better.
