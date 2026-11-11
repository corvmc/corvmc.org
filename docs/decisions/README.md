# decisions

Dated records of why the app is built the way it is. Each one records a decision as it stood on its
date. What the app does now is in the living docs listed in
[conventions](../development/conventions.md#living-docs-and-decision-records).

This README is the index for the folder: every record gets a row in the table below.

## Format

One file per decision, named `NNNN-slug.md`: a four-digit number one above the highest here, then a
short slug. Each record has these parts:

- **Date** — the day the decision was made, as `YYYY-MM-DD`.
- **Status** — `Accepted`, or `Superseded by NNNN`.
- **Context** — the problem and the facts that forced a choice.
- **Decision** — what was decided, stated as a rule.
- **Alternatives rejected** — each option weighed, and why it lost.
- **Consequences** — what changes, and what now has to be kept up.

A page or less. Link the issue and the PRs.

## Rules

- **A record is never edited after it merges.** The one exception is the Status line, which a
  superseding record changes to `Superseded by NNNN`.
- **A later record supersedes an earlier one by number.** The new record names the one it replaces
  in its Context.
- **A feature's last PR adds its record.** The proposal itself stays on the issue.

## Records

| #    | Record                                               | Date       | Status   |
| ---- | ---------------------------------------------------- | ---------- | -------- |
| 0001 | [Specs live on issues](0001-specs-live-on-issues.md) | 2026-11-10 | Accepted |
