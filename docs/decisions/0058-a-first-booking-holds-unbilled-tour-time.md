# 0058 A first booking holds unbilled tour time

- **Date:** 2026-11-11
- **Status:** Accepted
- **Issue:** [#2568](https://github.com/corvmc/corvmc.org/issues/2568)

## Context

A member without the Practice space clearance gets a tour of the space on their first visit
([0055](0055-space-training-is-a-clearance-and-sets-booking-notice.md)). The tour came out of
the time they booked to practise. Its length is already a setting, `volunteer.orientationMinutes`.

## Decision

1. **The reservation starts earlier by the tour.** The room is held from the arrival time, so
   conflicts, the calendar, door codes and the orientation shift all read the same window.
2. **The tour is not charged.** The reservation stores `tour_minutes`, and every price and
   free-hours figure reads `billableHours(row)`, which subtracts it.
3. **The rule is the notice rule.** A member's own booking gets the tour while they hold no
   current clearance and an orientation role is set. Staff bookings get none.
4. **The length is stored on the reservation**, so changing the setting moves or reprices no
   existing booking.

## Alternatives rejected

- **Keep the requested start and widen the conflict checks.** The door code, the calendar and
  every conflict query would each need to know about the tour.
- **Charge for the tour.** The issue states it is not charged.

## Consequences

- A member who books twice before their orientation gets tour time on both bookings; only the
  first raises a shift.
- A recurring series takes its session length from the first booking less the tour.
