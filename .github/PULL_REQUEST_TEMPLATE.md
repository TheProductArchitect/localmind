<!--
Thanks for opening a PR! Keep this terse — reviewers will read the diff,
not the description. Use this template to tell them what to look for.
-->

## What this changes

<!-- One or two sentences. What was wrong / missing, and what does this do
about it. Link the issue: "Fixes #123" / "Closes #123". -->

## Why

<!-- The motivation, not the mechanics. If this fixes a bug, what was the
user-visible symptom? If this adds a feature, who asked for it? -->

## How to verify

<!-- Concrete reproducer for a reviewer. e.g. "Run `npm run dev`, open
/agents, click X, see Y." If you added tests, this can just be "see new
tests in __tests__/<file>". -->

## Checklist

- [ ] `npm run lint` passes with zero warnings
- [ ] `npx tsc --noEmit` passes
- [ ] `npm test` passes
- [ ] `npm run build` passes
- [ ] I added or updated tests for any change to safety-critical code
      (`src/lib/auth/**`, `src/lib/agent/permission-guard.ts`,
      `src/lib/agent/sanitize-tool-output.ts`)
- [ ] I read [CONTRIBUTING.md](../CONTRIBUTING.md) and this PR follows it
- [ ] No new outbound HTTP calls without an explicit user opt-in
- [ ] No new migrations edit existing migration blocks
