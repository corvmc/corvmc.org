# Revenue Workflow Audit

An end-to-end trace of the app's revenue workflows — member subscriptions, practice-room
reservations, event tickets, and band premium — checking each money path (book → confirm →
pay → cancel/refund; subscribe → invoice → credit allocation → cancel; purchase → fulfill →
cancel) for logical errors. Donations are external (Zeffy) and merch is display-only; neither
carries in-app money logic.

Findings are ranked by severity. **High and medium items were fixed in the same change as this
report** (PR #130); the minor items were fixed in a follow-up change, except the two
explicitly accepted leftovers noted at the end.

---

## High severity — fixed

### H1. Cancelled reservations could be resurrected for free

- `confirmReservation` had no reservation-status guard, and the settle path in
  `commitCreditsAndSettleIfCovered` unconditionally set `status: 'confirmed'` whenever
  `cashDueCents` was 0. `cancel()` reversed committed credits but left `cashDueCents` set.
- Repro: book → confirm (credits fully cover, deducted) → cancel (credits refunded) →
  confirm again. The commit guard saw `cashDueCents = 0`, deducted nothing, and flipped the
  cancelled row back to `confirmed` — a confirmed slot with all credits kept, repeatable, and
  with no conflict re-check against rebooked slots. The same hole could flip
  `completed`/`no_show` rows back to `confirmed`.
- Fix: status guard in `confirmReservation`, status-conditional settle `UPDATE`, and
  `cancel()` now clears `cashDueCents`/`creditsUsed`
  (`src/lib/remote/reservations.remote.ts`, `src/lib/server/reservation/reservation-service.ts`).

### H2. Event cancellation promised refunds that never happen

- `event-service.cancel()` emailed every holder "Refunds will be processed automatically" but
  no refund code exists in the ticket domain, and tickets stayed `valid` for the cancelled
  event.
- Fix: live (pending/valid) tickets are voided on cancel and the email copy now says staff
  will reach out about refunds (`src/lib/server/event/event-service.ts`). Automated refunds
  remain deferred (tickets have no payment-record linkage — see tickets-spec deferred list).

### H3. Credit minting across the monthly reset

- The `invoice.paid` allocation **overwrites** the free-hours balance (no rollover), but
  cancel reversal **added** credits back with no cap and `free_hours` has no max balance.
  Confirm-before-reset / cancel-after-reset minted credits every cycle
  (10 → spend 4 → reset to 10 → cancel → 14).
- Fix: `reverseReservationCredits` clamps the reversal so the balance never exceeds the
  member's current allocation (`subscription.hoursPerReset`)
  (`src/lib/server/reservation/reservation-credit-service.ts`).

### H4. Duplicate member subscriptions (double billing)

- `createSubscription` had no server-side existing-subscription guard — a stale tab or double
  submit created a second live Stripe subscription. The band premium flow had this guard; the
  member flow didn't.
- Fix: rejects with 400 when a subscription snapshot exists (`src/lib/remote/membership.remote.ts`).

### H5. Webhook credit allocation could read the wrong invoice line

- `findContributionLine` took the **first** invoice line with `subscription_item_details` and
  positive quantity. The fee-coverage line and proration lines both match, and Stripe does not
  guarantee line ordering — a fee-covering member could have free hours **set** from the fee
  amount (e.g. $60/mo → ~1 credit instead of 24) and equipment credits granted from fee cents.
  The equivalent bug on _subscription items_ had already been fixed
  (`findContributionItem` in subscription-service.ts) but the invoice-line picker had not.
- Fix: proration lines excluded, fee line excluded by product id, largest-amount fallback;
  `coveringFees` detection updated to match (`src/lib/server/finance/webhook-handlers.ts`).

## Medium severity — fixed

- **M1** Ticket member discount read membership from a live Stripe call (`status: 'active'`
  only) while every other flow uses the `user.subscription` DB snapshot — the same member
  could get perks in one flow and not the other. Now uses the snapshot
  (`src/lib/remote/events.remote.ts`).
- **M2** `reservation-service.cancel()` passed the **canceller's** user id (staff, or `''`
  from the cron) into `paymentService.refund()`, which reverses checkout credit deductions to
  that user. Latent (reservation checkouts carry no checkout credits) but wired-up
  wrong-user credit grant. Now passes the reservation owner.
- **M3** `payment-service.checkout()` deducted credits before session creation with no
  reversal if coupon/session creation threw; subscription mode deducted credits but never
  applied the coupon; `cancel()` reversed credits without checking the session had completed.
  All three closed (failure reversal, explicit rejection of subscription+credits,
  completed-session guard).
- **M4** The staff event-update path accepted zero/negative/NaN ticket prices when
  `ticketingEnabled` wasn't part of the submit. Now validated (`src/lib/server/event/event-service.ts`).
- **M5** Reservation create (and waitlist confirm) was check-then-insert with no transaction
  (D1) — concurrent submits could double-book. A post-write re-check with compensating
  delete/downgrade narrows the race (`src/lib/server/reservation/reservation-service.ts`,
  `confirmWaitlisted` in `reservations.remote.ts`).
- **M6** `/staff/payments` silently showed only cash/credit-settled records — card revenue
  lives in Stripe. The page now says so.

## Minor — fixed in follow-up

- Fee-coverage line is skipped for sub-$1 remainders, where the grossed-up fee rivals the
  base charge (`payment-service.ts`).
- Credit units are applied with `Math.floor` — a whole credit is never burned for a
  partial-unit discount; the sub-unit remainder is paid in cash (`payment-service.ts`).
- `usedThisMonth` is derived from the credit ledger (net deductions since the last
  `monthly_allocation`) instead of `allocated − balance`, so a mid-month quantity change no
  longer distorts it (`credit-service.getUsageSinceLastAllocation`, used by
  `membership.remote.ts` and `users.remote.ts`).
- Equipment `settleReturn` retries with a fresh balance on an `InsufficientCreditsError`
  race instead of abandoning the member's remaining credits for full cash (`loan-service.ts`).
- Loan estimate and settlement share one formula (`loanDailyRateCents` / `loanChargeDays` in
  `config.ts`); 24h-block day counting kept — estimate vs actual can now differ only by real
  checkout/return times.
- `getReservationPricing` computes duration from `buildDateInTz` timestamps (the same
  arithmetic as booking/settlement), eliminating the DST-day quote/charge divergence.
- `getStaffReservations` date filters anchor to `America/Los_Angeles` via `buildDateInTz`
  (was runtime-local `new Date(...)` parsing).
- Orphan `pending` tickets are swept by `cancelStalePendingTickets` via
  `POST /api/cron/cancel-stale-tickets`, dispatched in the daily cron batch
  (`CRON_SCHEDULE` in `src/lib/server/cron/schedule.ts`).
- `commitReservationCredits` records `creditsUsed` (hours) for partially covered
  reservations too, so staff views report credit usage accurately.
- `docs/specs/shipped/finance-spec.md` updated to match the implementation (D1 integer wallets with
  CAS/atomic-decrement writes, KV-backed inline pricing, caller-declared credit eligibility,
  domain event bus, `subscription` snapshot).
- Orphaned coupons from failed session creation are deleted best-effort; the vestigial
  `user.trialEndsAt` column was removed (schema + better-auth additional field — requires a
  drizzle-kit migration).

## Accepted leftovers (by design)

- The ticket capacity check is non-atomic under concurrency — tickets-spec explicitly
  accepts oversell.
- A loan's final charge can differ from its estimate when actual checkout/return times
  differ from the requested dates; the formula itself is now shared.
