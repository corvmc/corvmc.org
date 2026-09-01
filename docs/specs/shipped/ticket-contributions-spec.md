# Ticket contributions and the member-discount opt-out

CMC concert tickets are NOTAFLOF — no one is turned away for lack of funds. In
practice the pressure runs the other way too: members ask to pay more than the
listed price, or to skip their 50% sustaining-member discount, as a way to
support the venue and the band on the bill.

Ticket checkout today (see `shipped/tickets-spec.md`) has one price, one
unconditional member discount, and a fee-coverage checkbox. This spec adds two
buyer choices and starts recording what people actually paid.

---

## Key concepts

**A contribution is a second line item, not a bigger ticket.** The ticket keeps
its price. An optional gift rides along as its own Stripe line item under its
own product, so appreciation money stays legible in Stripe reporting instead of
being smeared into ticket revenue.

**The discount is a default, not a rule.** A sustaining member still gets 50%
off automatically. A per-purchase checkbox lets them decline it for this show.
The choice is not remembered — a member who wants to support one touring band
is not making a standing policy.

**The ticket row learns what it cost.** The shipped spec put pricing entirely in
Stripe. That was right when every ticket for an event cost the same thing; it
stops being right once two buyers at the same show can pay different amounts.
Three columns on `ticket` record the outcome so staff can see it without a
Stripe round trip, and so a future band/venue settlement has something to split.

**This does not make NOTAFLOF operational online.** With a fixed price plus an
optional gift, someone who cannot afford a ticket still cannot buy one on the
site. NOTAFLOF remains a door policy, said plainly on the purchase page, with
staff comps (`compTickets`) as the mechanism. A member-facing "request a free
ticket" flow is deferred.

---

## Domain model

### Ticket (extended)

```
unitPriceCents      integer?   — what this pass cost, after any member discount.
                                 0 for comps and free claims. Null on rows that
                                 predate the column.
contributionCents   integer    — the order's optional gift, recorded once on the
                                 purchase's first ticket. Default 0.
discountWaived      boolean    — an eligible member chose to pay full price.
                                 Default false.
```

There is still no order table — the shipped spec's "one table, not two" holds.
The contribution is an order-level fact, so it lands on exactly one row of the
purchase rather than being divided across tickets. Summing
`contributionCents` over a `purchaseId` therefore gives the gift once, and
summing `unitPriceCents` gives the ticket revenue.

### Product config

A new `ProductKey`, `ticket_contribution` ("Show Support"), alongside the
existing `ticket`. Created lazily in Stripe like every other key.

---

## Purchase flow

Unchanged up to pricing. Then:

1. The buyer may enter a contribution in dollars, optionally via a quick-pick
   ($5 / $10 / $25). Blank or `0` means none. Capped at $1,000 — above that is a
   typo, not a gift.
2. A sustaining member may check "Pay full price — skip my 50% member discount."
   Unchecked by default.
3. The unit price is the half rate only when the buyer is a member _and_ has not
   waived it.
4. The cart is the ticket line item, plus a `ticket_contribution` line item of
   quantity 1 when the contribution is above zero.
5. Fee coverage, when requested, is computed on the whole cart — contribution
   included — because that is what Stripe charges fees on.
6. Tickets are created with `unitPriceCents`, `discountWaived` on every row and
   `contributionCents` on the first.
7. Session metadata carries `ticket_contribution_cents` so the webhook can tell
   a gift apart from a processing fee.

### Receipt

`handleTicketCheckout` derives the receipt breakdown by subtracting known parts
from Stripe's subtotal. The contribution has to be subtracted explicitly, or the
buyer's confirmation email reports their gift as a processing fee. The
`ticket.purchased` domain event gains `contributionCents`, and the
`ticket-confirmation` template gains a conditional receipt row.

---

## What changes

| Area                     | Change                                                                        |
| ------------------------ | ----------------------------------------------------------------------------- |
| `ticket` schema          | Add `unitPriceCents`, `contributionCents`, `discountWaived`                   |
| `product-config-service` | New `ticket_contribution` product key                                         |
| `event-ticketing` util   | `contributionToCents` parser                                                  |
| `ticket-service`         | `createTickets` persists the three new fields; `getEventTickets` selects them |
| `purchaseTickets` remote | `contribution` and `waiveDiscount` fields; second line item; new metadata     |
| `checkout-listener`      | Subtract the contribution before deriving fees; emit it                       |
| Receipt email            | Conditional contribution row                                                  |
| Purchase UI              | Shared `TicketPurchaseFields` component on both purchase surfaces             |
| Staff production page    | Amount paid, contribution, and waiver in the ticket ledger                    |

## What doesn't change

| Area                      | Notes                                                               |
| ------------------------- | ------------------------------------------------------------------- |
| Payment service           | `checkout()` already prices a multi-line cart and fees it correctly |
| Ticket status lifecycle   | Untouched — these are money facts, not admission state              |
| Capacity, check-in, comps | Untouched                                                           |
| Credits                   | Tickets still don't consume them                                    |

---

## Permissions

No new roles. Contributions and the waiver are buyer choices on a flow that is
already open to guests; the recorded amounts are visible to staff only, through
the existing staff-guarded event production query.

---

## Deferred

- **Contributions on free events.** `claimFreeTicket` never touches Stripe;
  accepting a gift there means routing a free claim through checkout.
- **A "request a free ticket" flow** — the real online NOTAFLOF path.
- **A saved account preference** for waiving discounts. Per-purchase only.
- **Directing a gift to the band vs. the venue.** The amounts are recorded, so
  the already-spec'd 70/30 settlement can split them later.
