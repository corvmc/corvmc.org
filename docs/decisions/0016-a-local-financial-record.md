# 0016 A local financial record

- **Date:** 2026-09-08
- **Status:** Accepted
- **Issue:** [#825](https://github.com/corvmc/corvmc.org/issues/825)

## Context

Stripe recorded what cleared, but not what it was for. Thirty money columns across ten tables
recorded the collective's money, and no query could read them together. Outflow, in-kind gifts
and the acts' share of the door never reached Stripe. The annual report (#587), show
settlement (#593) and project burn each needed one answer to "what did the collective earn,
spend and get given".

## Decision

One append-only table, `financial_entry`, owns accounting. Stripe stays authoritative for
settlement.

1. Each row has a signed amount, a `kind` (`earned`, `spent`, `in_kind`, `pass_through`) and a
   `category`. `in_kind` is never summed with `earned`, and a `pass_through` pair is never
   netted away.
2. A refund is a reversing entry, never an update, so a reported month never changes.
3. A free sale writes a $0 entry, so "10 tickets, 3 free" differs from "7 tickets".
4. `subjectType`/`subjectId` carry no foreign key: the entry outlives what it describes.
5. Money held for acts shares a `settlementGroup`. The group's sum is read, not enforced.
6. A pool that goes negative after settlement stays negative. No compensating `spent` entry.
7. Categories are a `config.ts` const, because reports are shaped by them.
8. The card fee is always `spent`, whoever paid it; fee coverage is `earned`.

## Alternatives rejected

- **Mirror each Stripe charge locally.** That is the Laravel ledger the payment design removed.
  This records purpose, not a charge's lifecycle.
- **Double-entry bookkeeping.** An account tree, period closing and statements are more than
  the reports need.
- **A categories table.** Adding a category would not change the reports that depend on it.
- **A `spent` entry for a post-settlement loss.** It would count money that left once as two
  losses.
- **A per-period Stripe baseline for the backfill.** Per-charge reconstruction replaced it: the
  same data at a finer grain, reconciling by construction.

## Consequences

- Every path that moves money writes entries through `financial-entry-service.ts`, and
  `money-map.ts` fails the suite on a money column nobody has classified.
- A weekly job compares the `stripe`-settled sum with Stripe's balance.
- The historical backfill assumes the ticket split was always 30/70 and the room rate always
  $15/hr. Neither is stored per row.
