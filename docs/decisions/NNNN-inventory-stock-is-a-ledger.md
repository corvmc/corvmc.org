# NNNN Inventory stock is a ledger

- **Date:** 2026-08-27
- **Status:** Accepted
- **Issue:** PRs [#286](https://github.com/corvmc/corvmc.org/pull/286),
  [#293](https://github.com/corvmc/corvmc.org/pull/293); see
  [#605](https://github.com/corvmc/corvmc.org/issues/605)

## Context

The `equipment` module kept `equipment.totalQuantity` as a number staff typed. The only way to
record a pack of strings being opened was to overwrite that number, so consumables could not be
tracked and spend could not be reported. `serialNumber` and `condition` sat on a quantity row, so
twelve cables shared one serial. Nothing recorded where gear came from. Production held no
equipment rows.

## Decision

Gear and consumables share one append-only ledger, built in the app.

1. **Every stock change is a `stock_movement` row**: a signed quantity, a reason, a time and an
   actor. On-hand is the sum of those rows and is never stored. A stocktake correction is an
   `adjust` movement.
2. **The catalog splits three ways**: `inventory_item` (a kind of thing), `inventory_asset` (one
   physical unit) and `stock_movement` (what happened).
3. **Two separate axes.** `kind` (`serialized` or `bulk`) says how an item is tracked;
   `isLoanable` says whether it comes back. A consumable is a bulk item that is not loanable,
   derived and never stored.
4. **Every arrival goes through an acquisition**, from the first release. Cost and provenance
   cannot be added to a `receive` row later.
5. **The `equipment*` tables were dropped and replaced**, not migrated, and the `equipment` feature
   flag was cut. Member surfaces guard with `requireUser`.

## Alternatives rejected

- **Migrate the `equipment` tables additively.** Production held no rows, so a compatibility layer
  would have preserved nothing.
- **A cached on-hand counter.** That counter was the defect being removed. If profiling ever needs
  one, it follows the `creditTransaction` pattern: a cached column reconciled by cron, with the
  ledger canonical.
- **One `kind` enum covering returnability.** It cannot describe the cable drawer: cables are
  counted and returnable, strings are counted and not.
- **Buy a lending product** (Cheqroom, myTurn, Rentman, Snipe-IT). Loans settle against
  membership: `calculateLoanCharge` discounts for sustaining members and draws equipment credits
  from `creditTransaction`. An external system cannot see either without syncing membership into
  it.
- **A `supplier` table.** The collective buys from a few shops. `spendBySource()` groups free-text
  `sourceName` on `lower(trim(...))`. Revisit if free text fragments beyond that.
- **Keep the `equipment` flag under a new name.** It hid a module nobody had used, and the member
  nav did not read it.

## Consequences

- Usage and spend questions are queries over rows that already exist.
- Nothing outside `stock-service.ts` writes `stock_movement`.
- A serialized item's ledger sum equals its count of live units, an invariant the specs assert.
- The member nav shows Equipment from data (`hasLoanableItems()`), not a flag.
