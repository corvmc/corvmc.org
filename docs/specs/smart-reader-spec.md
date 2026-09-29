# Smart reader: pay for a booking at the reader

> ## Status
>
> 📋 Spec, tracked by #1659. Nothing is built, and the hardware has not been bought. The software
> can be built and tested in full against Stripe's simulated reader before the device arrives. The
> choices an agent made are recorded for the owner to confirm: #1722 (hardware, integration, no
> device table), #1724 (which use ships first) and #1723 (walk-up booking and the minimum notice).

## Purpose

A **Stripe Reader S700** in the practice space, where a member settles a booking by tapping a card.
The member starts the payment from **their own phone**. The server then puts the amount on the
reader, and Stripe's webhook confirms the booking. Nobody from staff has to be there.

This is the one piece of #612's unattended kiosk that needs a reader. The other two uses it named,
door access and self check-in, are already covered or cannot be done on the device. See
[What the reader is not for](#what-the-reader-is-not-for).

## Premise, checked against `main` on 2026-09-29

Checked at `752d940`.

- **Tap to Pay landed** (#1663, 2026-09-25). `PaymentGateway` carries `terminal.connectionTokens`
  and `terminal.locations`, `terminal-service.ts` reads `STRIPE_TERMINAL_LOCATION_ID`, and
  `payment_intent.succeeded` is dispatched to `fulfillDoorSale`, which acts only on
  `metadata.type === 'door_ticket'`. The spec's status line has not caught up; that is filed
  separately as #1720.
- **Money is left owing on bookings today.** A confirm inside the 3-day window commits credits and
  leaves any remainder in `reservation.cashDueCents` "for staff to collect at the door"
  (business-workflows §1). Staff settle it with `cashReceivedReservation` from the resolve modal.
  Paying online is a Stripe Checkout Session, handled by `handleReservationCheckout`.
- **Door access is solved without a reader.** Keypad codes are minted on confirm
  (`provisionOnConfirm`) and provisioned across the window by the daily lock job. Members can also
  hold standing codes.
- **Show check-in is a volunteer's job.** A confirmed Door volunteer checks tickets in at
  `/member/volunteer/shifts/[signupId]/check-in`, and staff do it at `/staff/events/[id]/check-in`.
- **The minimum notice is a picker rule only.** `reservation.minAdvanceMinutes` (default 60) hides
  slots in `getAvailableSlots`. `validateBooking` never checks it. That is filed separately as
  #1721.

## The handoff

1. **A member with a booking arrives** and owes money on it: `cashDueCents`, or the uncovered part
   of a booking still `scheduled`.
2. **They open the booking on their phone** and choose **Pay at the reader**. A sticker on the reader
   carries a QR code to `/member/reservations`, so the page is one scan away.
3. **The server puts the amount on the reader.** The reader shows the total and waits for a card.
4. **The member taps, inserts or swipes.** Stripe authorises the payment.
5. **Stripe tells the server.** `payment_intent.succeeded` confirms the booking and records the
   money. The phone shows "Paid" as soon as that has landed.

Staff appear nowhere in this chain. Before, step 1 ended with the resolve modal.

## The design

### 1. Hardware and placement

- **Stripe Reader S700**, bought from the Stripe Dashboard's Terminal shop and registered to the
  existing Location (the one `STRIPE_TERMINAL_LOCATION_ID` names).
- It sits on its charging dock by the practice room door, on the space's Wi-Fi. Stripe treats a
  reader as offline after 2 minutes without a signal, so the network must meet Stripe's Terminal
  network requirements.
- Readers update themselves when they are idle and powered, so the dock stays plugged in.

### 2. Server-driven, from the Worker

No app runs on the reader. The Worker drives it through the Stripe API with the same client
everything else uses. Terminal gains port members on `PaymentGateway`, and the fake implements
them. `gateway.contract.spec.ts` sweeps both drivers:

| Port member                                         | Used for                                              |
| --------------------------------------------------- | ----------------------------------------------------- |
| `terminal.readers.retrieve`                         | Checking the reader is online, and whether it is busy |
| `terminal.readers.processPaymentIntent`             | Putting the amount on the reader                      |
| `terminal.readers.cancelAction`                     | Clearing a payment the member abandoned               |
| `testHelpers.terminal.readers.presentPaymentMethod` | The fake and the simulated reader, in tests only      |

`paymentIntents.create` / `cancel` are already on the port from Tap to Pay.

### 3. The reader is configuration

`STRIPE_TERMINAL_READER_ID` is a `tmr_…` id, read in `terminal-service.ts` next to
`terminalLocationId()`. Under the fake driver it returns a fake id, so a real id is never paired
with the in-memory gateway. When no reader is configured, the action does not appear.

There is no device table. There is one reader, registered once in the Dashboard with the code it
shows at setup. The Tap to Pay rule applies: a second reader is the point at which a device earns a
row.

### 4. `payAtReader`: the one remote

A `command` in `src/lib/remote/reservations.remote.ts`, guarded like every other booking action:

1. `requireUser`, then the booking must be the caller's own.
2. The booking must be `scheduled` or `confirmed`, with no `paidAt`. Now must fall between two
   hours before `startsAt` and `endsAt`.
3. **The amount is decided server-side.** A `confirmed` booking owes its `cashDueCents`. A
   `scheduled` booking first goes through `commitCreditsAndSettleIfCovered`, exactly as confirm
   does. If credits cover it, the booking is settled and the reader is never touched. Otherwise the
   remainder is owed. An amount under Stripe's minimum charge is refused with a message that sends
   the member to staff. The reader is never engaged for it.
4. It creates a `card_present` PaymentIntent (`capture_method: 'automatic'`) with metadata
   `{ type: 'reader_reservation', reservation_id, user_id }` and idempotency key
   `reader-<reservationId>-<amountCents>`. A double tap therefore cannot create two intents.
5. It retrieves the reader. If an action is `in_progress` for this same intent, it returns that
   action unchanged. If the action belongs to another intent and is less than two minutes old, the
   remote refuses with 409 "The reader is busy, try again in a minute". An action older than that
   is cleared with `cancelAction`.
6. It calls `processPaymentIntent` with `process_config: { skip_tipping: true,
enable_customer_cancellation: true }`, and returns the intent id.

`terminal_reader_offline` becomes a 503 "The reader is offline". `terminal_reader_timeout` is
retried once, since Stripe documents false negatives on it. Both go through `mapDomainError`, so
neither is reported as a crash.

A second command, `cancelPayAtReader`, calls `cancelAction` and cancels the intent. It is the
**Cancel** button on the phone.

### 5. Settlement: the webhook is the only writer

`webhookHandlerMap['payment_intent.succeeded']` becomes a dispatcher over `metadata.type`.
`'door_ticket'` goes to `fulfillDoorSale` as now, and `'reader_reservation'` goes to a new
`settleReservationAtReader` in `src/lib/server/reservation/`:

- One conditional update:
  `status IN ('scheduled', 'confirmed') AND paid_at IS NULL` → `confirmed`, `paidAt`,
  `cashDueCents: 0` and `stripePaymentRecordId` = the intent id. When it returns no rows, the
  handler returns. That makes a redelivered event a no-op.
- Only after rows come back, it writes the ledger rows that the reservation checkout path writes
  (`reservation-entries.ts`). The card fee comes from `calculateCardPresentFee`, and the
  `payment_cache` row carries the `reservationId`.
- Then `announceConfirmed`, which mints a door code if the booking is inside the window and has
  none.

The phone polls `getReservationPayment` with a bounded retry until `paidAt` is set, in the same
shape as the ticket success page (`RETRY_LIMIT` / `RETRY_MS`). It never tells the server that a
payment succeeded.

`terminal.reader.action_failed` is **not** subscribed to. A decline leaves the intent in
`requires_payment_method`. The phone reads that through the same query and offers **Try again**,
which reuses the intent, as Stripe requires to avoid double charges.

Refunds stay where they are. A reader payment is an ordinary PaymentIntent, so
`refundAndCancelReservation` and `refundOnlyReservation` refund it through `stripePaymentRecordId`.

### 6. What the member sees

On `/member/reservations/[id]`, when §4's conditions hold and a reader is configured, the payment
card offers **Pay at the reader** next to **Pay online**. After it is pressed, the card shows "Tap
your card on the reader by the door", then **Cancel**, then "Paid". Nothing on this screen shows
the reader's id or its status.

The page uses the existing `Button`, `Alert` and `Form` components. No gradients.

## What the reader is not for

- **Door access.** The reader's NFC takes payments only, and the reader cannot drive the lock.
  Keypad codes already do this job.
- **Self check-in at shows.** A reader cannot scan a ticket in server-driven mode. An unattended
  check-in would record attendance without controlling who comes in.
- **Tipping.** Always `skip_tipping`, and no tipping Configuration is created.
- **Door ticket sales.** Those stay on the Tap to Pay phone.

## Walk-up booking

A member in the space books through the normal wizard on their phone, then pays at the reader. The
reader gives no exception to the minimum notice (#1723). #1721 has to land first, or the notice
is not a rule at all.

## Tests

- `gateway.contract.spec.ts`: the four new port members, on both drivers.
- `payAtReader` remote spec: ownership, the time window, credits that cover everything (no intent,
  no reader call), the busy, stale and offline branches, and the idempotency key.
- `settleReservationAtReader` spec: settles once and writes the ledger once when the event is
  delivered twice, ignores `door_ticket`, and ignores a booking that is already paid.
- `webhook-handlers.spec.ts`: the dispatcher routes by `metadata.type`.
- `money-map.spec.ts`: covers the new fee path, if it asks for one.

## Phases

1. **One PR on `main`**, since a member-facing action that is hidden until the reader is configured
   is usable as soon as it lands. It contains §2 to §6 and the specs above, tested against the fake
   and against Stripe's simulated reader in test mode. It needs no schema and no migration. Add a
   booking with `cashDueCents` owing to `scripts/seed-dev.ts` if none exists, and a row to
   `docs/reports/feature-catalog.md`.
2. **Owner setup** (below), then a first live payment of the smallest real booking.

## Owner setup

1. Buy an S700 from the Dashboard's Terminal shop, with whatever stand or dock keeps it powered.
2. Register it to the existing Location with the code the reader displays, and label it "Practice
   room".
3. Set `STRIPE_TERMINAL_READER_ID` as a Worker secret, for production and for test.
4. Print the QR sticker for `/member/reservations`.

## Out of scope

- A kiosk screen, or an app on the reader (Apps on Devices). #1722 lists both as options.
- A device table, or a second reader.
- Offline payments, which server-driven integration does not support.
