# The ticket sliding scale, and where the money goes

CMC concert tickets are NOTAFLOF — no one is turned away for lack of funds. Up
to now that has been a sentence on the checkout page rather than something the
checkout page can do: the form sells one fixed price, so a person who cannot
afford a ticket still cannot get one on the site, and the real mechanism is a
staff comp or turning up at the door and asking.

At the same time the same form makes a promise about the money. The contribution
field says a gift "goes to the acts on the bill and to keeping the room open",
and nothing in the code divides it, because there is no payout path to an act at
all — every dollar lands in CMC's single Stripe account and stays there.

This spec replaces the money half of ticket checkout with three questions:

1. **How many people are you bringing?** — quantity, unchanged.
2. **How much are you paying?** — a sliding scale. `event.ticketPrice` becomes
   the _suggested_ price and a new per-event floor, defaulting to `$0`, is the
   bottom of the scale.
3. **Where should it go?** — a two-way split bar, the acts against the
   collective, with card processing shown as a locked third slice.

It is the ticket half of the model band audio sales already ship (see
`shipped/band-audio-spec.md`, § Money): the collective's cut is the default
position of a control the buyer can move, and a cut you cannot refuse is a rake.

---

## Key concepts

**The price is a suggestion with a floor under it.** `ticketPrice` stops meaning
"what this costs" and starts meaning "where the scale opens".
`ticketPriceFloorCents` is the least a buyer may pay, and it defaults to `0`,
which runs the scale all the way to free. A show that needs a floor — a touring
act with a guarantee — gets one, set per event by staff. A show whose floor
equals its suggested price is a fixed price, which is exactly how every show
behaved before this spec, and is what the migration backfills existing events to.

**Free is a real outcome, not a request.** At `$0` the purchase never touches
Stripe: it mints valid ticket rows immediately, the same way a free event's
`claimFreeTicket` already does. This is the "request a free ticket" flow
`shipped/ticket-contributions-spec.md` deferred, with the request taken out — no
one has to ask a person for permission to afford a show.

**The allocation is recorded, not routed.** The split bar writes two numbers onto
the purchase. It does not send money anywhere: every dollar still lands in CMC's
Stripe account, and staff settle from the record. This is deliberate and is not a
first step toward Stripe Connect for acts — **a touring band should never need a
Stripe account to get paid for playing a show.** An act is paid the way a
contractor is (`contractor.ts`), and the eventual payout record is
contractor-shaped: what was promised, what was actually handed over, how, and
when, plus the donated-performance case, which CMC asks for regularly and cannot
record anywhere today.

**Card processing is a third party to the split.** It comes off the top and the
two shares divide what is left. The bar draws it as its own labelled slice, so a
buyer sees 70/30 become 63/30/7 rather than being shown a number nobody actually
receives. The suggested position is therefore a share of what is divisible — the
charge minus the fee — not of the gross.

**The 50% sustaining-member ticket discount is removed.** Half off a
pay-what-you-can ticket is not a coherent benefit: the scale already lets a
member pay less, and a discount off a suggestion is a discount off nothing. The
scale opens at the suggested price for everyone. Members keep free practice hours
and gear perks; events drop off the benefits list.

**Paying above the suggestion is still a contribution.** The amount above
`ticketPrice` becomes the `ticket_contribution` line item, exactly as today, so
appreciation money stays legible in Stripe reporting and the receipt email keeps
its breakdown. Nothing about the webhook's fee derivation changes.

---

## Domain model

### Event (extended)

```
ticketPrice            integer?   — now the SUGGESTED price. Null is still a free
                                    event with no scale at all.
ticketPriceFloorCents  integer    — the bottom of the scale. NOT NULL, default 0.
                                    Meaningless when ticketPrice is null.
```

Three rules, enforced in `event-service.ts` because SQLite cannot add a CHECK to
an existing table, and the staff form is the only writer:

- `0 ≤ floor ≤ ticketPrice`
- `floor === 0 || floor ≥ TICKET_MIN_CHARGE_CENTS`
- editing `ticketPrice` re-checks the floor

The second rule is the non-obvious one. A floor of $1 asks for an amount nobody
can pay: $1 is inside the dead zone below the charge minimum, and $0 is below the
floor. Caught at the staffer's form, or it surfaces as a checkout that refuses
everything.

### Ticket (extended)

```
actsCents        integer  — the buyer's allocation to the bill. Default 0.
collectiveCents  integer  — the buyer's allocation to CMC. Default 0.
feeCoveredCents  integer  — the surcharge when fees were covered. Default 0.
```

All three are order-level and land on the purchase's first ticket only, like
`contributionCents` and for the same reason: there is no order table, so summing
across a `purchaseId` has to count each order-level fact exactly once.

They reconcile without a Stripe round trip:

```
unitPriceCents × qty + contributionCents + feeCoveredCents
  = actsCents + collectiveCents + Stripe's fee
```

`NOT NULL DEFAULT 0` means comps and free claims need no change — a comp
allocates nothing, and `0/0/0` is the truth about it.

`discountWaived` stops being written. The column stays: it is still true of the
rows that have it, and dropping a column on D1 is a table rebuild for nothing.

---

## The arithmetic

One module, `src/lib/finance/ticket-split.ts`, over the shared `split.ts`. It is
client-importable on purpose — the same arithmetic renders the buyer's preview
and produces the figures the server records — because two implementations would
eventually show a buyer one number and pay an act another.

```
chosenUnit      = the scale position, clamped to [floor, ∞)
ticketLineUnit  = min(chosenUnit, ticketPrice)            → the `ticket` line
contribution    = max(0, chosenUnit − ticketPrice) × qty  → `ticket_contribution`
totalCents      = chosenUnit × qty
chargeCents     = coverFees ? grossed up : totalCents
collectiveCents = the bar's position          (max: chargeCents − stripeFee)
actsCents       = chargeCents − collectiveCents − stripeFeeCents   ← derived
```

The acts' share is derived rather than computed independently, so the three
figures always add up to the charge and no cent can round its way into a gap.

Nothing posted by the client is trusted, including the arithmetic: the server
re-derives the whole split from the event's own price and floor, which are the
only figures in it the buyer does not control.

---

## Permissions

No new roles. The scale and the split are buyer choices on a flow already open to
guests; the recorded allocations are visible to staff only, through the existing
staff-guarded event production query. The floor is staff-only, on the event form
they already use.

**`source === 'cmc'` still holds.** CMC sells tickets only for its own events,
because money for someone else's show would land in CMC's account with no payout
path back to them. This spec builds the record of what is owed, not the path, so
the rule is unchanged.

---

## What changes

| Area                     | Change                                                                |
| ------------------------ | --------------------------------------------------------------------- |
| `event` schema           | Add `ticketPriceFloorCents`; backfill existing sellers to fixed price |
| `ticket` schema          | Add `actsCents`, `collectiveCents`, `feeCoveredCents`                 |
| `event-service`          | Floor validation beside `assertValidTicketPrice`                      |
| `ticket-split.ts`        | New, over the shared `split.ts`                                       |
| `purchaseTickets` remote | Scale + allocation fields; a free branch that skips Stripe entirely   |
| `ticket-service`         | `issueFreeTickets`, shared with `claimFreeTicket`                     |
| Purchase UI              | `TicketPurchaseFields` rewritten: amount, split bar, cover fees       |
| Member discount          | Removed from checkout, from the price displays, and from the copy     |
| Staff production page    | "Suggested price" + a floor field; acts/collective totals as sold     |

## What doesn't change

| Area                      | Notes                                       |
| ------------------------- | ------------------------------------------- |
| Where the money lands     | CMC's single Stripe account, as today       |
| Webhook fee derivation    | The contribution is still its own line item |
| Ticket status lifecycle   | These are money facts, not admission state  |
| Check-in, comps, capacity | Untouched                                   |
| Credits                   | Tickets still don't consume them            |

---

## Deferred

- **The payout record.** `sum(ticket.actsCents)` over an event's valid tickets is
  the acts' pool. Dividing it is a row on `event_band` shaped like
  `contractor_job`, plus tax-form intake at production prep.
- **Refund awareness.** Refunds are still a human in the Stripe dashboard, so
  every staff total here is labelled "as sold" and settlement reconciles against
  Stripe.
- **Contributions on free events.** `claimFreeTicket` still never touches Stripe.
