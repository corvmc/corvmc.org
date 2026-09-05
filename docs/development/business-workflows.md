# Business Workflows, Traced Through Code

This guide walks through the core workflows of the app in plain language, with the
actual code path for each. Read the [architecture overview](../architecture/overview.md)
first — it explains the building blocks these workflows are made of (remote functions,
guards, the event bus, `db.batch`, site config).

Each section follows the same shape: **the story** (what happens, in plain English), **the
code path** (file → function for every step), **data touched**, and **where it breaks**
(what to check when this workflow misbehaves). The matching design spec in `docs/specs/` is
linked as the statement of intent — when code and spec disagree, treat the spec as intent
and reconcile deliberately.

---

## 1. Reservation booking, confirmation, and payment

Spec: [specs/reservation-system-spec.md](../specs/shipped/reservation-system-spec.md) ·
[specs/reservation-confirmation-window.md](../specs/reservation-confirmation-window.md) ·
[specs/staff-reservations-spec.md](../specs/shipped/staff-reservations-spec.md)

### The story

A member books a practice-room slot. Booking alone doesn't commit them — the reservation
sits in `scheduled` status until they **confirm** it (which spends any free-hour credits
and leaves cash due at the door) or **pay online** via Stripe. Members can only confirm
within the **confirmation window — 3 days before the start time** — but paying with a real
Stripe charge commits it any time. Anything still `scheduled` when its start time arrives
was never committed, so a cron job cancels it and frees the slot.

### Code path

**Booking.** The wizard on `/member/reservations` submits the `bookAndPayReservation` form
in `src/lib/remote/reservations.remote.ts`, which calls `create()` in
`src/lib/server/reservation/reservation-service.ts`. `create()`:

1. Validates the time range against operating hours and advance-booking limits —
   `validateBooking()` in `conflict-service.ts`, driven by KV site config
   (`reservation.operatingHoursStart`, `reservation.maxAdvanceDaysOneoff`, ...).
2. Checks for overlapping reservations, inserts the row with `status: 'scheduled'`, then
   **re-checks** for a race and deletes its own row if another booking landed concurrently
   (D1 has no transactions — this compensating-delete pattern is commented in the source at
   `reservation-service.ts:110`).

**Confirm (no online payment).** Submitting with `skipPayment` on: the remote checks
`withinConfirmationWindow(startsAt)` from `src/lib/config.ts`
(`CONFIRMATION_WINDOW_DAYS = 3`), then calls `commitCreditsAndSettleIfCovered()` (a helper
inside `reservations.remote.ts`). That commits free-hour credits via
`commitReservationCredits()` in `reservation-credit-service.ts`; if credits fully cover the
price, the reservation is settled and confirmed with `cashDueCents: 0`; otherwise it's
confirmed with the cash remainder recorded in `cashDueCents` for staff to collect at the
door.

**Pay online.** The remote commits credits the same way, then creates a Stripe Checkout
Session via `checkout()` in `src/lib/server/finance/payment-service.ts` with
`metadata: { reservation_id: res.id }`, and redirects the member to Stripe. Payment
completion comes back asynchronously:

```
Stripe → POST /api/stripe/webhook            src/routes/api/stripe/webhook/+server.ts
       → handleCheckoutCompleted()           src/lib/server/finance/webhook-handlers.ts
       → domainEvents.emit('checkout.completed', ...)
       → handleReservationCheckout(session)  src/lib/server/reservation/checkout-listener.ts
       → reservation status → 'confirmed', paidAt set, cashDueCents 0
```

The listener is idempotent (only transitions `scheduled`/`confirmed` rows), and the webhook
route returns 500 on handler failure so Stripe re-delivers.

**The other half of the lifecycle — cron.** Four endpoints under `src/routes/api/cron/`
(all `POST` with `Authorization: Bearer <CRON_SECRET>`, invoked by the Worker's own
`scheduled` handler on native Cloudflare cron triggers — see the operations manual):

- `cancel-unconfirmed` → `cancelUnconfirmedReservations()` in `reservation-service.ts` —
  cancels every reservation still `scheduled` at its start time.
- `auto-complete` → `autoCompleteExpired()` — marks confirmed, fully-paid reservations
  past their end time as `completed` (cash-owed ones are left for staff).
- `confirmation-reminders` / `reservation-reminders` — emit reminder events for
  reservations starting within 24 hours (notification listeners send the emails).

**Cancellation.** `cancel()` in `reservation-service.ts`: authorization (owner or staff
override), atomic conditional status update, Stripe refund if a payment record exists
(`refund()` in `payment-service.ts`), credit reversal
(`reverseReservationCredits()`), and finally emits `reservation.cancelled` — which the
waitlist listener uses to promote the next person (workflow 2).

**Staff resolution.** Unresolved reservations (past end, still `scheduled` or cash owed)
surface via `getUnresolvedReservations` in `reservations.remote.ts`; staff resolve with the
`completeReservation` / `noShowReservation` / `cashReceivedReservation` /
`compReservation` / `refundReservation` forms in the same file.

### Data touched

`reservation` table (status machine: `scheduled → confirmed → completed`, or `cancelled` /
`no_show` / `waitlisted`), `creditTransaction` ledger (free-hour commits and reversals),
`paymentCache`, plus Stripe objects (Checkout Session, PaymentIntent, Refund).

### Where it breaks

- **Member paid but reservation still `scheduled`** → the webhook didn't arrive or the
  listener failed. Check Stripe dashboard → webhook delivery attempts, and Sentry for
  `stage: 'handler'` captures from the webhook route.
- **"Time slot is not available" that looks wrong** → check the `waitlisted`/`cancelled`
  exclusions in the conflict query, and whether a `bookerType: 'event_listing'` reservation
  (created by an event) is holding the slot.
- **Confirm button rejected with the window message** → expected outside 3 days before
  start; only a Stripe charge (or staff) commits earlier.
- **Double-deducted credits** → shouldn't happen: `commitReservationCredits` is idempotent
  (keyed on the reservation). If suspected, read the `creditTransaction` ledger for the
  reservation id.

### The staff side

Staff work the same table from `/staff/reservations` (filterable list, with a resolve modal
and a create-on-behalf modal) and `/staff/reservations/[id]` (detail plus every action).
Three things differ from the member path:

- **Staff may override.** Conflicts and business-hours violations are warnings with an
  override, not refusals. `ConflictWarnings` currently conflates "overlaps a confirmed
  booking" with "outside operating hours" into one flag — see `CHORES.md`; a double-booking
  deserves louder treatment than a late night.
- **Staff confirm at any time.** The 3-day confirmation window is a member gate;
  `visibleActions` is staff-only and unchanged by it.
- **The resolve modal only surfaces unpaid reservations.** Paid ones auto-complete after
  their end time via the `auto-complete` cron, so they never reach the queue — which is why
  the queue is short enough to be worth working.

Cash settlement (`cashReceived`), comping, refunds and no-shows all live here, each as a
shared action component under `$lib/components/actions/`, so the member and staff
surfaces cannot drift in what they do — only in who may do it.

---

## 2. Recurring reservations and the waitlist

Spec: [specs/recurring-reservations-spec.md](../specs/shipped/recurring-reservations-spec.md)

### The story

Sustaining members can make a booking repeat (weekly, biweekly, monthly). The first
occurrence is a normal reservation that acts as the **prototype**; a nightly job clones it
forward into concrete rows. If an occurrence collides with an existing booking, it's
created as **waitlisted** instead; when the blocking reservation cancels, the waitlisted
one is offered the slot with a 24-hour window to confirm.

### Code path

- **Creating a series:** the booking forms in `reservations.remote.ts` (member and band
  variants) require a sustaining membership (a live `user.subscription`), then call
  `create()` in `src/lib/server/reservation/recurring-series-service.ts` with the prototype
  reservation id and an RRULE built by `buildRRule()` in `rrule-helpers.ts`. If the first
  slot itself conflicts, the booking is created via `createWaitlisted()` instead of failing.
- **Daily generation:** cron `generate-recurring-reservations` → `generateRecurring()` in
  `src/lib/server/reservation/generation-job.ts`. Events are expanded **before**
  reservations (recurring events book their own space reservations, which the reservation
  pass must treat as hard blocks — see the doc comment in that file). Occurrences that
  can't be booked emit `reservation.recurring_skipped` / `reservation.recurring_waitlisted`
  events so the member hears about it. The generation window is ~2.5 weeks
  (`reservation.maxAdvanceDaysRecurring` config, default 17.5).
- **Waitlist promotion:** `cancel()` emits `reservation.cancelled`; the listener in
  `src/lib/server/event-bus/register-listeners.ts` calls `promoteNextWaitlisted()` in
  `waitlist-service.ts` — oldest overlapping waitlisted reservation wins, gets
  `waitlistNotifiedAt`/`waitlistExpiresAt` set, and a `waitlist_slot_available`
  notification with a confirm link.
- **Member confirms the offered slot:** `confirmWaitlisted` form in
  `reservations.remote.ts` — checks the offer hasn't expired, re-checks the slot is free,
  flips to `scheduled`, then re-checks again and backs out if a competing booking raced in.
- **Expiry:** cron `expire-waitlisted` → `expireWaitlisted()` in `waitlist-service.ts` —
  cancels offers past their 24h window and promotes the next in line. It emits both
  `reservation.waitlist_expired` (the member's own notification) and
  `reservation.cancelled` carrying `cause: 'waitlist_expired'` — the row really was
  cancelled, and listeners on that event need to know. The two listeners that path
  already handles — the cancellation email and the promotion cascade — stand down on
  that `cause`; every other listener treats it as an ordinary cancellation.

### Data touched

`recurringSeries` (RRULE, prototype pointer, `supersededBy` chain), `reservation` rows
(status `waitlisted`, `waitlistNotifiedAt`, `waitlistExpiresAt`).

### Where it breaks

- **No new occurrences appearing** → the daily cron isn't firing. Hit the endpoint
  manually (see the [operations manual](../architecture/operations-manual.md#5-cron)) and
  check its JSON result — it reports per-series errors without aborting the batch.
- **Series stopped after subscription cancelled** → intentional:
  `handleSubscriptionDeleted` in `finance/webhook-handlers.ts` calls `cancelAllForUser()`.
- **Waitlisted member never notified** → check that the cancellation actually went through
  `cancel()` (a raw status update in the DB bypasses the event emit).

---

## 3. Membership: signup, subscription, monthly credits

Spec: [specs/membership-page-spec.md](../specs/shipped/membership-page-spec.md) ·
[specs/finance-spec.md](../specs/shipped/finance-spec.md)

### The story

Membership is free. A **sustaining membership** is a monthly Stripe subscription at a
member-chosen amount in $5 units. Each $5/month grants 1 free practice-room hour
(= 2 credits, since credits are 30-minute blocks) per billing cycle, plus
equipment-loan credit at $1 = $1. Credits arrive when Stripe collects each invoice, not
when the member signs up.

### Code path

1. **Signup:** `/membership` (public) or `/member/membership` → `createSubscription` form
   in `src/lib/remote/membership.remote.ts`. It guards against a duplicate live
   subscription, creates a Stripe customer on demand (`ensureStripeCustomer()` in
   `finance/stripe-customer-service.ts`), and redirects to Stripe Checkout built by
   `createCheckoutSession()` in `finance/subscription-service.ts` (`quantity` = dollars/5).
2. **Money arrives:** Stripe fires `invoice.paid` → `handleInvoicePaid()` in
   `finance/webhook-handlers.ts`:
   - finds the member by Stripe customer id;
   - finds the **contribution line** on the invoice (`findContributionLine()` — carefully
     excludes the fee-coverage line and prorations; read its doc comment before touching);
   - allocates credits via `allocateCreditsFromInvoice()` → `credit-service.ts`
     `allocateMonthlyCredits()` (free hours) and `allocateEquipmentCredits()` — **idempotent
     by invoice id**, so webhook re-delivery can't double-grant;
   - snapshots the subscription state onto the `user.subscription` JSON column
     (`hoursPerReset`, `creditsResetAt`, `coveringFees`, `cancelAtPeriodEnd`).
3. **Changes:** `updateAmount` / `resumeSubscription` forms in `membership.remote.ts` call
   `updateQuantity()` / `resume()` in `subscription-service.ts` and write-through to
   `user.subscription` so the page updates before the webhook lands. Cancel goes through
   the Stripe **billing portal** (`createBillingPortalUrl()`).
4. **Cancellation lands:** `customer.subscription.deleted` → `handleSubscriptionDeleted()`
   — zeroes both credit balances, cancels the member's recurring series, and clears
   `user.subscription`.

Note: "is this member sustaining?" is answered by `user.subscription != null` (see
`isSustainingMember` in `subscription-service.ts`), not by the `sustaining` role.

### Data touched

`user.stripeId`, `user.subscription` (JSON snapshot), `creditTransaction` ledger, Stripe
Subscription/Invoice objects.

### Where it breaks

- **Member paid but has no credits** → check Stripe webhook deliveries for `invoice.paid`,
  then the `creditTransaction` ledger for a `monthly_allocation` row with the invoice id.
  Staff can reconcile via the subscription sync (`finance/subscription-sync-service.ts`),
  which reuses `allocateCreditsFromInvoice` so both paths compute identically.
- **Credits doubled** → shouldn't be possible (idempotency by invoice id); if seen, look
  for two different invoice ids.
- **Wrong credit amount when member covers fees** → the fee line was mistaken for the
  contribution line; that's exactly what `findContributionLine()` guards against.

---

## 4. Bands: creation, invitations, premium pages

Spec: [specs/bands-spec.md](../specs/shipped/bands-spec.md) ·
[specs/staff-bands-spec.md](../specs/shipped/staff-bands-spec.md)

### The story

Any member can create a band and invite others. Invitees who already have accounts get an
in-app invitation; people without accounts get a **group invite** by email, which is
automatically resolved into a band membership the first time they log in after signing up.
Bands have their own role ladder (`owner > admin > member`) and can optionally buy a
premium subscription that unlocks a public band microsite.

### Code path

- **Create:** `member/bands` UI → `bands.remote.ts` / `band-page-editor` remotes →
  `create()` in `src/lib/server/band/band-service.ts` — a `db.batch` inserts the `band` row
  and the owner's `bandMember` row atomically; the slug is uniquified by
  `ensureUniqueSlug()`.
- **Invite:** `invite()` in `band-service.ts`. Existing users get a pending `bandMember`
  row + a `band.invitation_sent` event (email/in-app notification). Unknown emails go
  through `createInvite()` in `group-invite-service.ts` (a `groupInvite` row with a token)
  and a `group_invite.created` event that emails a signup link.
- **Invite resolution at login:** `src/hooks.server.ts` calls
  `resolvePendingInvites(userId, email)` once per session (tracked in the in-memory
  `resolvedSessions` set) — any `groupInvite` rows matching the user's email become real
  band memberships. This is why "invite someone with no account" just works after they
  register.
- **Accept/decline:** `acceptInvitation()` / `declineInvitation()` in `band-service.ts`
  (accept emits `band.invitation_accepted`, which notifies band admins).
- **Roles/ownership:** `transferOwnership()` (another `db.batch` — demote old owner,
  promote new), `leaveBand()` (owners must transfer first — `OwnerCannotLeaveError`).
- **Premium:** `band-subscription.remote.ts` → `createBandPremiumCheckout()` in
  `band-subscription-service.ts`. Fulfillment mirrors reservations: the
  `checkout.completed` bus event → `handleBandPremiumCheckout()` in
  `band-checkout-listener.ts`; ongoing state syncs from
  `customer.subscription.updated/deleted` webhooks via `syncFromWebhook()` (dispatched by
  `metadata.subscription_type === 'band_premium'`). The public microsite lives under
  `src/routes/band-site/[slug]/`, gated on the band's tier alone since the launch, with
  member-editable page config in `bandPageConfig` — custom CSS passes through `css-sanitizer.ts`.
- **Staff moderation:** `staff/bands` pages → the staff forms in `bands.remote.ts`
  (`deactivateBand`, `reactivateBand`, `updateStaffBand`, ...), all `requireStaff()`-guarded.

### Data touched

`group`, `groupMember`, `groupInvite`, `bandPageConfig`, `bandMedia`, Stripe subscription
(band premium).

### Where it breaks

- **Invite email never became a membership** → the email on the invite must match the
  login email exactly; check `groupInvite` rows and whether `resolvePendingInvites`
  errored (it's fire-and-forget in hooks with `captureException` — look in Sentry).
- **Premium page not appearing** → the band's `band_site.tier` is not `premium`, so
  subscription state didn't sync — check the `customer.subscription.*` webhook deliveries
  and `syncFromWebhook`.

---

## 5. Events and tickets

Spec: [specs/tickets-spec.md](../specs/shipped/tickets-spec.md)

### The story

Staff and bands both create events. Publishing makes an event
visible on the public site. Ticketed events sell through Stripe — guests can buy without an
account — and each ticket gets a unique code rendered as a QR for door check-in. Free
events use RSVP instead.

### Code path

- **Two staff surfaces, one table, and the URLs say which is the general case.** `/staff/events`
  is the **Calendar** — `getStaffCalendar` → `listStaffCalendar()`, every source, public
  statuses plus `pending_review`, forward from today — the staff view of the public gig guide,
  where listings are moderated. `/staff/productions` is the CMC work index, `source='cmc'` at
  every status via `getStaffEvents` → `listAll()`, and the only page holding drafts. A
  published CMC show is on both. The date floor applies only to rows actually on the calendar,
  so a `pending_review` listing whose date passed stays reachable and keeps agreeing with the
  sidebar badge (`countPendingSubmissions`, which has no date filter).
- **The detail view is layered the same way.** `/staff/events/[id]` is the general view for
  every source — facts, the bill, the event's lifecycle actions, and a two-hour window of what
  else is on (`listEventsNear`). It sits at the address `entity-href` resolves every event ref
  to, so a staffer arriving from a shift, a reservation or a notification lands on the
  least-privileged useful view. `/staff/events/[id]/production` is the console — the full edit
  form, ticketing, the ticket ledger, poster upload, the room, volunteer shifts — and redirects
  to the general view for a non-CMC row. Privilege is additive at the deeper address, which is
  what makes it gateable later without re-pointing every inbound link.
- **Staff lineup edits carry a consent rule.** `setStaffEventLineup` passes
  `asStaff: source === 'cmc'`. Staff booked a production, so acts they name there are already
  agreed; on a member's listing a newly linked act stays `pending` and the band is invited,
  because staff cannot agree on a band's behalf. Either way `setEventLineup`'s prior-row branch
  runs first, so a `declined` credit stays declined.
- **Create/publish:** `staff/events` UI → `createEvent` / `publishEvent` / `updateEvent`
  forms in `src/lib/remote/events.remote.ts` → `create()` / `publish()` / `update()` in
  `src/lib/server/event/event-service.ts`. Events that reserve practice space create a
  linked `bookerType: 'event_listing'` reservation; `checkRebookNeeded()` handles time changes.
  Recurring events expand nightly via the same generation job as reservations (workflow 2).
- **Purchase:** public event page → `purchaseTickets` form in `events.remote.ts` — creates
  `pending` tickets via `createTickets()` in `ticket/ticket-service.ts` under a fresh
  `purchaseId`, then opens Stripe Checkout with
  `metadata: { type: 'ticket', purchase_id }`. Fulfillment:
  `checkout.completed` bus event → `handleTicketCheckout()` in
  `ticket/checkout-listener.ts` → `fulfillPurchase(purchaseId)` flips the purchase's
  tickets `pending → valid` and emits `ticket.purchased` (confirmation email with codes).
- **What the buyer chooses, and what the row remembers.** The 50% sustaining-member rate is a
  default, not a rule: `waiveDiscount` on the form charges full price for that purchase, and the
  ticket records `discountWaived` so a waiver stays legible after the fact (a non-member checking
  the box waives nothing — `discountWaived` is derived from whether a discount actually applied).
  An optional `contribution` becomes a second line item under the `ticket_contribution` product,
  never a bigger ticket price. Both purchase surfaces — the public `/events/[id]/tickets` page and
  the member event page's `<Action>` modal — render the same `TicketPurchaseFields` component, so
  the total they preview is the total Stripe charges; fee coverage is computed on the ticket
  subtotal _plus_ the gift, because that is what Stripe takes its cut of.
- **The receipt has to unpick the charge.** `handleTicketCheckout` has no line-item breakdown to
  read, so it derives fees by subtracting the known parts from `amount_subtotal`. The contribution
  is one of those parts (`ticket_contribution_cents` in the session metadata) and must come out
  before the remainder is called fees — otherwise the buyer's confirmation email reports their gift
  back to them as a processing charge. Guarded by `checkout-listener.spec.ts`.
- **NOTAFLOF is still a door policy.** Checkout cannot sell a $0 ticket, so the purchase page says
  so in as many words and staff `compTickets` remains the mechanism for a free ticket.
- **Check-in:** `staff/events/[id]/check-in` → `checkInTicket` form → `checkIn()` in
  `ticket-service.ts` (records who checked in and when; rejects reused codes).
- **Cancellation:** `cancelEvent` → `event-service.cancel()` — collects ticket holders and
  emits `event.cancelled` so every holder is notified with the refund note.
- **RSVP / comps:** `event/rsvp-service.ts`; staff `compTickets` form creates valid
  tickets with no charge.

### Data touched

`event_listing`, `ticket` (status: `pending → valid → checked_in`, or `cancelled`; plus the money the
purchase settled at — `unitPriceCents`, `contributionCents` on the purchase's first row only, and
`discountWaived`), `eventRsvp`, linked `reservation` rows for space-holding events.

### Where it breaks

- **Buyer charged but tickets still `pending`** → same webhook triage as reservations
  (workflow 1). `fulfillPurchase` is idempotent per purchase.
- **Ticket count oversold** → `getTicketsRemaining()` is checked at purchase time; look
  for concurrent purchases racing the check (same D1 no-transaction caveat).
- **QR won't scan at the door** → the code is also printed as text; `checkIn` can be
  driven from the search box on the check-in page.

---

## 6. Inventory, gear and consumables

Spec: [specs/inventory-spec.md](../specs/inventory-spec.md)

### The story

The collective tracks two kinds of physical thing on one ledger. **Gear** — amps,
guitars, PAs, mics — is lent to members and comes back. **Consumables** — strings,
sticks, batteries — leave and do not.

Members browse the catalog, request an item for a weekend, and staff schedule a
pickup, hand it over and take it back. Charges are computed at return from days
borrowed × a per-tier daily rate, discounted for sustaining members, payable from
equipment credits first and cash for the rest. Both surfaces are always on — the
`equipment` flag was cut in #286, since a flag whose only job was hiding a module
nobody had entered data into stopped being useful the moment the data model was
worth using.

### The rule everything rests on

**Stock is a ledger, not a number.** Every change to what the collective holds is
an append-only `stock_movement` row — a signed quantity, a reason, a time, an
actor. On-hand is the sum of those rows and is never stored. A stocktake
correction is itself a movement, with reason `adjust`.

The predecessor kept `equipment.totalQuantity` as an integer somebody typed,
which is why consumables could not be tracked at all: the only way to record a
pack of strings being opened was to overwrite the count.

Two axes, deliberately separate:

- `inventory_item.kind` — `serialized` (one `inventory_asset` row per physical
  unit) or `bulk` (a count).
- `inventory_item.isLoanable` — whether it comes back.

A **consumable is a bulk item that is not loanable**, derived and never stored.
Twelve XLR cables are bulk _and_ returnable, which is why one enum could not
carry both.

### Code path

Services live in `src/lib/server/inventory/`, driven by `inventory.remote.ts`:

- `stock-service.ts` — the ledger. Nothing else writes `stock_movement`.
  `signedQuantity` applies the direction from `STOCK_REASON_SIGN`, so a caller
  can never pass a negative `receive`. A transfer is written as a **matched
  pair** (`-n` at the origin, `+n` at the destination) so it nets to zero in
  every sum without any query filtering it out.
- `item-service.ts` — catalog and categories. `kind` is not updatable.
- `asset-service.ts` — one physical unit. Tags are **bound, not generated**; an
  asset's identity is the row, never the sticker, so a lost tag is a rebind.
  Retirement writes a movement rather than deleting.
- `acquisition-service.ts` — receiving. All arrivals go through an acquisition.
- `loan-service.ts` — the five-state machine, unchanged from the shipped module:

```
requestLoan()  member asks; emits equipment.loan_requested (staff notified)
   ↓ scheduleLoan()   staff sets pickup date; emits equipment.loan_scheduled
   ↓ checkoutLoan()   staff hands over a *specific unit*; writes loan_out;
                      emits equipment.checked_out
   ↓ returnLoan()     staff take it back; writes loan_return; computes charge,
                      settles credits/cash; emits equipment.returned
   (cancelLoan() from the pre-checkout states)
```

Pricing helpers `calculateDailyRate()` / `calculateLoanCharge()` are pure
functions; rates come from `$lib/config.ts` (`DAILY_RATE_MAJOR`,
`DAILY_RATE_ACCESSORY`). Invalid transitions throw `InvalidLoanTransitionError`;
checking out a serialized item without naming a unit throws
`AssetRequiredError` — the checkout form asks which unit is being handed over,
and a unit already bound to the loan satisfies it. Equipment credits are the same ledger as free hours
(`credit-service.ts`, type `equipment_credits`).

### Replenishment and spend

A `bulk` item can carry a reorder point. `listLowStock()` in `stock-service.ts`
returns everything at or below it, emptiest first, with a `suggestedOrder` (the
reorder quantity where one is set, otherwise enough to reach the point) and an
`isOut` flag. It surfaces twice: the top five on the staff dashboard, and the
whole list at `/staff/inventory/restock`, grouped by category with a Receive
action per row so a shop trip can be recorded from the list it came off.

`/staff/inventory/spend` reports purchase spend per category over a window
(default: the current calendar year) via `spendByCategory()`. **Donations and
grants are excluded** — a gift is not spend, and counting one would overstate the
budget by exactly what was given. `inKindContributions()` exists for the
gifts-in-kind disclosure and still has no screen: ASU 2020-07 binds the financial
statements rather than the organisation, and CMC has never been asked for a GAAP
statement.

### Acquisitions

`/staff/inventory/acquisitions` is what arrived, from whom, and for how much;
`/staff/inventory/acquisitions/[id]` is one of them. Receiving has written these
rows since Phase 1, but nothing read them back until this existed — and that gap
is why several columns sat permanently empty in production. A Form 8283 is signed
weeks after a gift walks in, so capturing it only at the door captured it never.

- `acknowledgeForm8283()` sets `acknowledgedAt` / `appraisalRef`. **This is the
  switch that arms Form 8282** — see below.
- `updateAcquisition()` amends the rest, including `fairValueCents` and
  `monetized`, the flag that splits the ASU 2020-07 disclosure into monetized and
  utilized gifts.
- **The lines are read-only.** They have already emitted their `receive`
  movements; rewriting a quantity would put the ledger and the paperwork into
  permanent disagreement. A miscount is an `adjust` movement, like every other
  stock error.

**Reimbursement.** `paidByUserId` records who fronted the money — distinct from
`recordedByUserId` (who typed the row in) and `donorUserId` (who gave the goods),
because a volunteer who _buys_ strings is owed for them and one who _donates_
strings is not. `markReimbursed()` stamps `reimbursedAt`, and is idempotent by
intent: re-marking keeps the original date rather than moving it, so a double
click cannot falsify when somebody was actually paid. The app moves no money; it
records that a person did, the same shape as `resolveForm8282`. Receipts attach
through the shared media layer under a `receipt` slot on `attachableType:
'acquisition'` — no table of their own.

Both queries are covered by `src/lib/server/inventory/reports.spec.ts`, which
runs them against a real in-memory SQLite rather than a mocked `db` — a mock
returns whatever the test told it to and cannot catch a wrong `GROUP BY`.

### Attached resources and damage reports

Documentation hangs off the **catalog entry** — the manual for a K12.2 is the
manual for all four — and evidence hangs off the **unit**. Both go through the
shared media layer (`media` + `media_attachment`, #289) rather than a table of
this module's own: `attachableTypes` gained `inventory_item` and
`inventory_asset`, `mediaSlots` gained `manual` and `damage`.

Tutorials are `help_article` rows joined by `inventory_item_article`, not prose
of their own — help articles already carry publish state, `minRole`, a category
and a sync path. The member view filters to published, so a draft imported by
`help:sync` cannot leak to whoever scanned the amp.

A damage report is a **ledger entry, not a report table**:
`reportDamage()` in `resources-service.ts` changes the unit's condition and
writes a `repair_out` movement carrying the note and the reporter. There is no
queue because the movement history already is one. It takes the unit out of
service immediately on a member's say-so — the cost of a wrong report is a
staffer clicking it back, the cost of leaving a broken amp bookable is the next
member's session, and `actorId` makes a pattern attributable.

**Where it breaks** — a report appears to do nothing: check the form validated.
A select's empty option submits `''`, which `z.enum([...]).optional()` rejects,
and a remote `form()` that fails validation runs no handler at all.

### Form 8282

Disposing of donated property within three years of receipt can oblige the
collective to file IRS Form 8282 within 125 days, with a copy to the donor.
`src/lib/server/inventory/form-8282.ts` holds the rule as a pure function with
`now` injected; `listForm8282Obligations()` narrows candidates in SQL (donated,
disposed, unresolved) and applies the window in JS so the rule lives in one
place.

It surfaces on the unit's page when it is retired and on
`/staff/inventory/compliance` thereafter. Resolving it writes
`form8282ResolvedAt` plus a free-text `form8282Note`, which covers both "filed"
and "no filing was due, because…".

**Where it breaks** — nothing appears when expected, in order of likelihood:

- **No Form 8283 is recorded against the acquisition.** This is the usual answer
  and it is usually correct: an unsigned gift is not "charitable deduction
  property" and owes nothing. Sign it on the acquisition page if one really was
  signed. Until #302's follow-up there was no way to record it at all, so every
  disposal landed in the `noFormOnRecord` count and the page always read zero.
- The asset carries no `acquisitionId`, or its acquisition is not a donation. A
  unit created directly rather than through receiving has no acquisition, so the
  system cannot know it was a gift.

### Scanning a tag

`/a/[tag]` renders nothing. Its `+page.server.ts` resolves the tag and hands the
routing decision to `entityHref` — the same policy the identity chips use — so
staff get `/staff/inventory/assets/[id]` and a member gets
`/member/equipment/assets/[id]`. A signed-out scan has no public arm to land on,
so it redirects to `/login?redirect=…` rather than 404ing. A `load` rather than
a remote function because it is navigation, not data: a phone camera should get a
302 off the server, not a blank page that redirects after hydration.

**Staff scan in the app**, through `BarcodeScanner` (`barcode-detector`, ZXing
via wasm, imported dynamically so the module stays out of the SSR graph). It
appears at tag binding, the inventory search and loan checkout — always _beside_
the field it fills, never instead of it, since a USB barcode wedge already types
into those fields and every camera failure has to degrade to typing.

`parseScan()` in `src/lib/utils/scan.ts` decides what came back: a tag QR carries
the whole `/a/{tag}` URL (that is what makes a phone camera resolve it), while a
consumable's own barcode is a bare GTIN. The two read different columns, so
guessing wrong looks up the wrong record. A digit run that is not a GTIN length
comes back as unknown rather than assumed — it is far likelier to be a serial
number.

### Data touched

`inventory_item`, `inventory_asset`, `stock_movement`, `inventory_loan`,
`acquisition`, `acquisition_line`, `inventory_location`, `equipment_category`
(unchanged), `media` + `media_attachment` (manuals, damage photos, receipts),
`creditTransaction` (equipment credit spends).

### Where it breaks

- **"Only N available"** → for a serialized item, availability is the count of
  units with `status='in_service'`, not the ledger sum: an amp in `maintenance`
  is on hand and unavailable. For bulk it is on-hand minus quantities held by
  `scheduled` loans.
- **On-hand looks wrong** → read `stock_movement` for the item. It is the whole
  answer; there is no cached figure that could be stale.
- **A serialized item's on-hand disagrees with its unit count** → that invariant
  should hold. A mismatch means something wrote a movement without an asset, or
  an asset without its `receive`.
- **"Tag is already bound"** → `AssetTagTakenError`; another unit wears it.
  Rebinding _that_ unit is the fix, not renumbering this one.
- **Charge looks wrong** → recompute with `calculateLoanCharge()`'s inputs: days
  borrowed, tier, sustaining status at return time. Days are `Math.ceil`'d, so a
  loan out for a whole number of days plus a minute bills the next day.
- **A checkout submit appears to do nothing** → `scheduleLoanSchema` and
  `checkoutLoanSchema` validate `itemId` / `assetId` with `z.uuid()`, and both
  arrive as hidden inputs. A non-UUID id fails validation with nowhere to render
  the error, so the form silently goes nowhere.

---

## 7. Marketing campaigns

Spec: [specs/email-marketing-spec.md](../specs/shipped/email-marketing-spec.md)

### The story

Staff compose email campaigns, pick audiences (rule-based or manual lists of subscribers),
and either send immediately or schedule. A frequent cron sweeps for due campaigns and sends
them through Postmark's **broadcast** message stream (separate from transactional mail, so
newsletter complaints can't hurt receipt deliverability). Every recipient gets a signed
unsubscribe link.

### Code path

- **Compose/schedule:** `staff/marketing` UI → `marketing.remote.ts` →
  `campaign-service.ts`: `createCampaign()`, `scheduleCampaign(id, when)`, `sendNow(id)`.
  Status is derived, not stored: `deriveCampaignStatus()` maps
  (`scheduledFor`, `sentAt`) → `draft | scheduled | sending | sent`.
- **Audiences:** `audience-service.ts` + `subscriber-service.ts`;
  `getRecipientsForCampaign()` resolves and dedupes recipients at send time.
- **The send:** cron `send-campaigns` (`src/routes/api/cron/send-campaigns/+server.ts`) →
  `processDueCampaigns()` → `executeSend(campaignId)` — renders per-recipient HTML into the
  campaign layout, a hand-maintained TS constant in `marketing/campaign-layout.ts` kept
  identical to the Postmark-hosted transactional layout, and sends via the Postmark client
  (`notification/email/postmark-client.ts`, broadcast stream).
- **Unsubscribe:** `/unsubscribe` route under `(public)`, links signed with
  `MARKETING_UNSUBSCRIBE_SECRET` (see `marketing/unsubscribe` service code).

### Where it breaks

- **Scheduled campaign never sent** → the cron isn't running.
  `processDueCampaigns()` picks up anything with `scheduledFor <= now` and
  `sentAt IS NULL`, so a late cron still sends (late).
- **Broken layout** → `marketing/campaign-layout.ts` is a plain source file, not generated;
  the bug is in that file directly, not in a build step.

---

## 8. Support inbox

### The story

Inbound email (to the support address), contact-form submissions, and SMS all land in a
unified staff inbox as threaded conversations. Staff reply from the app; replies go out
through Postmark (email) or Twilio (SMS). Every inbound message notifies all staff. Behind
the retired `staffInbox` feature flag, which never guarded anything. (A Meta/Messenger handler exists but the Meta integration is
not provisioned.)

Contact-form ('web') threads reply **by email** — the submitter gave us their address, and
the reply carries a plus-addressed `Reply-To` so their response threads back into the same
conversation. The thread stays `channel: 'web'`; that provenance is what the staff UI shows,
and re-labelling it `email` would let unrelated mail from the same address merge into it.

### Code path

- **Inbound email:** Postmark inbound webhook → `src/routes/api/inbox/postmark/+server.ts`
  (authenticated with `POSTMARK_INBOUND_TOKEN`) → `handlePostmarkInbound()` in
  `src/lib/server/inbox/inbound-handlers.ts`.
- **Inbound SMS:** Twilio webhook → `src/routes/api/inbox/twilio/+server.ts` →
  `handleTwilioInbound()`.
- **Contact form:** the public `/contact` page also funnels in via `handleContactForm()`,
  which additionally emits `contact.form_submitted` → an alert email to `STAFF_CONTACT_EMAIL`.
- All three thread the message via `thread-service.ts` / `message-service.ts` (match on
  sender address/number, else create a thread) and emit `inbox.message_received` — the
  listener in `events/register-listeners.ts` notifies every staff user, linking to
  `/staff/inbox/<threadId>`.
- **Replies:** `staff/inbox` UI → `inbox.remote.ts` → outbound via the channel's client
  (`notification/email/postmark-client.ts` or `inbox/twilio-client.ts`), recorded with an
  `inbox.message_sent` event.
- **Reply round trip (email + web):** `channel-dispatcher.ts` attaches a `Reply-To` built by
  `inbox/reply-address.ts` (`reply+<threadId>.<hmac>@…`). The contact's response reaches
  Postmark Inbound, which parses the part after the `+` into `MailboxHash`;
  `handlePostmarkInbound()` verifies the signature and appends to that exact thread,
  reopening it if it was resolved. No hash → find-or-create by sender address, but only when
  the `email` channel is enabled.

### Where it breaks

- **Inbound mail not appearing** → check the Postmark server's inbound webhook URL and
  token, then Sentry. Same for Twilio's messaging webhook config.
- **Staff not notified** → the notification dispatcher respects per-user preferences
  (`notification/preference-service.ts`); check the staff user's settings before suspecting
  the listener.
- **Outbound SMS failing** → `TWILIO_PHONE_NUMBER` is intentionally unset until
  provisioned (see the comment in `wrangler.toml`).
- **A contact's reply started a new thread instead of continuing theirs** → check the
  message's `channelMetadata.unresolvedMailboxHash`. Present means the address survived but
  the signature failed (usually `INBOX_REPLY_SECRET` / `POSTMARK_SERVER_TOKEN` changed since
  the reply went out); absent means the `+hash` never made it back, so check the MX record
  and Postmark's inbound activity view.
- **Replies going to the wrong place** → `INBOX_REPLY_ADDRESS` unset silently degrades to
  `Reply-To: STAFF_CONTACT_EMAIL`. That's the intended pre-MX state, not a bug.

---

## 9. The gig guide and community listings

Spec: [specs/community-calendar-spec.md](../specs/shipped/community-calendar-spec.md) ·
[specs/community-events-spec.md](../specs/shipped/community-events-spec.md) ·
[specs/event-lineup-spec.md](../specs/shipped/event-lineup-spec.md) ·
[specs/event-moderation-spec.md](../specs/shipped/event-moderation-spec.md)

### The story

`/events` is one gig guide across three layers, and the layer an event belongs to is a
single column: `event.source` is `cmc` (staff-created), `band` (published by a band admin
from the band panel), or `community` (authored by any signed-in member for a show at
another venue). Nothing else about the row changes between layers — the same table, the
same detail page, the same poster.

`event.kind` answers a different question, and the two are easy to confuse: `source` is
whose listing it is, `kind` is what the thing _is_ — `show`, `work_party`, `meeting` or
`class`. Everything on the guide is a listing; only some of it is a show. Work parties and
monthly deep cleans get listings because they need advertising as much as a gig does, and
the moment they exist `source = 'cmc'` stops being a usable stand-in for "this is a show".
So the three surfaces that mean shows rather than listings — `listUpcoming()` behind the
homepage posters, `getShowTonight()`, and `listPast()` — filter on `kind` as well. The
public guide deliberately does not, which is what keeps the work party advertised. A
recurring series inherits `kind` from its prototype, so a monthly deep clean does not
generate twelve shows.

Who may publish differs by layer, and that is the whole moderation model. CMC events are
staff work; band events are gated to band admins; community listings publish **directly**,
with no queue, until a report against that member is upheld — after which their later
listings go to review first. Publishing is reactive-moderated, not pre-approved, because a
queue nobody works is worse than a listing nobody reported.

Separately, an event credits the acts on the bill. `event.bandId` is **ownership** — whose
panel it lives in and who may edit it — and `event_band` is **attribution**, who actually
played. A credited band is a plain text credit until it confirms, so nobody can put a band
on a bill and have it appear on that band's own profile without their say-so.

### Code path

- **The guide:** `(public)/events` → `calendar.remote.ts`: `getPublicGigGuide({from, offset})`
  for the poster-forward list and `getPublicCalendar({month})` for the mini-calendar
  date-jumper. Both read across all three sources; `idx_event_source` on
  (`source`, `status`, `startsAt`) is the index they are written for.
- **Member authoring:** `/member/events/submit` and `/member/events/[id]/manage` →
  `community-events.remote.ts` → `event/community-event-service.ts`:
  `createCommunityEvent()` (always a draft), `updateCommunityEvent()`, then either
  `publishCommunityEvent()` — which checks standing and routes to `visible` or a pending
  submission — or `withdrawCommunityEvent()` / `deleteCommunityEventDraft()`.
  `checkForDuplicate()` runs before create so two people announcing the same show notice
  each other.
- **Staff review of submissions:** `getPendingSubmissions()` / `countPendingSubmissions()`
  feed the queue; `approveSubmission()` and `rejectSubmission()` decide. A rejected listing
  stays editable and republishable — that is deliberate, and `listRejectedForUser()` is how
  the author finds it again.
- **Lineups:** `event-service.ts`: `setEventLineup()` writes `event_band` rows,
  `getEventLineup()` / `getEventLineups()` read them (the plural batches, for lists),
  `listBandLineupInvites()` is the band panel's invite inbox, and
  `confirmLineupSlot()` / `declineLineupSlot()` are the band's only two answers.
  `linkLineupSlot()` attaches a previously text-only credit to a real band.
- **Moderation:** `flags.remote.ts`: `submitEventReport()` files against `entityType:
'event'`; upholding in `/staff/flags/[id]` can `unpublishWithNotice()` in the same step,
  which notifies every band on the bill rather than only the owner.

### Data touched

`event_listing` (`source`, `status`, `startsAt`, `bandId`, `submittedByUserId`), `event_band`,
`content_flag`, `member_standing` (scope `community_event`).

### Where it breaks

- **A listing published straight through when you expected review** → check
  `member_standing` for that user at scope `community_event`. Absence of a row is good
  standing, which is the overwhelmingly common case and the default every reader assumes.
- **A band's gig is missing from its profile** → the `event_band` row is probably still
  unconfirmed. An unconfirmed credit renders as text on the event and appears nowhere on
  the band.
- **A cancelled event vanished instead of showing as cancelled** → cancelled events are
  meant to stay on the guide until their date passes, so anyone who already had the date
  finds out. Deleting is the wrong verb; check whether the caller cancelled or deleted.

---

## 10. Messaging: portal threads and direct messages

Spec: [specs/member-portal-chat-spec.md](../specs/shipped/member-portal-chat-spec.md) ·
[specs/direct-messages-spec.md](../specs/shipped/direct-messages-spec.md)

### The story

`/member/messages` shows a member every conversation they are in — with staff, and with
other members — as one list. It is one list because both kinds are participant-based:
`inbox_participant` scales from one signed-in party (a portal thread, where the other side
is "staff" collectively) to two (a direct message). The transport is the same staff inbox
described in §8; member↔staff threads land there as `channel: 'portal'` and staff answer
them with the tools they already use.

Direct messages are almost entirely a safety layer on top of that transport. A first
message is a **request**: one message, no notification, and no signal back to the sender
about what happened to it. A decline, a block, messaging switched off, and simply not
opening it are all indistinguishable from the outside — which is the point, because a
visible decline is one people hesitate to make.

### Code path

- **The list:** `/member/messages` → `direct-messages.remote.ts`: `getMyMessages()` →
  `inbox/direct-service.ts`: `listMemberConversations()`, which returns both kinds from a
  single query.
- **Portal threads:** `inbox.remote.ts`: `startConversation()` → `inbox/portal-service.ts`:
  `startPortalConversation()`, `replyToPortalThread()`, `markPortalThreadRead()`. Staff
  answer from `/staff/inbox` exactly as in §8.
- **Starting a DM:** `startDirectConversation()` → `direct-service.ts:startDirectThread()`.
  Every rejection except one comes back as a plain success — the exception is a member whose
  own standing forbids it, who is entitled to know and to read the staff reason.
- **Consent:** `acceptDirectRequest()` / `declineDirectRequest()` →
  `acceptDirectThread()` / `declineDirectThread()`. Declining closes the thread **and**
  blocks the sender, silently.
- **Blocks:** `moderation/moderation-service.ts`: `blockUser()`, `unblockUser()`,
  `isBlockedEitherWay()` — one row covers both directions, and it is enforced on send,
  reply and accept but deliberately **not** on read, since the person who blocked still
  needs the conversation in order to report it.
- **Member switch:** `user.acceptsDirectMessages` via `setAcceptsDirectMessages()`, surfaced
  on `/member/account`. This is the member's own preference and is not `member_standing`.
- **Reporting:** `reportDirectThread()` verifies participation before filing, because filing
  the flag is what makes a private conversation readable by staff.

### Data touched

`inbox_thread`, `inbox_message`, `inbox_participant`, `user_block`,
`user.acceptsDirectMessages`, `member_standing` (scope `messaging`), `content_flag`.

### Where it breaks

- **A message "sent" but never arrived** → usually working as designed. Check
  `user_block` both ways, `acceptsDirectMessages`, and `member_standing` at scope
  `messaging` before suspecting delivery.
- **Requests not showing in the nav badge** → they never do. An unconsented message must not
  follow anyone around the site; the count renders on the Messages page only.
- **A staff reply reads as anonymous** → the staff inbox orients bubbles by `outbound`
  rather than by author, so a colleague's reply reads as the organisation's. That is
  deliberate (see `member-portal-chat-spec.md`) and pinned from both sides by
  `ThreadTimeline.svelte.spec.ts` — do not flip the axis to "fix" it.

---

## 11. Moderation: reports, standing, and the suggestion board

Spec: [specs/member-standing-spec.md](../specs/shipped/member-standing-spec.md) ·
[specs/member-suggestions-spec.md](../specs/shipped/member-suggestions-spec.md) ·
[specs/event-moderation-spec.md](../specs/shipped/event-moderation-spec.md)

### The story

One report queue covers everything members write: profiles, bands, event listings,
suggestions, and reported conversations. A staffer either **dismisses** — which costs the
reported member nothing at all — or **upholds**, which is the only action that moderates
anything.

Upholding produces two independent decisions: what happens to the post, and what happens to
the person. The second is `member_standing`, keyed on (`userId`, `scope`) rather than on
`userId` alone, so an upheld report about a gig listing does not put someone on probation
for suggestions. **Absence of a row means good standing** — that is the common case and the
default every reader is built around — and lifting writes `status: 'none'` rather than
deleting, so "we looked at this and cleared it" stays distinguishable from "this never came
up."

The suggestion board is the same machinery applied to a different surface: reporting a
suggestion pulls it off the board pending review, and an upheld report puts the author's
later suggestions through review first.

### Code path

- **Filing:** `flags.remote.ts`: `submitFlag()` for profiles and listings (narrowed to
  `memberReportableEntityTypes`, **not** the full `flagEntityTypes`),
  `submitEventReport()` for events, `suggestions.remote.ts:flagSuggestion()` for
  suggestions, and `direct-messages.remote.ts:reportDirectThread()` for conversations. The
  last two have their own remotes because reporting them has side effects — a suggestion
  comes down, a conversation becomes readable — that a generic id-taking form must not grant.
- **The queue:** `/staff/flags` → `getFlagsQueue(filters)` → `flag/flag-service.ts:listFlags()`;
  `/staff/flags/[id]` → `getFlagDetail()` → `getFlag()` plus `getFlaggedDirectThread()`
  when the target is a conversation.
- **Resolving:** `resolveFlag({resolution, notes, unpublishEvent})` →
  `flag-service.ts:resolveFlag()`. `scopeForFlag()` in `moderation/standing-service.ts` maps
  an entity type to the standing scope it can affect.
- **Standing:** `standing-service.ts`: `getStanding()` / `getStandings()`,
  `restrictStanding()`, `restoreStanding()`, with `setStanding()` underneath. Surfaced on
  the member record via `standing.remote.ts`.
- **Suggestions:** `suggestion/suggestion-service.ts` — the board
  (`getSuggestionBoard`, votes deduped per member), the staff queue
  (`getSuggestionsQueue`, `respondToSuggestion`, `setSuggestionVisibility`),
  edit review (`getEditableState()` decides _for_ the caller whether an edit applies
  directly or files for review — a client that could ask would be asking to skip the check),
  and `mergeSuggestion()` for duplicates, which transfers and dedupes votes.

### Data touched

`content_flag`, `member_standing`, `suggestion`, `suggestion_vote`, `suggestion_edit`,
`user_block`, and `event.status` when an upheld report unpublishes a listing.

### Where it breaks

- **A restriction that seems not to apply** → check the _scope_. Restricted at
  `community_event` does nothing to suggestions or messaging, by design.
- **A staff-imposed restriction with no report behind it** → `setStanding` takes `flagId` as
  optional today, and `setMemberStanding` is a staff form that restricts with no report at
  all. It is the least-reviewed moderation path there is;
  [specs/moderation-appeals-spec.md](../specs/moderation-appeals-spec.md) is the design that
  closes it and is **not built**.
- **A reported suggestion nobody can see** → reporting takes it off the board immediately,
  so this queue is time-sensitive in a way the flag queue is not.

---

## 12. Volunteering

Spec: [specs/volunteering-spec.md](../specs/shipped/volunteering-spec.md)

### The story

Staff define **roles** — job types with markdown descriptions. Members say which roles
interest them (a standing note, not a commitment to a date), claim dated **shifts**, and log
**hours**. Staff work an approval queue, and a date-ranged report rolls approved hours up by
member, role and month — which is the number the board and grant applications ask for.

Approved hours are a record, not a currency: they never become practice-room credits and
never touch the finance ledger, and there is a test that enforces it.

Certifications gate _scheduling_, never the record of work already done. A role can require
one; whether a member held it is evaluated **as of the shift's date**, with a deliberate
asymmetry — a clearance pulled on the day was not in force, but a card is valid through its
expiry date. Held certifications append and are never overwritten, which is the only way to
answer "was their First Aid current on the night of the incident?"

### The coordinator's half

Everything above is the member's path. The staff side was inferred from it, and a hands-on
pass ([reports/volunteer-workflow-findings.md](../reports/volunteer-workflow-findings.md))
found the asymmetry: a coordinator could not put anybody on a shift, take anybody off one,
or record hours for somebody — while the help text told members to ask them to do the last
of those. All three services already took the user as a parameter; only the remote functions
were bound to the session.

So:

- **`/staff/volunteer` is Today, a worklist rather than a table.** Cards for the things
  waiting on a person — claims to confirm, shifts that are short, hours to review, under-18
  approvals, shifts that finished without being closed out, clearances lapsing before a shift
  somebody is already on — each with its action on the row, each hidden when its queue is
  empty. See [ui-patterns.md#section-dashboards](./ui-patterns.md#section-dashboards).
- **Four screens, not seven.** Today, Schedule, People, Setup, plus a read-only Report.
  Schedule absorbed the shift catalog (its "Everything" window is what the old Include-past
  checkbox was); People absorbed the volunteers index, the under-18 queue and the clearances
  table; Setup absorbed roles and certifications. The retired routes are 308s, and role
  detail, the full hour queue and the richer report survive as unlisted pages reached from
  the screens that replaced them. See
  [specs/shipped/volunteering-redesign-spec.md](../specs/shipped/volunteering-redesign-spec.md).
- **A called-off shift is a notify list.** `cancelShift` has always left its signups in
  place; now `notifySignupsOfCancellation` is the button that tells them, and
  `volunteer_signup.notified_at` records how far down the list staff have got. Cancelling
  deliberately notifies nobody on its own — calling a shift off and telling six people about
  it are two decisions, and the first is sometimes reversed.
- **Staff can assign, release and confirm.** `assignShiftToMember` lands the signup
  `confirmed` — a coordinator typing the name in _is_ the decision, and leaving it `claimed`
  would cost the member their reminder. The clearance gate is **not** relaxed for staff: an
  uncleared member is refused with the certification named.
- **A staff release is a cancellation, not a no-show.** Notice given is not a mark against
  somebody, and the two were previously the same button.
- **`logHoursForMember`** lifts the 90-day backdate window and lands the log `approved`,
  stamped with the staffer. The window stays for members, which is what makes "ask staff to
  add anything older" a real sentence.
- **Claims, confirmations and cancellations emit events** (`volunteer.signup_claimed`,
  `…_confirmed`, `…_cancelled`). Before them a claim produced no signal at all: staff were
  never told one had arrived, and confirming — which is what earns the reminder, the
  auto-complete and the hour log — had nothing prompting it.
- **Every list splits `confirmed` from `claimed`.** One conflated number made a shift with
  three unconfirmed claims read as fully staffed. The member's half now draws the same
  distinction as a two-step **Claimed → Booked** rail, because a claim nobody confirms earns
  no reminder and never auto-completes — and the person who made it could not previously tell
  that from a booking.
- **"Who to ask" sits beside the shift**, not on the role's page, and is judged as of the
  shift's own date. Three scopes — interested, has worked it, everybody — and one flag line
  per candidate, resolved in priority order: missing clearance blocks, a lapsing one warns, a
  day their availability argues against warns, otherwise what they have done before.

### Code path

- **Roles and interest:** `volunteer/volunteer-role-service.ts`,
  `volunteer-interest-service.ts` (`listInterestedMembers()` filters by role with an EXISTS,
  so a filtered member still comes back with all their roles).
- **Onboarding:** `volunteer-profile-service.ts` — the one-time name/phone/over-18 gate on
  `/member/volunteer/start`.
- **Shifts:** `work-order-service.ts` + `volunteer-signup-service.ts`. A shift may name
  the event it staffs. Only _confirmed_ signups get the reminder and the auto-complete.
  `claimShift(shiftId, userId, { assignedByStaff })` serves both the member's claim and the
  coordinator's assignment; `releaseSignup` is `cancelSignup` without the owner clause.
- **The dashboard:** `listOutstandingClaims`, `listUnclosedSignups` and
  `countVolunteerWorkWaiting` in the signup service, `listShortStaffedShifts` in the shift
  service, and `listLapsingBeforeRosteredShift` in the certification service — composed by
  `getVolunteerWorklist`. The sidebar badge reads `countVolunteerWorkWaiting` too, so the
  number on the nav and the rows on the page cannot disagree.
- **Certifications:** `volunteer-certification-service.ts` (catalog),
  `member-certification-service.ts` (held; append-only, `expiresAt` stamped at grant time
  from `validityMonths` and never computed on read).
- **Hours and review:** `hour-log-service.ts`; the report is `volunteer-report-service.ts`.
- **Feedback:** `volunteer-feedback-service.ts` — the day-after two-question survey, rolled
  up per role anonymously.
- **Crons:** `shift-reminders` (daily), `complete-shifts` (frequent), `shift-feedback`
  (daily), all under `src/routes/api/cron/`.
- **Surfaces:** `volunteer.remote.ts` for the member
  side; the staff pages under `/staff/volunteer/` are always on, per the panel-wide rule
  that staff surfaces ignore flags.

### Duty lists

A duty list is a named set of work orders stamped onto a **subject** — an event, or a member's
rehearsal booking. Staffing a show is six of them, and every one used to be entered by hand on
the production page.

Two grains, one level of nesting, and **hours are what separate them**. A volunteer signs up
for Tear Down and logs one entry for it; nobody signs up for "take the trash out" or logs four
minutes against it. `volunteer_signup` is unique per (shift, member) and
`volunteer_hour_log.minutes` carries a positive CHECK, so a checklist cannot be more work
orders — it sits a level below one, as `work_task`. That table is four columns and stops:
`doneByUserId` is attribution, never credit, and nothing in it touches hours.

`duty_list_item`'s time columns mirror the work order's own nullability, which is what lets one
row type produce both halves of a show. An item with `offsetMinutes` + `durationMinutes`
becomes a scheduled shift (Door, at doors); an item with only `dueOffsetMinutes` becomes an
unscheduled work order with a `dueAt` (Booking Lead, a week out, whose tasks are the advance
checklist). So there is **no `phase` column and no "advance" concept** — which phase a piece of
work belongs to is which role's work order its tasks are on, and the offset says when.

Applying is `applyDutyList(id, subject, createdByUserId)` in
`volunteer/duty-list-service.ts`, where the subject is a `DutySubject` union rather than a bare
id, so an event id cannot reach the reservation branch. Both subjects load into one
`TimedSubject` shape, because a booking and a show are both a window with a start and an end,
which is everything an offset needs. Offsets are plain instant arithmetic from a real anchor —
`doorsAt ?? startsAt`, `startsAt`, or `endsAt` — so DST needs no handling here, unlike
`duplicateShift`, which shifts a wall-clock date and does. Writes go through `db.batch` with
the task insert chunked to stay under D1's 100 bound parameters. A second apply to the same
subject is refused by name rather than deduplicated, because doubling a roster looks exactly
like the first apply from the outside.

`duty_list.subject` is a column of its own rather than something read off the anchor: `start`
and `end` resolve for both kinds, and only `doors` is show-shaped. So the illegal state is the
_pair_ `(reservation, doors)`, refused when a list is **saved** as well as when it is applied.
The `doorsAt ?? startsAt` fallback exists because not every show sets a doors time — but a show
without one still has doors, and a rehearsal has no such concept, so taking the same fallback
would quietly turn "fifteen minutes before doors" into something else and read as correct on
every screen.

For an event, the event is the parent and there is no separate one. Work parties and monthly
deep cleans get their own event listings — they need advertising as much as a show does — so
every application already has a row identifying it, and March's deep clean is a different event
from April's.

### Rehearsal orientation

The one list that applies itself. `duty_list.auto_apply_on` names the domain event that stamps
a list out with nobody pressing a button; a partial unique index allows one list per trigger,
and `'reservation.first'` is the only trigger there is.

`reservation.created` is emitted from `create()` and `staffCreate()` in
`reservation/reservation-service.ts` — from the service, not from the five booking remotes,
where a sixth would be forgotten — and **after** the post-insert race re-check, so a booking
that gets compensated away never announces itself. `orientation-listener.ts` checks the booking
is a member's (`bookerType === 'user'`) and their first (`priorBookingCount`), then applies.

A booking that came off the **waitlist** announces itself too, from
`announceWaitlistConfirmed()`, called by the `confirmWaitlisted` remote after its own race
re-check. The emit hangs off the `waitlisted → scheduled` transition and nothing else:
`createWaitlisted()` stays quiet because a queue position is not a visit, and
`promoteNextWaitlisted()` stays quiet because it only _offers_ the slot — it stamps the 24h
window and leaves the row `waitlisted`, where `expireWaitlisted()` can still cancel it without
emitting `reservation.cancelled`. An orientation raised at promotion would outlive its booking;
one raised at confirmation cannot, because the row is real from then on and an ordinary
`cancel()` stands the shift down. `announceWaitlistConfirmed()` re-reads the row under the
`not in ('cancelled','waitlisted')` filter rather than trusting the caller's copy, so a
confirmation the race check rolled back announces nothing.

The status filter in `priorBookingCount` is what makes this work in both directions: the rest of
the member's queue counts for nothing while they are still in it, so the booking they actually
got is still their first — and once one of those queued rows is itself confirmed, it becomes
history and suppresses a second orientation.

**Idempotence is the re-apply guard**, not a mechanism of its own. The bus is in-process and
best-effort with no dedupe, so a re-delivered event lands on the same check that stops a
coordinator double-clicking Apply and is refused by name. Without an orientation list in the
database the feature is simply off, which is how it degrades before the seed exists.

`reservation.rescheduled` moves it. A booking can be re-timed in place rather than cancelled and
remade, and that leaves anything pinned to the old window behind — worse than a cancellation,
because the volunteer turns up at an hour nobody is coming and nothing on any screen says so. The
shift moves by the **delta**, not by recomputing from the duty list: the stamped work order has no
link back, so a list edited since must not silently re-time work somebody has already claimed.
Cancelled and resolved shifts stay where they are, being history rather than plans.

`reservation.cancelled` stands the shift down through `cancelShift`, so it appears in the staff
surfaces exactly as a hand-cancelled shift does — with the un-notified count and the "Notify
all" button, because telling the volunteer is deliberately still a person's decision. The
cascade is keyed on the **reservation**, not the member, which is why rebooking needs no
special case: the new booking is that member's first again by the shared rule, gets its own
shift, and the old one stays cancelled as a record.

`member_orientation` holds timestamps and no status; `stateOf()` derives
`pending | scheduled | completed | waived`. Two of those would be wrong the moment a clock
ticked if they were stored — `scheduled` is really a fact about whether the shift is still
live, and an orientation **nobody claims emits no completion event at all**, so a stored status
would sit at `scheduled` for ever with its time in the past and need a cron to un-stick.

Who may run one is the ordinary clearance gate: `volunteer_role_certification` links the
Rehearsal Orientation role to the Space Orientation Trained certification, and `claimShift`
already enforces it. Nothing new claims, assigns, or notifies.

### Data touched

`volunteer_role`, `volunteer_role_interest`, `volunteer_profile`, `volunteer_hour_log`,
`work_order`, `volunteer_signup`, `volunteer_shift_feedback`,
`volunteer_certification`, `member_certification`, `volunteer_role_certification`,
`duty_list`, `duty_list_item`, `work_task`, `member_orientation`.

### Where it breaks

- **Hours bucketed into the wrong month** → `workedOn` is anchored at **noon** club time on
  purpose. Midnight local is the previous UTC day in any UTC-ahead zone, and the report
  buckets with `strftime('%Y-%m', worked_on, 'unixepoch')`, which reads the instant in UTC.
- **A member cannot claim a shift** → check the role's required certifications against the
  _shift's_ date, not today's.
- **The member surface is missing entirely** → the `volunteering` flag gates the member side
  only. The staff panel showing it while members cannot see it is the intended state, not a
  bug.
- **No orientation shift appeared for a first booking** → in order: is there an active
  `duty_list` with `auto_apply_on = 'reservation.first'` and `subject = 'reservation'`; is
  `booker_type` actually `'user'`; and does the member have an earlier non-cancelled,
  non-waitlisted booking. A **waitlisted** row is not history — that was a real defect in
  `isFirstReservationSql`, harmless while it only drove a badge and silently suppressing an
  orientation once it drove this.
- **A member whose first booking was waitlisted got no orientation** → they get one when they
  confirm the slot, not when they join the queue and not when it is offered to them. Check the
  row actually reached `scheduled`: `confirmWaitlisted` rolls a confirmation back to
  `waitlisted` if a competing booking landed mid-write, and `announceWaitlistConfirmed()`
  deliberately says nothing for a row still in the queue. A booking that is only _offered_ —
  `waitlist_notified_at` set, status still `waitlisted` — has not been confirmed yet and is
  correctly silent.
- **An orientation stuck at "Booked" after the date passed** → it cannot be. The state is
  derived, and `stateOf` falls back to `pending` once `scheduledFor` is in the past with no
  completion.
- **An orientation left behind after a booking was re-timed** → `adjustWindow` emits
  `reservation.rescheduled`; check the listener ran. Only live shifts move, and a shift whose
  booking moved by zero minutes (an extension in place) is deliberately untouched.

---

## 13. Music and CMC Radio

Behind two flags: `bandAudio` (the storefront) and `cmcRadio` (the station). Design
rationale in [band-audio-spec.md](../specs/shipped/band-audio-spec.md).

### The story

A band uploads a record from `/band/[slug]/music`, prices it (free, or at least
$2), and optionally opts it into CMC Radio. Anyone can stream the whole thing for
free from `/music/[bandSlug]/[releaseSlug]`; what is sold is the file. A buyer
names their price, divides it between the band and the collective on a split bar,
and gets a download link — by email, because they may well have no account.

### The code path

**Upload.** `POST /api/bands/[id]/audio` (multipart — a remote `form()` cannot
carry 50MB). `requireGroupRole(…, 'admin')`, validate every file before writing
any, `putAudioObject` → `R2_PRIVATE`, then `addTrack`. Duration comes from the
browser (`<audio>` metadata) and is clamped, not trusted: the radio builds a
wall-clock timetable out of it.

**Streaming.** `GET /api/audio/track/[id]/stream`, public, Range-aware.
`parseRangeHeader` is pure and specced separately — Safari opens every media
request with `Range: bytes=0-1` and will not play a file answered with a 200.

**Buying.** `buyReleaseForm` → `beginPurchase`. Free short-circuits to a `paid`
row with no Stripe. Paid writes a `pending` row, then `checkout()` with
`transfer_data.destination` and `application_fee_amount` from `computeSplit`.
Stripe's webhook emits `checkout.completed`; `handleAudioCheckout` self-selects on
`metadata.type === 'audio_purchase'` and calls `fulfillPurchase`, which is
idempotent on the pending status. That emits `audio.purchased` → the receipt.

**Downloading.** `GET /api/audio/download/[token]/[trackId]`, gated on a paid
purchase, `Content-Disposition: attachment`, Range honoured so a dropped
connection resumes.

**The radio.** `/api/cron/schedule-radio` every 15 minutes fills `radio_play` 45
minutes ahead (three passes of slack). `getRadioState()` returns the current
entry, the next three, and the **server's clock**; the widget in the root layout
seeks to `serverNow − startsAt`.

### Data touched

`audio_release`, `audio_track`, `release_purchase`, `band_stripe_account`,
`radio_play`; `media`/`media_attachment` for cover art only; `group` throughout.

### Where it breaks

- **A second Stripe webhook endpoint with its own secret.** Wrong or missing, and
  band accounts never flip to `charges_enabled` — silently. Verify by checking the
  column, not by watching for an error.
- **A band's Stripe account restricted after a priced release went up.**
  `beginPurchase` re-checks `destinationFor` rather than trusting publish-time
  state, and the release page hides the Buy control instead of offering one that
  409s.
- **An empty rotation.** The scheduler writes nothing and `nowPlaying` is null;
  the widget renders nothing at all. This is the expected pre-launch state, not a
  fault.
- **A track outside the duration bounds** is opted in and still never heard.
  Surfaced on the band's release page and counted on `/staff/music`.
- **An abandoned checkout** leaves a `pending` row; `/api/cron/sweep-audio-purchases`
  clears it after 24h.

## 14. Producing a show: the production record

Design spec: [production-workflow-spec.md](../specs/production-workflow-spec.md) —
**read its 2026-09-04 amendment first**; most of the body is superseded.

### The story

A listing on the gig guide says a show is happening. A **production** is the other
half: load-in at four, soundcheck at half five, doors at seven, curfew at eleven,
and somebody's name against all of it. Most listings never become one — a band's own
gig and a member's community post never do — which is why it is a separate row
rather than ten columns that would be NULL on the guide's hottest query.

A staffer opens one from the event page, works on it in the console, and walks it
forward as the night gets more real: **draft** (somebody is thinking about it) →
**offered** (the offer is out, waiting on an act) → **confirmed** (it is happening) →
**completed** (it happened). `settled` and `closed` are in the vocabulary but have no
button yet; the settlement worksheet and the close-out are later phases.

### Code path

1. `/staff/events/[id]` → **Add production** → `createProduction`
   (`lib/remote/productions.remote.ts`, guard `event.manage`) →
   `production-service.createProduction()`. The 1:1 is held by `uq_production_event`,
   so this inserts and reads the violation rather than selecting first — a
   select-then-insert is a race.
2. `/staff/events/[id]/production` reads it through `getStaffEventProduction`, which
   adds one entry to its existing `Promise.all` rather than a second remote query.
3. **Overview** tab → `updateProduction` (times and notes) and
   `setProductionProducer` (who is running it — `'me'` resolves server-side, so the
   client never names a user id).
4. `ProductionStatusAction` → `advanceProduction` →
   `production-service.transitionProduction()`. Every move is
   `UPDATE … WHERE id = ? AND status IN (…)` plus a `getRowCount` check: D1 has no
   interactive transactions, so this is the house pattern. A zero row count re-reads
   to tell "no such production" from "wrong status".
5. `event-service.cancel()` → `cancelProductionsForEvent()`. One conditional update
   over the three pre-completed statuses; a production that already `completed`
   describes a night that happened, and cancelling the advertisement does not
   un-happen it.
6. `/staff/productions` reads everything through the one `getStaffEvents` query:
   `listAll()` left-joins `venue` and `production` (both 1:1, so no fan-out), and
   `getEventLineups()` — the batched helper — supplies the headliner and the count.

### Data touched

- `production` — the record. Cascades from `event_listing`; `producerUserId` and
  `createdByUserId` are both set-null, because purging a staff account must not
  delete the collective's production records.
- `event_listing.venueId` — where the show is, and therefore whether it holds the
  practice room. Deliberately **not** duplicated onto `production`.
- `event_band` — the bill, which the index summarises and the production never
  re-declares.

### Where it breaks

- **The index shows a production against a cancelled show.** The cascade in
  `cancel()` did not run — it is the only thing keeping the status column honest.
- **"Add production" is missing on a CMC show that has none.** `getStaffEventPage`
  stopped returning `production`; the button is gated on it being null.
- **A transition button does nothing.** The row moved underneath the page. The
  conditional update matched zero rows and the error names the status it actually
  found — read it rather than retrying.
- **`settled` or `closed` appears with no way to reach it.** That is correct today.
  Do not add a button for either until the work it names exists.

## Cross-cutting patterns worth internalizing

- **Everything money-related converges on two Stripe entry points:** `checkout()` in
  `finance/payment-service.ts` (one-off) and `createCheckoutSession()` in
  `finance/subscription-service.ts` (recurring) — and one webhook route that fans out via
  `webhookHandlerMap`. New paid features should reuse these, put a discriminator in the
  Checkout Session `metadata`, and fulfill from a `checkout.completed` listener.
- **Status transitions are atomic conditional updates** (`UPDATE ... WHERE status IN
(...)` + row-count check — see `updateStatus()` in `reservation-service.ts`), because
  D1 has no transactions. Follow the same pattern for any new state machine.
- **Side effects ride the event bus** and must stay idempotent — Stripe re-delivery and
  cron overlap both re-run them.
- **Feature flags gate whole workflows** (`requireFeature()`); when something "doesn't
  exist" in production but works locally, check the flag first
  (`site-config` KV, `feature.*` keys).
