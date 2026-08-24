# Door-code timing — Spec

**Phase 3 of the reservation confirmation window.** Phases 1 and 2 shipped in #125 and are
no longer design intent: they describe how the app behaves today, and that description now
lives in
[development/business-workflows.md §1](../development/business-workflows.md#1-reservation-booking-confirmation-and-payment).
What is left here is the one phase that was never built.

## The policy, for context

A reservation may become `confirmed` more than `CONFIRMATION_WINDOW_DAYS = 3` before its
start _only_ via a real Stripe charge or a staff action. Everything else — cash-at-door,
free-hour credits — must wait for the window to open. Anything still `scheduled` at its
start time is swept and cancelled.

Both halves of that are live: the gate is `withinConfirmationWindow` /
`confirmWindowOpensAt` in `src/lib/config.ts`, applied in `src/lib/remote/reservations.remote.ts`;
the sweep is `cancelUnconfirmedReservations()` behind the `cancel-unconfirmed` cron.

## What is not built

Door codes still follow the old timing. `provisionDailyAccess()`
(`src/lib/server/lock/lock-service.ts`) queries a single day — `dayStart` to `dayEnd`, built
from today's date in club time — and nothing mints a `lockCode` when a member confirms.

Two changes close it:

1. **Mint on confirm, best-effort.** A member who confirms inside the window should have
   their code immediately rather than the morning of. Best-effort because the Ultraloc API
   is a third party in a request path a member is waiting on: a failure must not fail the
   confirm, since the daily cron will pick it up regardless.
2. **Widen the provisioning window to the confirmation window.** `provisionDailyAccess()`
   moves from "reservations starting today" to "reservations starting within
   `CONFIRMATION_WINDOW_DAYS`", so the two numbers stop being independently chosen. The
   daily cron remains the backstop for anything the confirm-time mint missed.

## Why it was deferred, and what to check before building it

The reason the window exists at all is that the smart lock has a **finite user table**. The
original problem statement was that indefinitely-early confirmations load it. Widening
provisioning from one day to three multiplies the codes live at any moment by roughly three,
which is the whole risk in this phase and the thing to measure first: how many temporary
users the lock holds, against how many a three-day window would ask it to hold at the
busiest point in a week.

If the ceiling is close, minting on confirm without widening the cron is the useful half —
it fixes the member-visible problem (no code until the morning) without changing the
steady-state count much, since a code minted on confirm inside a 3-day window is a code the
cron would have created anyway, only earlier.

Cleanup is the other half to keep honest: `runDailyLockJob()` cleans up yesterday's access before
provisioning today's. A wider provisioning window needs a matching cleanup window, or codes
accumulate exactly as feared.

## Notes

- **No schema changes.** `status`, `paidAt`, `cashDueCents`, `creditsUsed` and `lockCode` all
  exist and are already written by the shipped phases.
- The lock crons need an external scheduler calling `/api/cron/*` daily — no Cloudflare
  `[triggers]` are configured.
