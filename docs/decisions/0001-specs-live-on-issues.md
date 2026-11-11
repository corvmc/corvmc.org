# 0001 Specs live on issues

- **Date:** 2026-11-10
- **Status:** Accepted
- **Issue:** [#2524](https://github.com/corvmc/corvmc.org/issues/2524)

## Context

Phase 1 of the feature checklist put a design spec in `docs/specs/`, and a built spec moved to
`docs/specs/shipped/`. A built spec describes a plan, but readers take it as a description of the
app. `docs/specs/shipped/` held 54 files, 17 of them marked superseded.
`production-workflow-spec.md` still described `cancelUnconfirmedReservations()` after #2503
removed it. No check kept the specs current.

## Decision

Specs do not live in the repo.

1. **Proposal** — on the issue, as its body or a comment, and discussed there. Never committed.
2. **Living docs** — each build PR updates the docs that describe current behaviour, in the same
   PR as the code: `domain-model.md`, `overview.md`, `business-workflows.md`,
   `operations-manual.md` and help articles.
3. **Decision record** — a feature's last PR adds a short, dated record under `docs/decisions/`.
   A record is never edited; a later record supersedes it by number.

## Alternatives rejected

- **Specs in `docs/specs/`, archived to `docs/specs/shipped/` once built.** This was the previous
  practice. An archived spec still reads as a description of the app, and no check keeps it
  current.

## Consequences

- The issue is the one place to read and discuss a proposal.
- Rationale that outlives the build goes in a decision record. A record carries its date, so it
  does not read as a description of the current app.
- A build PR that changes behaviour without updating the living docs is incomplete.
- `docs/specs/` is retired under #2525.
