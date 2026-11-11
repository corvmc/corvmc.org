# NNNN A ticket row is one entry pass

- **Date:** 2026-05-14
- **Status:** Accepted

## Context

Ticketed events needed a way to sell entry to CMC shows through Stripe Checkout, with or without an
account, and to check people in at the door with a code. A purchase can hold several tickets.

## Decision

1. **One table, no order table.** Each `ticket` row is one entry pass. Tickets from one checkout
   share a `purchaseId`, which also goes into the Stripe session metadata, so a purchase can be
   found from either side.
2. **`ticket.status` is admission state, not payment state:** `pending → valid → checked_in`, or
   `cancelled`. A `pending` ticket does not count toward capacity.
3. **Guests can buy.** A guest purchase stores the buyer's name and email on each row, and
   `userId` stays null.
4. **Fulfilment never withholds a paid ticket.** The checkout webhook flips a purchase's pending
   rows to `valid` whatever the remaining capacity, because Stripe has already charged the buyer.
   Overselling is preferred to charging someone and issuing nothing.
5. **Codes are 8 characters** from an alphabet without `0`, `O`, `I`, `L` and `1`, so a code read
   at the door has no characters that look alike.

## Alternatives rejected

- **A `ticket_order` table beside `ticket`.** It would hold a quantity and a status that the ticket
  rows already answer. A second table is a second thing to keep in step.
- **Counting `pending` tickets toward capacity.** An abandoned checkout would hold seats nobody
  paid for.

## Consequences

- An order-level fact, such as a contribution or the buyer's allocation, is written on the
  purchase's first ticket only, so summing over a `purchaseId` counts it once.
- Abandoned checkouts leave `pending` rows. `cancelStalePendingTickets` sweeps them on the daily
  cron.
- Concurrent purchases can oversell capacity.
