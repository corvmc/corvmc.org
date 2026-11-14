# 0083 Door cash is a ticket sale

- **Date:** 2026-11-13
- **Status:** Accepted
- **Issue:** [#2800](https://github.com/corvmc/corvmc.org/issues/2800)

## Context

[0018](0018-door-sales-on-one-tap-to-pay-phone.md) put card sales on the door screen and said
nothing on cash. A walk-up who paid cash was recorded through the free path, or not at all, and
the cash reached the settlement only as the end-of-night Cash counted figure, split by the door
rule with no tickets behind it.

## Decision

1. **A cash sale is a ticket sale.** The door screen offers Card or Cash. Cash mints
   `checked_in` tickets at the stated price under a `cash-…` purchase id, with no PaymentIntent.
   As in 0018, the purchase id says how the sale was paid, so there is no new column.
2. **Cash takes the show's default split**, as a card does: `doorTicketSplit` with no fee and no
   charge minimum. `recordDoorTicketSale` writes `ticket_sales` and `act_payout` rows with
   `settlement: 'cash'`, so the settlement reaches them through the ledger as it reaches cards.
3. **Cash counted is checked against recorded cash sales.** The door rule
   (`doorSplitActsPercent`) splits only the cash counted beyond the recorded sales. A short
   drawer splits nothing and leaves the recorded sales standing. Any difference warns on the
   settlement and is never refused.
4. **One table of methods.** `src/lib/door/takings.ts` maps each method to its prefix, and
   `getEventDoorTakings` builds a line per method from it. A new method is a new key there.
5. **Each cash sale writes an audit row** (`event.door_cash_sale`): no processor holds a record
   of it.

## Alternatives rejected

- **Cash stays off the app, reconciled only through Cash counted.** Check-ins and the Door sales
  card then undercount the night, and the acts' share of cash follows a different rule from
  cards.
- **Splitting Cash counted as before, on top of recorded sales.** The recorded sales are in the
  pool already, so the acts would be paid twice on them.
- **A `payment_method` column on `ticket`.** The purchase id already carries it for every door
  sale, and a column would need a backfill for the rows 0018 wrote.

## Consequences

- A night with no recorded cash sales splits Cash counted as before, and shows the whole amount
  as a difference from recorded sales.
- `settlement-ticket-revenue.spec.ts` pins cash, cash with card, and card alone against real
  SQLite; `door-sale.spec.ts` reads every method's purchase id back to its takings line.
