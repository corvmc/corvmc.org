## What changed

<!-- Bullet the concrete changes. Lead with user-facing behavior, then supporting/internal changes. -->

-

## Why

<!-- The problem this solves or the motivation. -->

**Fixes #** <!-- The issue this answers, if there is one. `Fixes`/`Closes` closes it when the queue
     merges, which is what keeps the tracker honest. Search before assuming there isn't one:
     `gh issue list --state open --search '<terms>'`. Delete this line if it genuinely answers none. -->

## How to verify

<!-- Steps a reviewer can follow to confirm it works: routes to visit, commands to run, expected results. -->

-

## Reviewer notes

<!-- Anything non-obvious: schema/migrations, new env vars or config, deliberate trade-offs, follow-ups left out of scope, areas you're unsure about. Delete if none. -->

## Checklist

- [ ] `pnpm svelte-check` passes (no new type errors in touched files)
- [ ] Tests added or updated where it makes sense, and `pnpm test:unit` passes
- [ ] Schema changes have a generated `drizzle-kit` migration committed
- [ ] Seed data (`scripts/seed-dev.ts`) updated if the feature needs it
- [ ] Verified in the running app for user-facing changes
