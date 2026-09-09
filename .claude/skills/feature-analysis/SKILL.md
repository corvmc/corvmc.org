---
name: feature-analysis
description: Work out what to build before writing a spec — verify the premise, map the workflow as handoffs, find the one mechanism behind several features, and date the drift. Use when picking up a backlog issue, planning a feature area, or when an issue's premise has not been checked against main.
---

# Working out what to build

`docs/development/feature-analysis.md` is the canonical version. Read it. What follows is the order
the moves tend to come in, and the traps that are specific to this repo.

## Start by trying to dissolve the issue

About one backlog issue in six is stale. Before designing anything, check its central claim against
`main` — and check it the way the claim is actually made, not the way it is worded. A feature can be
"already built" because a _route_ exists while the table behind it does not (#575), and a DTO can
render something a grep for column names will never find.

`gh issue list --state open --search '<terms>'` first, always: an issue may already exist, and a
linked PR means someone is on it.

## Then map the workflow as handoffs, not screens

Who hands what to whom, and what each one gates. Write that with **no reference to the code**, then
annotate. Keep the layers separate — headings for the ideal, bodies for what exists — or the
document reads as a description of what is already there.

The tab order of a console will hide the gaps. The handoff chain will not.

## Look for one mechanism behind several issues

Three issues describing the same shape are one feature. The tell is issues that **cross-reference
nothing** — that is what an unowned stage looks like in a tracker.

## Reach for these before arguing from first principles

| Question                         | Where the answer already is                                           |
| -------------------------------- | --------------------------------------------------------------------- |
| Is this a decision or drift?     | `migrations/*/migration.sql` timestamps, `git log -S`                 |
| Would this break something?      | `scripts/seed/` — the edge cases live there, with comments saying why |
| What was this meant to do?       | The doc comment above it, which is often now false                    |
| What does this actually compute? | Call it. Write a throwaway spec and run the real function             |

The money case is not optional. Reasoning about a split gets the shape right and the numbers wrong,
and the numbers are what somebody is paid.

## Ending

The output is a spec in `docs/specs/` that says **what gets built** — rejected alternatives go in
git, not in it — plus a `spec`-labelled tracking issue, plus a filed issue for everything found
along the way that is not this feature. Then `feature-workflow` takes over.
