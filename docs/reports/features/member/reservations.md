# Reservations

Status: ✅ List + book + pay

New reservation flow with conflict checking, in-app checkout. A booking is `confirmed` when it is made, however far ahead; the schedule-then-confirm step, its reminders and the unconfirmed sweep were removed (#2502). **`reservation.hard_hold`** is what makes a hold block a recurring series outright — set when a show holds the room, read only by `checkEventAndClosureConflict`. It replaced `booker_type = 'event_listing'`, which answered "was this created via a listing?" rather than "is this a show", so advertising a session would have upgraded its priority A member without the Practice space clearance sees a **First booking** block under the policy strip: the notice, and while an orientation role is set the tour length and that it is free (#2747).
