# 0003 A production is a child of its listing

- **Date:** 2026-08-02
- **Status:** Accepted
- **Issue:** [#1133](https://github.com/corvmc/corvmc.org/issues/1133)

## Context

The app modelled only the public half of a CMC show: a listing with a title, times, a poster and
ticketing. The back of house (who plays in what order, load-in and curfew, what the acts were paid,
whether the room was reset) lived in spreadsheets. About one listing in ten is a CMC show; the rest
are other people's gigs at other venues, and partner imports widen that gap.

## Decision

1. **A `production` is a 1:1 child of one `event_listing`.** "Add production" is an action on an
   existing listing, never a second way to create a show. Public facts (title, poster, venue, doors)
   stay on the listing, and back-of-house facts go on the production. Sparsity justifies the
   separate table: its columns would be null on most rows of the gig guide's hottest query.
2. **The deal and the payout go on `production_slot`, a child of `event_band`** (amended
   2026-09-07). `event_band` stays public: name, billing and consent. The deal is
   `{ guaranteeCents, percentageBps, versus, againstNet }`, which covers a donated set, a flat fee,
   a split and a guarantee against the door.
3. **Settlement is derived, with no settlement table** (amended 2026-09-21). The acts' pool is what
   ticket buyers sent the acts plus the acts' share of the door, read from `financial_entry` by
   settlement group. A payout is recorded on the slot and in the ledger, and undone by reversing
   rows rather than edited.
4. **Door cash is recorded, never reported to Stripe.** Stripe's Payment Records API has no expense
   or payout object, so reporting door income would show the band cut as revenue CMC kept.

## Alternatives rejected

- **Production as the parent that creates its event.** It gave staff two front doors for one show.
- **A fixed 70/30 split in `production.bandSplitPercent`.** Ticket buyers now set the acts' share
  themselves, and a single percentage cannot express a donated set or a guarantee.
- **The deal on `event_band`.** Its money columns would be null on nine lineup rows in ten, and the
  listing's lineup editor would round-trip deal terms it has no business touching.
- **Settlement snapshot columns** (`ticketRevenueCents`, `bandPoolCents`, `netCents`, `settledAt`).
  They duplicate the ledger and need reconciling against it.
- **`production.venueId`.** Venue is a public fact and lives on the listing.

## Consequences

- A donated performance at a non-CMC event has nowhere to be recorded.
- Status moves are conditional updates with a row-count check, because D1 has no interactive
  transactions.
- Cancelling a listing cancels its production if the show has not yet happened.
