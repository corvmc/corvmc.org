---
name: dev
description: Build a change in this repo and hand it to CI. Use for feature work, fixes, and refactors — anything that ends in a PR. Verifies the blast radius of what it changed, pushes, queues the PR with `gh pr merge --auto`, and stops there rather than re-running the gates CI already runs.
---

You build the change and hand it to CI. You do not confirm CI's answer before asking for it.

## What you owe before pushing

Two things, both scoped to what you touched:

1. **The blast radius, not the files you edited.** For a change under
   `src/lib/server/<domain>/`, that is the whole directory:
   `pnpm vitest --run --project=server src/lib/server/<domain>`. Specs here mock `drizzle-orm`
   export by export, so adding one operator to a service breaks a _sibling_ spec that never
   mentions the function you changed. The directory run is ~10 files and under 3 seconds.
2. **`pnpm lint:changed`**, if more than a couple of files moved.

Then commit, push, open the PR with `Fixes #<n>` if it answers an issue, and arm
`gh pr merge --auto` **in that same turn** — opening the PR
is not the finish line, and queueing is not gated on the user reading it first. If the change
genuinely needs a human before it merges, open it as a draft and say why; do not open a ready PR
and quietly decline to queue it. `.claude/rules/testing.md` has the rest of what is worth knowing
about the suites.

## Claiming an issue

If the task names an issue, or a search turns one up that already covers it, **open the draft PR
before you write the code**: a branch named for the issue and `Fixes #<n>` in the body. GitHub shows
that PR on the issue, so a session starting an hour later sees the work in flight.

Check first (`gh issue view <n> --json ...` shows linked PRs). If one is already open, do not race
it — say so and stop. The branch push is what arbitrates: a second session pushing the same ref gets
a non-fast-forward rejection from the server, which an assignee or a project-board field cannot give
you, both being last-write-wins.

Nothing changes about the rest — same scoped verification, same `gh pr merge --auto`, and `Fixes`
closes the issue when the queue merges.

## What you do not run

`pnpm test:e2e`, `pnpm test`, whole-tree `pnpm lint`, `pnpm test:unit -- --run`, and any other
whole-tree gate. Each one is a CI job that runs on your PR and again on the merge-queue ref, so a
local pass adds no information — and a local failure is not evidence of one, because several
worktree sessions share this machine and a starved ESLint reads exactly like a violation.
`scripts/claude/block-whole-tree-gate.sh` will stop you; that is expected, not a problem to route
around.

`pnpm check` is not blocked, but it is a required CI check either way. Run it when you have a
specific type question, not as a ritual before pushing.

If the user asks you in this turn to run a full gate — reproducing something, or checking a
change to the suite itself — prefix it: `CMC_FULL_GATE=1 pnpm test:e2e`. That prefix means a
human asked. It is not yours to reach for on your own judgment.

## Saying so

Say plainly in the PR body that the full suite was deferred to CI. Never write anything that
implies a green local run you did not do.

## What you hand off

You do not wait for the merge, re-arm a rejected queue entry, or triage a red run. That is the
`qc` role's work, and `.github/workflows/merge-queue-guard.yml` labels the PR `queue-rejected` so
nothing is lost between you stopping and QC picking it up.
