# Tickets

Ticketed events let the Corvallis Music Collective sell entry passes for shows
and performances. An event with ticketing enabled has a price and optional
capacity. Visitors purchase tickets through Stripe Checkout — with or without
an account — and receive unique codes for entry. Staff check people in at the
door using those codes.

This feature adds a `ticket` table, extends the `event` schema with ticketing
fields, and integrates with the existing payment service and webhook listener
pattern.

---

## Key concepts

**One table, not two.** There is no "ticket order" table. Each `ticket` row is
one entry pass. Tickets from the same purchase share a `purchaseId` (a UUID
generated at purchase time). The `purchaseId` is stored in Stripe session
metadata, so refunds and lookups work in both directions.

**Stripe is the payment ledger.** The app does not store pricing, totals, or
payment status locally. The ticket's `status` tracks admission state
(pending → valid → checked_in), not payment state. Payment state lives in
Stripe.

**Guest checkout.** Tickets can be purchased without an account. Guest
purchases store the buyer's name and email directly on each ticket row.
Authenticated purchases populate these from the user record but also store
the `userId` FK for "My Tickets" queries.

**Member discount.** Sustaining members (users with an active subscription)
get 50% off the ticket price. The discount is applied at Stripe Checkout via
a one-time coupon — no local discount tracking.

---

## Domain model

### Ticket

One entry pass for one event. Generated after successful payment (or
immediately for free tickets).

```
ticket
  id                  uuid pk
  eventId             uuid fk → event
  purchaseId          uuid          — groups tickets from the same checkout
  userId              uuid? fk → user — null for guest purchases
  attendeeName        text          — buyer/attendee display name
  attendeeEmail       text          — buyer/attendee email
  code                text unique   — 8-char alphanumeric (excludes 0, O, I, L, 1)
  status              text          — pending | valid | checked_in | cancelled
  checkedInAt         timestamp?
  checkedInByUserId   uuid? fk → user
  createdAt           timestamp
  updatedAt           timestamp
```

### Event (extended)

Three new columns on the existing `event` table:

```
ticketingEnabled    boolean default false
ticketPrice         integer?    — cents, required when ticketingEnabled is true
ticketQuantity      integer?    — max tickets available, null = unlimited
```

---

## Status lifecycle

```
pending ──────► valid ──────► checked_in
   │              │
   │              │
   ▼              ▼
cancelled      cancelled
```

- **pending** — tickets created but payment not yet confirmed (Stripe checkout
  in progress). Pending tickets are not counted toward capacity.
- **valid** — payment confirmed. Ticket is live and counts toward capacity.
  This is the only status that allows check-in.
- **checked_in** — attendee checked in at the event. Terminal state.
- **cancelled** — ticket voided (refund, order cancellation, or event
  cancellation). Terminal state.

---

## Purchase flow

### Authenticated user

1. User views event page, sees ticket section with price. If the user is a
   sustaining member, the discounted price (50% off) is shown alongside the
   base price.
2. User selects quantity (1–10, capped by remaining capacity).
3. User optionally checks "cover processing fees."
4. App generates a `purchaseId` UUID.
5. App calls `paymentService.checkout()` with:
   - Line items: `quantity × ticketPrice` (or discounted price for sustaining members)
   - `eligibleCredits`: none (tickets don't use credits)
   - `coverFees`: user's choice
   - `metadata`: `{ purchase_id, event_id, ticket_quantity, type: 'ticket' }`
   - `userId` and `stripeCustomerId` from the session
6. **If free** (100% discount covers the price): `checkout()` returns
   `{ paid: true }`. Tickets are created immediately with status `valid`.
7. **If paid**: `checkout()` returns `{ checkoutUrl }`. Tickets are created
   with status `pending`. User is redirected to Stripe Checkout.
8. On successful payment, the `checkout.session.completed` webhook fires.
   The ticket checkout listener finds tickets by `purchaseId` from session
   metadata and transitions them from `pending` → `valid`.
9. User lands on the success page showing their ticket codes.

### Guest (no account)

Same flow, but:

- User provides name and email before checkout.
- `userId` is null on the tickets.
- No Stripe customer ID — Stripe creates a guest checkout session.
- No member discount (guests are never sustaining members).
- No credit application.

### Cancellation

If the user abandons Stripe Checkout (clicks "back" or closes the tab):

- Pending tickets remain in the database.
- A cleanup job (or lazy cleanup on next page load) can cancel stale pending
  tickets after a timeout (e.g., 30 minutes). This is a deferrable concern.

---

## Refund flow

1. Staff views a ticket purchase (grouped by `purchaseId`) on the event
   detail page.
2. Staff clicks "Refund."
3. App looks up the Stripe checkout session by `purchaseId` in metadata (via
   Stripe API search or stored session ID).
4. App calls `paymentService.refund()` with the payment record ID from the
   session.
5. All tickets with that `purchaseId` are set to `cancelled`.

**Note:** Partial refunds (refunding some tickets but not others) are deferred.
Refunds are all-or-nothing per purchase.

---

## Check-in flow

1. Staff navigates to an event's check-in page.
2. Page shows all `valid` tickets for the event with attendee name, email,
   and code.
3. Staff can search/filter by code or name.
4. Staff clicks "Check In" on a ticket.
5. Ticket status transitions to `checked_in`, `checkedInAt` is set to now,
   `checkedInByUserId` is set to the staff user.

Check-in is one-way — there is no "un-check-in."

---

## Capacity enforcement

- Capacity = `event.ticketQuantity` (null means unlimited).
- Tickets sold = count of tickets for the event with status `valid` or
  `checked_in`.
- Remaining = capacity - tickets sold.
- The purchase page checks remaining capacity before allowing checkout.
- Pending tickets do NOT count toward capacity (they haven't paid yet).
- If capacity is exhausted between when the user loads the page and when
  payment completes, the webhook listener should still generate the tickets
  (Stripe has already charged them). Over-selling is preferable to charging
  someone and not giving them a ticket.

---

## Module boundaries

### Inside the events/ticket domain

- `ticket` schema (new table)
- `ticket-service.ts` — purchase, refund, check-in, code generation
- `checkout-listener.ts` — webhook handler for ticket fulfillment
- Email template stubs

### Integration points

- **Payment service** — `checkout()` for Stripe sessions, `refund()` for
  refunds. No changes needed to the payment service itself.
- **Webhook handlers** — register a ticket checkout listener via
  `onCheckoutComplete()`, same pattern as reservations.
- **Subscription service** — `getSubscription()` to check sustaining member
  status for discount eligibility.
- **Event service** — no changes. Ticketing fields are on the event but
  managed by the ticket service for purchase logic.

### What doesn't touch tickets

- Reservations, bands, credits, directory — no interaction.

---

## Schema

### ticket

```sql
CREATE TABLE ticket (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id             UUID NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  purchase_id          UUID NOT NULL,
  user_id              UUID REFERENCES "user"(id) ON DELETE SET NULL,
  attendee_name        TEXT NOT NULL,
  attendee_email       TEXT NOT NULL,
  code                 TEXT NOT NULL UNIQUE,
  status               TEXT NOT NULL DEFAULT 'pending',
  checked_in_at        TIMESTAMPTZ,
  checked_in_by_user_id UUID REFERENCES "user"(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ticket_event ON ticket(event_id);
CREATE INDEX idx_ticket_purchase ON ticket(purchase_id);
CREATE INDEX idx_ticket_user ON ticket(user_id);
CREATE INDEX idx_ticket_code ON ticket(code);
CREATE INDEX idx_ticket_event_status ON ticket(event_id, status);
```

### event (additions)

```sql
ALTER TABLE event
  ADD COLUMN ticketing_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN ticket_price INTEGER,
  ADD COLUMN ticket_quantity INTEGER;
```

No check constraint on `ticket_price` — validation that it's present when
`ticketing_enabled` is true happens at the application level (form
validation and service checks).

---

## Staff UI

### Event detail page (extended)

When an event has `ticketingEnabled`:

- Show ticket stats: sold count, remaining (or "unlimited"), revenue link to
  Stripe.
- Show ticket purchases grouped by `purchaseId` — each group shows attendee
  name, email, quantity, status, and a "Refund" button for valid/checked-in
  groups.

### Event create/edit form (extended)

- Toggle: "Enable ticketing"
- When enabled, show:
  - Price (required, in dollars, stored as cents)
  - Quantity limit (optional)

### Check-in page

Dedicated page at `/staff/events/[id]/check-in`:

- List of all tickets for the event (valid and checked-in).
- Search/filter by code or attendee name.
- "Check In" button on each valid ticket.
- Visual distinction between checked-in and not-yet-checked-in.
- Live count: "X of Y checked in."

---

## Member UI

### My Tickets page

New page at `/member/tickets`:

- Lists ticket purchases for the authenticated user.
- Grouped by event, showing event name, date, and individual ticket codes
  with status.
- Split into upcoming and past sections.

### Event page (public, extended)

When viewing a ticketed event:

- Shows price (and discounted price if sustaining member).
- Shows availability ("X tickets remaining" or "Tickets available").
- Purchase form: quantity selector, fee coverage checkbox.
- Guest info fields (name, email) when not logged in.
- "Sold Out" state when capacity exhausted.
- "Get Tickets" button → Stripe Checkout.

---

## Notifications (stubs)

These email templates should be stubbed out (template file with placeholder
content) but not wired to an email sending service:

- **Purchase confirmation** — sent to buyer after successful payment. Includes
  event name, date, ticket codes, and a link to view tickets.
- **Refund notice** — sent to buyer when staff refunds their purchase. Includes
  event name and refund amount.
- **Event cancelled** — sent to all ticket holders when an event is cancelled.
  Explains that refunds will be processed.

---

## Permissions

- **Purchase tickets**: any visitor (authenticated or guest).
- **View ticket purchases for an event**: staff only.
- **Refund a ticket purchase**: staff only.
- **Check in a ticket**: staff only.
- **Configure ticketing on an event**: staff only (same as event edit).

No new roles or permissions needed — this follows the existing staff/member
split.

---

## What changes

| Area                      | Change                                                                           |
| ------------------------- | -------------------------------------------------------------------------------- |
| `event` schema            | Add `ticketingEnabled`, `ticketPrice`, `ticketQuantity` columns                  |
| `event` create/edit forms | Add ticketing toggle, price, quantity fields                                     |
| Event detail page (staff) | Add ticket purchases section, refund action                                      |
| New schema                | `ticket` table                                                                   |
| New service               | `ticket-service.ts`                                                              |
| New webhook listener      | Ticket checkout listener (registers via `onCheckoutComplete`)                    |
| New routes                | Public purchase page, checkout success/cancel, staff check-in, member My Tickets |
| Member nav                | Add "My Tickets" link                                                            |

## What doesn't change

| Area                   | Notes                                                    |
| ---------------------- | -------------------------------------------------------- |
| Payment service        | Used as-is — `checkout()`, `refund()`, `cancel()`        |
| Webhook infrastructure | Listener pattern already exists, just register a new one |
| Subscription service   | Read-only usage to check sustaining member status        |
| Reservation system     | No interaction                                           |
| Bands module           | No interaction                                           |
| Credit system          | Tickets are not eligible for credit discounts            |

---

## Deferred

- **Door sales** — staff selling tickets in person (cash/card/comp). Needs a
  separate flow that skips Stripe Checkout.
- **Partial refunds** — refunding individual tickets within a purchase.
- **Email sending** — templates are stubbed but no delivery mechanism.
- **Stale pending cleanup** — cancelling pending tickets from abandoned
  checkouts.
- **Ticket transfer** — changing the attendee on a ticket.
- **QR codes** — generating scannable codes for faster check-in.
- **Event cancellation cascade** — auto-refunding all tickets when an event
  is cancelled (staff handles manually for now).
- **Ticket URL on event** — the Laravel app has an external `ticket_url` field
  for events that use third-party ticketing. Not needed yet.

---

## Open questions

None.
