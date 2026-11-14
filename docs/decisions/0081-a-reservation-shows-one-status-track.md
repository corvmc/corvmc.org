# 0081 A reservation shows one status track

- **Date:** 2026-11-13
- **Status:** Accepted
- **Issue:** [#2861](https://github.com/corvmc/corvmc.org/issues/2861)

## Context

A reservation was shown with its stored `status` and, beside it, a payment state derived by
`reservationPaymentState`. "Payment due" had a third definition in SQL (`confirmedUnpaidSql`) for
the staff filter and the fee gate, and the member page had a fourth (`isOverdue`). The four did
not agree: the staff Payment due filter listed upcoming unpaid bookings the fee gate did not
count, and the member's overdue list held completed and no-show rows the staff list did not.

## Decision

1. **One derived track.** `reservationTrack` returns Waitlisted, Booked, Paid, Payment due,
   Covered, No-show, Cancelled or Refunded from `status`, `endsAt`, `bookerType`, `paidAt`,
   `refundedAt` and `cashDueCents`. No stored column changes.
2. **A SQL twin held by a spec.** `reservationTrackSql` is the same rule as a `CASE`.
   `reservation-track.spec.ts` runs every combination of the columns through both on real SQLite
   and requires they agree, and that Payment due is exactly `paymentDueSql`, which the fee gate
   reads.
3. **Payment due starts when the reservation ends.** An upcoming booking that owes cash reads
   Booked. This matches the fee gate (#2859).
4. **Credits and comps both read Covered.** The staff reservation page and the
   `reservation.comped` audit row say which.
5. **`completed` is not shown.** A completed booking reads Paid or Covered.
6. **Members see the same labels as staff.** The member card, the band card and a reservation
   ref all carry the track.
7. **The staff filter offers the track.** `status=confirmed` in a saved link opens Booked.

## Alternatives rejected

- **Storing the track.** It depends on the clock: Booked becomes Payment due when the session
  ends, so a stored value needs a job to keep it true.
- **Payment due for a completed booking that still owes.** `confirmedUnpaidSql` reads
  `status = confirmed`, and the fee gate, auto-complete and the reminders share it. Widening it
  would change who the gate refuses. A completed booking with a balance reads Covered; see
  Consequences.

## Consequences

- The staff Payment due filter no longer lists upcoming unpaid bookings; they are under Booked.
- A booking staff marked complete while it owed, or one auto-completed on a payment record with
  no `paidAt`, reads Covered. The issue's table read it as Payment due.
- A no-show that owed money reads No-show and has left the member's Payment due list. The member
  could not pay it there before either.
- `scripts/reservation-track-only.spec.ts` fails a reservation component that decides on the
  payment columns itself or hands a stored status to `StatusBadge`.
- An event hold reads Booked until it ends and Covered after.
