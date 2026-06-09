# Security Policy

LocalMind is local-first by design: audio, conversations, and credentials never
leave your machine unless you explicitly pair with a peer or enable an external
provider. We take security seriously and appreciate disclosures from the
community.

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security problems.**

Report vulnerabilities privately via GitHub's "Report a vulnerability" workflow:

1. Go to https://github.com/TheProductArchitect/localmind/security/advisories/new
2. Provide:
   - A description of the issue and the impact
   - Steps to reproduce (a minimal repro is ideal)
   - Affected versions / commit SHAs
   - Any suggested mitigation

We aim to acknowledge new reports within **72 hours** and provide a status
update or fix plan within **7 days**. Critical issues (RCE, auth bypass,
credential exfiltration) are prioritized.

## Supported Versions

LocalMind is pre-1.0 and ships from `main`. Security fixes land on `main` and
are picked up by the next tagged release. There is currently no LTS branch.

## Scope

In scope:

- The web app and its API routes (`src/app/api/**`)
- The agent loop, tool dispatch, and subagent spawn flow (`src/lib/agent/**`,
  `src/lib/tools/**`)
- The auth + permission system (`src/lib/auth/**`, `src/lib/agent/permission-guard.ts`)
- The fleet pairing / mTLS handshake (`src/lib/fleet/**`)
- The prompt-injection sanitizer (`src/lib/agent/sanitize-tool-output.ts`)
- Anything that touches SQLite or the keystore

Out of scope:

- Vulnerabilities in third-party MCP servers a user has installed
- Misconfigurations a user has made to their own deployment (e.g. exposing the
  app to the public internet without a reverse proxy)
- Denial-of-service via expensive prompts to the user's own local LLM
- Issues that require physical access to an unlocked machine

## Disclosure Timeline

We follow responsible disclosure:

- Day 0: Report received, acknowledged within 72 hours.
- Day 7: Status update or fix plan shared with the reporter.
- Day 7–60: Patch developed and tested; coordinated with the reporter.
- Day 60–90: Public advisory + fix published. Reporters credited unless they
  prefer otherwise.

Critical findings may be disclosed sooner if exploitation is already known to
be in the wild.

## Bug Bounty

LocalMind does not currently run a paid bug bounty. We're happy to credit
reporters in the published advisory and in the release notes.
