# 0018 Door sales on one Tap to Pay phone

- **Date:** 2026-09-22
- **Status:** Accepted
- **Issue:** [#612](https://github.com/corvmc/corvmc.org/issues/612)

## Context

#612 asked for a registered device in the space for check-in, door access or walk-up booking,
inherited from a Laravel `KioskDevices` resource with no written purpose. It was redefined as
taking card payments at the door with Stripe Terminal's Tap to Pay. A Tap to Pay reader
disconnects whenever its app leaves the foreground, so it cannot run unattended. Tap to Pay on
iPhone needs Apple entitlements, a business Apple ID and App Review; on Android it needs a
Stripe Location and a phone that passes Stripe's checks. It landed in #1663.

## Decision

1. Door payments run on **one CMC-owned Android phone**, held by a staffer or door volunteer,
   in a Capacitor shell that loads `/member/volunteer/door`. The app is sideloaded.
2. There is **no device table**. Stripe binds the phone to a Location when the reader
   connects, and the logged-in user records who took the money.
3. A door ticket is an ordinary `ticket` under the collective's existing ticket product. Its
   `purchaseId` is the PaymentIntent id (`pi_…`), or `door-<uuid>` for a free sale, so "door or
   online" needs no new column.
4. Tickets are minted `pending` when the intent is created. The `payment_intent.succeeded`
   webhook is their only writer; the phone polls and never reports a payment.
5. `finance.collect` takes payments: staff everywhere, and a confirmed door volunteer for their
   own show during the shift (#1630). Refunds stay on `finance.refund`, on the staff site.
6. Only collective-sold shows are offered (#1629).

## Alternatives rejected

- **An unattended kiosk.** The reader disconnects in the background. Unattended uses need a
  smart reader (#1659).
- **iPhone.** Entitlements, Apple's terms and App Review add schedule this does not need.
- **The `/checkout/[id]` Payment Element page.** It is card-not-present and opened by a buyer;
  at the door the phone is the staffer's.
- **The check-in page.** Check-in starts from a paid ticket; a door sale takes money first.
- **A `door_ticket` Stripe product.** One show's revenue would split across two products.
- **A device registry or allowlist.** With one phone every answer is constant, and Stripe's
  connect-time check is the real device gate. A second phone is the trigger to revisit.
- **Refunds on the device.** Taking money and giving it back are separate authorities.

## Consequences

- The payment path from `connectReader` onward cannot run in CI; it is checked by hand on the
  handset before doors.
- Installing a build needs Developer options, which block payments, so every install ends by
  turning them off.
- A webhook that never arrives leaves `pending` tickets with no automated sweep.
