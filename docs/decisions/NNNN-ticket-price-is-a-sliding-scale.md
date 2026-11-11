# NNNN A ticket price is a sliding scale

- **Date:** 2026-09-03
- **Status:** Accepted

## Context

CMC shows are NOTAFLOF: no one is turned away for lack of funds. Checkout sold one fixed price, with
a 50% sustaining-member discount, a per-purchase waiver of that discount, and an optional
contribution. A buyer who could not afford the price could not get a ticket on the site; the
mechanism was a staff comp. The contribution field said a gift went to the acts and the room, and
nothing in the code divided it.

## Decision

1. **The price is a suggestion with a floor.** `event.ticketPrice` is where the scale opens, and
   `ticketPriceFloorCents`, default 0, is the least a buyer may pay. A floor equal to the price is a
   fixed-price show.
2. **$0 skips Stripe.** A purchase at zero mints `valid` tickets at once, capped per email.
3. **The buyer splits the money** between the acts and the collective on a bar, with card
   processing as a locked third slice taken off the top. The acts' guarantee is anchored on the
   suggested price, not on what was paid, so a buyer paying above the suggestion directs the
   surplus.
4. **The allocation is recorded, not routed,** for a collective sale. `actsCents`,
   `collectiveCents` and `feeCoveredCents` go on the purchase's first ticket, every dollar lands in
   CMC's Stripe account, and staff settle the acts from the record.
5. **One module does the arithmetic,** `src/lib/finance/ticket-split.ts`, client-importable, so the
   preview and the recorded figures come from the same code. The server re-derives the split from
   the event's own price and floor and trusts nothing the client posts.
6. **The member discount is removed.** `discountWaived` is no longer written.
7. **Paying above the suggestion is a contribution,** sent as its own `ticket_contribution` line
   item so the receipt and Stripe reporting keep it apart from ticket revenue.

## Alternatives rejected

- **A "request a free ticket" flow.** It makes a buyer ask a person for permission to afford a
  show. The scale makes free an outcome rather than a request.
- **Keeping the member discount.** Half off a pay-what-you-can price is a discount off nothing; a
  member can already pay less.
- **Stripe Connect payouts to acts for a collective sale.** A touring band should not need a Stripe
  account to be paid for playing a show. An act is paid the way a contractor is.
- **Anchoring the acts' guarantee on the gross paid.** Every generous buyer would raise the acts'
  floor and cap the share they could send to the collective.

## Consequences

- Staff totals are "as sold". Refunds happen in the Stripe dashboard, which the ticket rows do not
  see.
- A floor between $0 and `TICKET_MIN_CHARGE_CENTS` is refused on the event form, since it would ask
  for an amount checkout cannot charge.
