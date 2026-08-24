# Recurring Reservations

Sustaining members can set up a recurring series that automatically books the same time slot on a repeating schedule (weekly, biweekly, or monthly). Each generated instance is a normal reservation that follows the standard book-then-pay lifecycle — the member still confirms and pays before each session. A daily cron job generates instances 2.5 weeks ahead, giving recurring series priority over one-off bookings (which are limited to a 2-week advance window).

The system is designed as a generic recurrence engine. A recurring series references a prototype reservation — the first booking in the series — and clones its properties (booker type, booker ID, duration, notes) for each generated instance. This means the series table is purely about scheduling, and any booker type that can create a reservation can also recur.

When a member edits a recurrence, the old series is cancelled and a `superseded_by` pointer links it to the replacement. Querying for active recurrences is a single `WHERE superseded_by IS NULL AND status = 'active'` — no chain-walking required.

---

## Why recurring reservations

Sustaining members contribute monthly and get free practice hours in return. Many have a regular schedule — "every Tuesday 7–9pm" or "first and third Saturday mornings." Today they rebook manually each week, competing with one-off bookings for the same slots. A recurring reservation removes that friction: set it up once, and the slot is held automatically. The half-week priority window (2.5 weeks vs 2 weeks) means the recurring slot is already booked before anyone can try to claim it with a one-off reservation.

---

## Core concepts

### Recurring series

A recurring series pairs an RRULE schedule with a prototype reservation. The prototype is the first reservation the member creates when setting up the recurrence — it's a real reservation that holds the time slot for its own date, and also serves as the template for all future instances. The generation job reads the prototype's `bookerType`, `bookerId`, `createdByUserId`, duration (from `startsAt`/`endsAt`), and `notes`, and stamps each new instance with those values.

The series table itself stores only the RRULE string, a reference to the prototype, and a `supersededBy` pointer for chaining edited versions together.

### Series chaining (editing)

When a member edits a recurring reservation (changes the day, time, duration, or frequency), the system cancels the current series and creates a new one. The old series gets a `supersededBy` pointer to the replacement, forming a forward-linked chain that represents the full history of a single logical recurrence.

Active recurrences are found with `WHERE superseded_by IS NULL AND status = 'active'` — no recursive chain-walking. To view the edit history, follow the `supersededBy` pointers forward from the oldest series.

### Instance generation

A daily cron job (midnight) expands each active series into concrete reservations. For each series, it uses the `rrule` library to compute occurrence dates within the generation window (today through 2.5 weeks out), skips dates that already have an instance, and creates a `scheduled` reservation for each new date — cloning properties from the prototype.

Before creating, the job checks for conflicts with event-type reservations and closures. If a conflict exists, that occurrence is skipped and the member is notified. One-off user/band reservations cannot conflict because the 2.5-week window ensures the recurring instance is created first.

### Advance booking windows

Two advance booking limits enforce the priority mechanism:

- **Recurring series:** 2.5 weeks (17.5 days) ahead
- **One-off reservations:** 2 weeks (14 days) ahead

The one-off limit is a new constraint that doesn't exist today. It needs to be added to `validateBooking()` in the conflict service and configured in `config.ts`.

### Confirmation flow

Generated instances follow the same lifecycle as any reservation. The existing confirmation reminder cron fires 3 days before, prompting the member to confirm and pay (credits, card, or cash). If they don't confirm, staff handles it through the resolution queue.

---

## Domain model

### RecurringSeries

```
RecurringSeries
  id              uuid PK
  supersededBy    uuid? FK → recurring_series   -- the series that replaced this one (null if current)
  prototypeType   text                          -- 'reservation', 'event', etc.
  prototypeId     text                          -- polymorphic FK to the template entity
  rrule           text                          -- RFC 5545 RRULE string with DTSTART and TZID
  createdAt       timestamptz
  cancelledAt     timestamptz                   -- null = active
```

`prototypeType` determines which generation cron owns the series. `prototypeId` points to the template entity — for recurring reservations, that's a reservation UUID; for recurring events, an event UUID. Each cron filters by its prototype type and knows how to clone properties from its prototype.

No status column — state is derived from two nullable columns:

- **Active:** `cancelled_at IS NULL AND superseded_by IS NULL`
- **Cancelled (stopped):** `cancelled_at IS NOT NULL AND superseded_by IS NULL`
- **Edited (replaced):** `superseded_by IS NOT NULL`

### Reservation (modified)

Add one nullable FK to the existing reservation table:

```
  recurringSeriesId   uuid? FK → recurring_series   -- null for one-off reservations
```

This links generated instances back to their series and lets the generation job check which dates already have instances. The prototype reservation also has this FK set, pointing to its own series.

---

## State machine

### Series lifecycle

```
active ──→ cancelled             (member cancels, subscription lapses, or staff cancels)
active ──→ superseded            (series edited — cancelled_at set, superseded_by set to replacement)
```

Both transitions are terminal. The distinction between "stopped" and "replaced" is whether `superseded_by` is set. No status column needed — state is fully determined by `cancelled_at` and `superseded_by`.

**Automatic cancellation:** When a member's subscription ends (`customer.subscription.deleted` webhook), all their active series are cancelled (`cancelled_at` set). No new instances are generated.

### Instance lifecycle

Generated instances use the existing reservation state machine — `scheduled → confirmed → completed`, with the same cancel, no-show, and cash-received transitions. Nothing changes here.

---

## Setup flow

1. Sustaining member navigates to the booking page and selects a time slot
2. UI offers "Make this recurring" option (only shown to sustaining members)
3. Member picks frequency: weekly, biweekly, or monthly
4. System creates the reservation (the prototype) with `status = 'scheduled'`
5. System creates a `recurring_series` with `prototypeId` pointing to that reservation
6. The prototype reservation's `recurringSeriesId` is set to the new series
7. If the selected date conflicts with an event/closure, the system walks forward through the RRULE to find the first non-conflicting occurrence and creates the prototype there instead
8. Member sees the reservation and can pay through the normal checkout flow
9. The generation job fills in future instances on its next run (or inline at creation time)

### RRULE construction

From the member's selection, the system builds an RRULE string:

| Frequency | RRULE                                                                       |
| --------- | --------------------------------------------------------------------------- |
| Weekly    | `FREQ=WEEKLY;BYDAY=TU` (day derived from selected date)                     |
| Biweekly  | `FREQ=WEEKLY;INTERVAL=2;BYDAY=TU`                                           |
| Monthly   | `FREQ=MONTHLY;BYDAY=3TU` (nth weekday of month, derived from selected date) |

The `DTSTART` is set to the selected date/time in `America/Los_Angeles`. The `rrule` library handles DST transitions from there.

Monthly uses nth-weekday-of-month (e.g., "third Tuesday") rather than date-of-month (e.g., "the 15th") because a fixed calendar date would drift across weekdays and frequently land on different days than the member intended.

---

## Edit flow

1. Member navigates to their recurring reservation and chooses "Edit schedule"
2. Member selects a new day/time, duration, or frequency
3. System creates a new reservation (the new prototype) at the next occurrence of the new schedule
4. System creates a new series with `prototypeId` pointing to the new reservation
5. System cancels the old series (`cancelledAt = now()`) and sets `supersededBy` to the new series ID
6. Already-generated future instances from the old series remain as-is — the member can cancel them individually or let them play out
7. The generation job picks up the new series on its next run

---

## Generation flow

Daily cron job at `/api/cron/generate-recurring-reservations`, scheduled for 00:00 Pacific.

For each active series where `cancelled_at IS NULL AND superseded_by IS NULL AND prototype_type = 'reservation'`:

1. Parse the RRULE string into an `RRule` instance
2. Load the prototype reservation to get `bookerType`, `bookerId`, `createdByUserId`, duration, and `notes`
3. Compute occurrences between now and now + 17.5 days (the generation window)
4. For each occurrence date:
   a. Compute `startsAt` from the occurrence date; compute `endsAt` by adding the prototype's duration
   b. Check if a reservation already exists for this series on this date (query by `recurringSeriesId` + date match, including cancelled reservations)
   c. If an instance already exists, skip
   d. Check for conflicts with event-type reservations (`bookerType = 'event'`) and closures
   e. If conflict found, skip this occurrence and emit `reservation.recurring_skipped` event (triggers member notification)
   f. If no conflict, insert a new reservation cloned from the prototype: `status = 'scheduled'`, `bookerType`, `bookerId`, `createdByUserId`, `startsAt`, `endsAt`, `notes`, `recurringSeriesId = series.id`

### Conflict check scoping

The generation job only skips for **events and closures**, not for one-off user/band reservations. The 2.5-week window ensures recurring instances are created before one-offs can reach that date, so there's no race. If somehow a conflict with a one-off exists (e.g., a staff-created override), the normal conflict detection on the one-off booking side would reject it — not the generation job.

### Resilience

The job processes each series independently. If one series fails (bad RRULE, DB error), log the error and continue with the next. The job should be idempotent — running it twice for the same day produces no duplicates because step 4b checks for existing instances.

**Important:** The existence check must include cancelled reservations. Otherwise, cancelling an instance and re-running the generation job would recreate it.

---

## Cancellation

### Cancel single instance

A member cancels one generated reservation through the normal cancel flow. The series continues generating future instances. The cancelled reservation stays in the DB with `status = 'cancelled'`, and the generation job's existence check sees it and doesn't recreate it.

### Cancel entire series

Member or staff sets `cancelledAt = now()` on the series. The generation job skips it. Future instances that were already generated remain as-is (the member can cancel them individually or let them go through the normal flow). No bulk cancellation of already-generated instances — they're real reservations that might already be confirmed/paid.

### Subscription lapse

When the `customer.subscription.deleted` webhook fires, a new listener cancels all active/paused series for that user. This is the same webhook that already handles credit balance cleanup.

---

## Member-facing UI

### Booking page changes

The existing booking flow at `/member/reservations/new` gets a "Make this recurring" enhancement:

- After selecting a time slot, if the user is a sustaining member, show a toggle/option: "Repeat this reservation"
- When enabled, show frequency picker: Weekly / Every 2 weeks / Monthly
- Submit creates the series + prototype instead of just a one-off reservation

### My reservations changes

- Recurring instances show a small "recurring" badge or icon
- Tapping a recurring instance shows a link to "Manage series"
- Series management view shows: frequency, next occurrence, and actions (edit schedule, cancel series)

### My recurring reservations

A dedicated section or tab in the member reservations area showing active recurrences:

- Recurrence card: day/time, frequency, duration, active/cancelled indicator
- Actions: Edit schedule / Cancel series
- Shows upcoming generated instances with their confirmation status

---

## Staff UI

### Recurring reservations page (`/staff/recurring`)

Staff resource matching the Laravel `RecurringReservations` resource:

- List all active recurrences across all members (`WHERE superseded_by IS NULL AND status = 'active'`)
- Columns: Member name, day/time, frequency, duration, status, created date
- Filters: active/cancelled, member search
- Actions: Edit, cancel
- Click through to see series detail with generated instances and edit history (via `superseded_by` chain)

### Reservation list changes

- Recurring instances show a badge/indicator in the existing reservations list
- Filter option to show only recurring or only one-off reservations

---

## Module boundaries

### Inside the reservation module

- `recurring_series` schema (Drizzle table)
- `recurring-series-service.ts`: create, edit, cancel, list, get, getHistory
- Generation job logic (called by cron endpoint)
- RRULE construction helpers

### Integration points

| Concern                    | Integration                                                                            |
| -------------------------- | -------------------------------------------------------------------------------------- |
| Subscription check (setup) | `getSubscription()` from finance module — series creation requires active subscription |
| Subscription lapse         | New listener on `customer.subscription.deleted` webhook cancels active series          |
| Notifications              | New `reservation.recurring_skipped` event for skipped occurrences                      |
| Confirmation reminders     | No change — existing cron already handles all `scheduled` reservations                 |
| One-off booking limit      | New `MAX_ADVANCE_DAYS_ONEOFF` config value, enforced in `validateBooking()`            |

### Cross-module events

| Event                                      | Fired by       | Consumed by                                              |
| ------------------------------------------ | -------------- | -------------------------------------------------------- |
| `reservation.recurring_skipped`            | Generation job | Notification dispatcher (email + in-app to series owner) |
| `customer.subscription.deleted` (existing) | Stripe webhook | New listener: cancel user's active series                |

---

## Schema

### recurring_series

| Column         | Type        | Constraints                                  |
| -------------- | ----------- | -------------------------------------------- |
| id             | uuid        | PK, default gen_random_uuid()                |
| superseded_by  | uuid        | FK → recurring_series(id) ON DELETE SET NULL |
| prototype_type | text        | NOT NULL                                     |
| prototype_id   | text        | NOT NULL                                     |
| rrule          | text        | NOT NULL                                     |
| created_at     | timestamptz | NOT NULL, default now()                      |
| cancelled_at   | timestamptz |                                              |

**Indexes:**

- `idx_recurring_series_active` on (prototype_type) WHERE cancelled_at IS NULL AND superseded_by IS NULL
- `idx_recurring_series_prototype` on (prototype_type, prototype_id)

### reservation (modified)

| Column              | Type | Constraints                                  |
| ------------------- | ---- | -------------------------------------------- |
| recurring_series_id | uuid | FK → recurring_series(id) ON DELETE SET NULL |

**New index:**

- `idx_reservation_recurring` on (recurring_series_id, starts_at) WHERE recurring_series_id IS NOT NULL

This index supports the generation job's "does an instance already exist for this series + date" check.

---

## Configuration

New config values in `config.ts`:

| Setting                      | Default                             | Description                                        |
| ---------------------------- | ----------------------------------- | -------------------------------------------------- |
| `MAX_ADVANCE_DAYS_ONEOFF`    | 14                                  | Maximum days ahead for one-off reservations        |
| `MAX_ADVANCE_DAYS_RECURRING` | 17.5                                | Generation window for recurring series (2.5 weeks) |
| `RECURRING_FREQUENCIES`      | `['weekly', 'biweekly', 'monthly']` | Allowed recurrence frequencies                     |

---

## Notifications

| Event                           | Channel        | Recipient    | Content                                                                                              |
| ------------------------------- | -------------- | ------------ | ---------------------------------------------------------------------------------------------------- |
| `reservation.recurring_skipped` | Email + in-app | Series owner | "Your recurring [day] [time] reservation was skipped this week due to [event name / closure reason]" |

Confirmation reminders for generated instances are handled by the existing `confirmation-reminders` cron — no changes needed there.

---

## Permissions

| Action                            | Who                                                    |
| --------------------------------- | ------------------------------------------------------ |
| Create recurring series           | Sustaining members only (active subscription required) |
| Edit own series (change schedule) | Series owner                                           |
| Cancel own series                 | Series owner                                           |
| View own series                   | Series owner                                           |
| Manage any series (edit, cancel)  | Staff                                                  |
| View all series                   | Staff                                                  |

---

## What changes

| Area                   | Change                                                                            |
| ---------------------- | --------------------------------------------------------------------------------- |
| Database               | New table: `recurring_series`. New column on `reservation`: `recurring_series_id` |
| Dependencies           | Add `rrule` npm package                                                           |
| Reservation config     | New `MAX_ADVANCE_DAYS_ONEOFF` and `MAX_ADVANCE_DAYS_RECURRING` values             |
| Conflict service       | `validateBooking()` enforces max advance days (new check)                         |
| Booking UI             | "Make this recurring" option for sustaining members                               |
| Member reservations UI | Recurring badge on instances, series management view, edit schedule               |
| Staff layout           | New nav item: Recurring Reservations                                              |
| Cron jobs              | New `/api/cron/generate-recurring-reservations` endpoint                          |
| Event bus              | New `reservation.recurring_skipped` event type + payload                          |
| Notification types     | New `recurring_skipped` notification type registered in dispatcher                |
| Webhook listener       | `customer.subscription.deleted` gains a recurring-series cancellation listener    |

## What doesn't change

| Area                      | Notes                                                                           |
| ------------------------- | ------------------------------------------------------------------------------- |
| Reservation state machine | Generated instances use the existing scheduled → confirmed → completed flow     |
| Payment service           | No changes — members pay for each instance through normal checkout/cash/credits |
| Confirmation reminders    | Existing cron already picks up all `scheduled` reservations                     |
| Lock provisioning         | Already handles all `confirmed` reservations regardless of origin               |
| Resolution queue          | Staff resolves recurring instances the same as one-offs                         |

---

## Deferred

- **Auto-pay with card on file** — Charge a saved payment method automatically when instances are generated, skipping the manual confirmation step. Separate feature that touches the payment service.
- **Recurring events** — Add `/api/cron/generate-recurring-events` filtering `prototype_type = 'event'`. Different conflict rules (events have priority, may create closures). The `recurring_series` table already supports this — just needs its own generation endpoint.
- **Recurring lessons** — Same pattern: own cron endpoint, `prototype_type = 'lesson'`. Deferred until lessons module exists.
- **Conflict notification details** — Including the specific event name or closure reason in the skip notification requires joining against the conflicting entity during generation.
- **Multiple rooms** — When rooms are added, the prototype reservation would carry the resource FK, so generated instances inherit it automatically. No schema change needed on `recurring_series`.

---

## Open questions

None — all questions resolved during design conversation.
