---
name: feature-workflow
description: The nine-phase checklist for building a feature in this repo — design, schema, services, routes/UI, seed data, tests, verify, document, commit. Use when starting anything that adds database schema, adds a route, or spans several files.
---

# Building a feature here

The checklist below is the canonical version. A few notes on what the phases mean in practice:

- **Branch** — the phase that used to be a feature flag. A member-facing feature needing more than
  one PR to work goes on a `feature/<slug>` branch and reaches `main` once, finished;
  `/feature-branch` runs it. Staff-only surfaces, schema and refactors go straight to `main`. Read
  `docs/development/conventions.md#long-lived-feature-branches` before the first merge from `main`
  — the migration rule there is counter-intuitive and the failure is silent.
- **Design** — the proposal goes on the issue, as its body or a comment, for anything with new
  schema or cross-file reach. It is never committed. Getting _to_ a proposal worth building from is
  its own pass: `feature-analysis`, and `docs/development/feature-analysis.md`. Check
  `docs/decisions/` for an earlier decision on the same question.
- **Schema → Services → Routes** is a strict order. Generate the migration and review its SQL
  before writing the service, and write the service before the route, so the remote function has
  something real to delegate to.
- **Verify** means the gates in `CLAUDE.md`, matched to what you changed — `pnpm check` for
  anything typed, `pnpm test:unit -- --run` for service logic, `pnpm docs:check` if routes moved.
- **Document** is not optional. Each build PR updates the living docs for the behaviour it
  changes; the last PR adds the feature catalog row (`docs/reports/feature-catalog.md`) and a
  decision record in `docs/decisions/`.

The canonical checklist follows, imported from `docs/development/conventions.md`:

@../../../docs/development/conventions.md
