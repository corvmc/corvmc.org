# Practice Room Reservations

Members book the practice room for 1–8 hour sessions on 30-minute boundaries. Booking and payment are separate steps — members can pay online anytime before the session, or pay cash at the door. Paid-ahead members get automatic smart lock access provisioned the morning of their reservation. After a session, any unresolved unpaid reservations are surfaced to staff for resolution (no-show or cash received).

One room today. The schema is designed so adding rooms later means adding a resource table and a FK — but that's deferred until there's a second room.

---

## Why this system

The existing Laravel booking system works for scheduling, but access control is manual — staff texts entry codes morning-of, and must be on-site for unpaid bookings. The Collective now has an Ultraloc smart lock with a REST API that supports temporary users with time-scoped access. Integrating payment confirmation with lock provisioning eliminates the manual text-everyone-morning-of workflow and reduces the mental load on staff.

---

## Core concepts

### Reservation

A booking of the practice room for a time period. Always created by a user, but conceptually belongs to a **booker** — which can be a user practicing solo, a band rehearsing, or (in the future) an event or lesson occupying the space.

The booker relationship is polymorphic (`bookerType` + `bookerId`) so new entity types can reserve the room without schema changes. The `createdByUserId` always tracks the human who made the booking — that's who gets billed, who gets lock access, and who can cancel.

### Two-step flow: book then pay

Booking creates a `scheduled` reservation that holds the time slot. Payment (online or cash) transitions it to `confirmed`. This separation exists because members should be able to secure a time without committing to payment immediately, and staff can collect cash at the door for members who prefer that.

### Lock access as a side effect of payment

When a reservation is confirmed (paid), it becomes eligible for automatic lock provisioning. A morning-of process creates Ultraloc temporary users with access scoped to the reservation's time window. A next-day process cleans them up. This is purely additive — if the lock API is down, the reservation still works; staff is on-site regardless.

### Closures

A closure blocks the room for a time period (maintenance, holiday, ad-hoc). No booker entity needed — just a reason and a time range. Conflict detection checks both reservations and closures.

---

## Domain model

### Reservation

```
Reservation
  id                      uuid PK
  bookerType              text ('user' | 'band' | 'event' | 'lesson')
  bookerId                text
  createdByUserId         text FK → user
  status                  text ('scheduled' | 'confirmed' | 'completed' | 'no_show' | 'cancelled')
  startsAt                timestamp with tz
  endsAt                  timestamp with tz
  notes                   text?
  cancellationReason      text?
  stripePaymentRecordId   text?    -- set when paid (online or cash)
  lockAccessId            text?    -- Ultraloc temp user ID for cleanup
  createdAt               timestamp
  updatedAt               timestamp
```

### Closure

```
Closure
  id          uuid PK
  reason      text
  startsAt    timestamp with tz
  endsAt      timestamp with tz
  createdAt   timestamp
```

---

## State machine

```
Scheduled ──→ Confirmed ──→ Completed
    │              │
    │              └──→ NoShow
    │
    └──→ Cancelled
Confirmed ──→ Cancelled (triggers refund)
```

**Scheduled** — booked, slot held, not yet paid. Member can pay online or plan to pay cash at the door.

**Confirmed** — paid. Online payment (Stripe + credits), full credit coverage, or staff-recorded cash. Eligible for lock provisioning.

**Completed** — session happened. Set by staff via resolution queue or (future) auto-complete.

**NoShow** — confirmed but member didn't show up. Set by staff. No auto-refund.

**Cancelled** — cancelled by member or staff. If from confirmed, triggers refund via the finance module.

### Allowed transitions

| From      | To        | Triggered by                                                                   |
| --------- | --------- | ------------------------------------------------------------------------------ |
| Scheduled | Confirmed | Payment completed (Stripe webhook, credits fully cover, or staff records cash) |
| Scheduled | Cancelled | Member cancels, or staff cancels                                               |
| Confirmed | Completed | Staff marks complete via resolution queue                                      |
| Confirmed | NoShow    | Staff marks no-show via resolution queue                                       |
| Confirmed | Cancelled | Member cancels (refund triggered), or staff cancels                            |

### Staff resolution queue

After a reservation's end time passes, if it hasn't been marked completed or no-show, it appears in the staff resolution queue. The queue shows:

- **Confirmed reservations past their end time** — staff marks complete or no-show
- **Scheduled reservations past their end time** — staff marks as cash-received (→ confirmed → completed in one action) or no-show

This avoids auto-resolution and ensures accurate data for analytics.

---

## Booking flow

1. Member navigates to the booking page
2. Member picks a date — UI shows a day view with 30-minute slots from 9am–10pm
3. Booked slots and closures shown as unavailable. Buffer gaps also unavailable.
4. Member picks start time and end time (min 1 hour, max 8 hours, half-hour boundaries)
5. System validates: no conflicts, times within operating hours, duration within limits
6. Reservation created with status `scheduled`, `bookerType = 'user'`, `bookerId = user.id`
7. Member sees reservation on their dashboard with a "Pay Now" option

### Payment paths

**Path A — online with credits + Stripe:**
Member clicks Pay Now → existing `checkout()` flow. `free_hours` credits applied first (at $15/hr = 1 credit per hour). Stripe checkout for remainder. On webhook success → `confirmed`.

**Path B — credits fully cover it:**
Credits cover the entire cost → deducted immediately, no Stripe redirect → `confirmed`. A Stripe payment record is created with amount $0 for bookkeeping.

**Path C — cash at the door:**
Member shows up unpaid. Staff records cash via resolution queue → `recordCashPayment()` creates a Stripe payment record → `confirmed` → `completed`.

### Cancellation

- **Scheduled → Cancelled:** No payment, nothing to refund. Slot opens up.
- **Confirmed → Cancelled:** Triggers `refund()` from the payment service. Credits restored, Stripe payment refunded.
- **No time-based restrictions in v1.**

---

## Lock integration

### Daily lock job (morning)

A single scheduled process runs each morning that handles both provisioning and cleanup:

**Provision today's access:** For every reservation today with status `confirmed`:

1. Call Ultraloc API to create a temporary user with access from `startsAt` to `endsAt`
2. Store the returned temp user ID as `lockAccessId` on the reservation

**Clean up yesterday's access:** For every reservation from the previous day with a non-null `lockAccessId`:

1. Call Ultraloc API to remove the temporary user
2. Clear `lockAccessId`

### Resilience

Lock provisioning is best-effort. Failures don't affect reservation status. The system should retry once on failure and log for staff review if both attempts fail. No reservation state depends on lock state.

---

## Conflict detection

A conflict exists when a proposed time range overlaps with an existing non-cancelled reservation or closure, accounting for the configurable buffer.

### Against reservations

```
conflict exists when:
  proposed.startsAt < existing.endsAt + buffer
  AND proposed.endsAt + buffer > existing.startsAt
  AND existing.status NOT IN ('cancelled')
```

### Against closures

```
conflict exists when:
  proposed.startsAt < closure.endsAt
  AND proposed.endsAt > closure.startsAt
```

No buffer applied to closures — they represent hard blocks.

---

## Module boundaries

### Inside the reservation module

- Reservation and Closure schemas (Drizzle tables)
- ReservationService: create, cancel, pay, complete, mark no-show
- ConflictService: check availability, get available slots for a date
- LockService: provision access, cleanup access
- Routes and page server functions for booking UI and staff resolution

### Integration with finance module

The reservation module uses the existing payment service:

- `checkout()` with `eligibleCredits: [{ type: 'free_hours', unitValueCents: 1500 }]`
- `recordCashPayment()` for staff-recorded cash
- `refund()` for cancellation of confirmed reservations
- `onCheckoutComplete()` listener to transition scheduled → confirmed on payment success

The reservation module stores the `stripePaymentRecordId` returned by the payment service for refund linking.

### Cross-module events

| Event                        | Fired by             | Consumed by                                |
| ---------------------------- | -------------------- | ------------------------------------------ |
| `checkout.session.completed` | Stripe (via webhook) | Reservation module (scheduled → confirmed) |

The reservation module registers a checkout listener that checks for `reservation_id` in the session metadata. If present, it transitions that reservation to confirmed and stores the payment record ID.

---

## Schema

### reservation

| Column                   | Type        | Constraints                                                                                             |
| ------------------------ | ----------- | ------------------------------------------------------------------------------------------------------- |
| id                       | uuid        | PK, default gen_random_uuid()                                                                           |
| booker_type              | text        | NOT NULL, CHECK IN ('user', 'band', 'event', 'lesson')                                                  |
| booker_id                | text        | NOT NULL                                                                                                |
| created_by_user_id       | text        | NOT NULL, FK → user(id)                                                                                 |
| status                   | text        | NOT NULL, default 'scheduled', CHECK IN ('scheduled', 'confirmed', 'completed', 'no_show', 'cancelled') |
| starts_at                | timestamptz | NOT NULL                                                                                                |
| ends_at                  | timestamptz | NOT NULL                                                                                                |
| notes                    | text        |                                                                                                         |
| cancellation_reason      | text        |                                                                                                         |
| stripe_payment_record_id | text        |                                                                                                         |
| lock_access_id           | text        |                                                                                                         |
| created_at               | timestamptz | NOT NULL, default now()                                                                                 |
| updated_at               | timestamptz | NOT NULL, default now()                                                                                 |

**Constraints:**

- `CHECK (ends_at > starts_at)`

**Indexes:**

- `idx_reservation_conflict` on (starts_at, ends_at) WHERE status != 'cancelled'
- `idx_reservation_user` on (created_by_user_id, status)
- `idx_reservation_booker` on (booker_type, booker_id)
- `idx_reservation_resolution` on (status, ends_at) WHERE status IN ('scheduled', 'confirmed')

### closure

| Column     | Type        | Constraints                   |
| ---------- | ----------- | ----------------------------- |
| id         | uuid        | PK, default gen_random_uuid() |
| reason     | text        | NOT NULL                      |
| starts_at  | timestamptz | NOT NULL                      |
| ends_at    | timestamptz | NOT NULL                      |
| created_at | timestamptz | NOT NULL, default now()       |

**Constraints:**

- `CHECK (ends_at > starts_at)`

**Indexes:**

- `idx_closure_time` on (starts_at, ends_at)

---

## Configuration

| Setting                 | Default | Description                                    |
| ----------------------- | ------- | ---------------------------------------------- |
| `HOURLY_RATE_CENTS`     | 1500    | Per-hour cost ($15.00)                         |
| `TIME_SLOT_MINUTES`     | 30      | Granularity of time slots                      |
| `MIN_DURATION_HOURS`    | 1       | Minimum reservation duration                   |
| `MAX_DURATION_HOURS`    | 8       | Maximum reservation duration                   |
| `OPERATING_HOURS_START` | "09:00" | Earliest bookable time                         |
| `OPERATING_HOURS_END`   | "22:00" | Latest end time                                |
| `BUFFER_MINUTES`        | 0       | Required gap between back-to-back reservations |

---

## Member-facing UI

### Book a room (`/member/reservations/new`)

- Date picker (defaults to today or next available)
- Day view showing 30-minute slots from 9am–10pm
- Booked slots and closures visually blocked out
- Member clicks a start time, then an end time (or drags to select range)
- Duration validation shown inline
- Notes field (optional)
- Submit → reservation created, redirect to confirmation/payment page

### My reservations (`/member/reservations`)

- List of upcoming and past reservations
- Each shows: date/time, status badge, duration
- Actions: Pay Now (if scheduled), Cancel
- Filter: upcoming vs past

### Payment page (`/member/reservations/[id]/pay`)

- Shows reservation details and cost breakdown
- Credits available and how many will be applied
- "Cover processing fees" checkbox
- Pay button → Stripe checkout or instant confirmation if credits cover it

---

## Staff UI

### Resolution queue (`/staff/reservations/resolve`)

- Shows reservations past their end time that need resolution
- Two categories:
  - Confirmed but not completed → mark Complete or No-Show
  - Scheduled (unpaid) past end time → mark Cash Received or No-Show
- Cash Received calls `recordCashPayment()` then transitions to completed
- Sorted by most recent first

### Closures (`/staff/closures`)

- List existing closures
- Create new: pick start datetime, end datetime, reason
- Delete a closure (future closures only)

---

## Permissions

| Action                                         | Who                                           |
| ---------------------------------------------- | --------------------------------------------- |
| Create reservation                             | Any authenticated member                      |
| Cancel own reservation                         | The member who created it (`createdByUserId`) |
| Pay for own reservation                        | The member who created it                     |
| View own reservations                          | The member who created it                     |
| Resolve reservations (complete, no-show, cash) | Staff                                         |
| Manage closures (create, delete)               | Staff                                         |

---

## What changes

| Area                | Change                                                            |
| ------------------- | ----------------------------------------------------------------- |
| Database            | New tables: `reservation`, `closure`                              |
| Finance module      | Reservation checkout listener registered via `onCheckoutComplete` |
| Member layout       | New nav item: Reservations                                        |
| Staff layout        | New nav items: Resolution Queue, Closures                         |
| Scheduled processes | Morning lock provisioning, next-day lock cleanup                  |
| Environment         | Ultraloc API credentials (client ID, secret, device ID)           |

## What doesn't change

| Area                    | Notes                                                         |
| ----------------------- | ------------------------------------------------------------- |
| Subscription/membership | Free hours already allocated monthly                          |
| Credit system           | `free_hours` wallet already exists, deduction logic unchanged |
| Payment service         | `checkout()`, `recordCashPayment()`, `refund()` used as-is    |
| Webhook route           | Already dispatches to registered listeners                    |
| Auth/authorization      | No new roles needed                                           |

---

## Deferred

- **Recurring reservations** — RRULE-based series that generate instances ahead. Adds a `recurring_series` table and a daily generation job.
- **Band bookings** — `bookerType = 'band'` is ready in the schema, but the bands module doesn't exist yet.
- **Events system** — will create reservations with `bookerType = 'event'` or closures, blocking practice time. Separate feature.
- **Lessons** — same pattern as events. Future booker type.
- **Notifications** — email confirmations, reminders, cancellation notices.
- **Cancellation policy** — time-based restrictions (e.g., no cancellation within 24 hours of start).
- **Auto-complete** — automatically marking confirmed reservations as completed after their end time. For now, staff resolves manually.
- **Multiple rooms** — adds a `resource` table and a FK on reservation. Config moves from app-level to per-resource.
- **Calendar sync** — push reservations to Google Calendar.

---

## Open questions

None — all questions resolved during design conversation.
