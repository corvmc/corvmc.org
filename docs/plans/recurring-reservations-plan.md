# Recurring Reservations — Implementation Plan

Sequenced for a solo developer working through it PR by PR.

---

## Epic 1: Schema and config

Foundation. The table and config values need to exist before anything can use them.

### 1.1 Install rrule

Run `pnpm add rrule`. The package uses luxon internally for timezone support (already installed).

### 1.2 Add recurring_series schema

Create `src/lib/server/db/schema/recurring.ts` with one table:

**`recurring_series`** — `id` (uuid, PK, defaultRandom), `supersededBy` (uuid, nullable, self-referential FK on delete set null), `prototypeType` (text, not null), `prototypeId` (text, not null), `rrule` (text, not null), `createdAt` (timestamptz, not null, defaultNow), `cancelledAt` (timestamptz, nullable).

Indexes: partial index on `(prototype_type)` where `cancelled_at IS NULL AND superseded_by IS NULL`, composite on `(prototype_type, prototype_id)`.

Export from `src/lib/server/db/schema/index.ts`.

### 1.3 Add recurring_series_id to reservation

Add a nullable `recurringSeriesId` (uuid, FK → recurring_series on delete set null) column to the reservation table in `src/lib/server/db/schema/reservation.ts`.

Add a partial index on `(recurring_series_id, starts_at)` where `recurring_series_id IS NOT NULL`.

### 1.4 Add advance booking config

Add two new constants to `src/lib/server/reservation/config.ts`:

- `MAX_ADVANCE_DAYS_ONEOFF = 14`
- `MAX_ADVANCE_DAYS_RECURRING = 17.5`

### 1.5 Add advance booking validation

Modify `validateBooking()` in `src/lib/server/reservation/conflict-service.ts` to accept an optional `isRecurring` parameter. Add a check: if the reservation's `startsAt` is more than `MAX_ADVANCE_DAYS_ONEOFF` days in the future (or `MAX_ADVANCE_DAYS_RECURRING` if `isRecurring`), return a validation error.

Default to `MAX_ADVANCE_DAYS_ONEOFF` when the parameter is omitted so all existing callers get the one-off limit without changes.

**Tests** (add to existing conflict service tests or new file):

- One-off booking 13 days ahead → valid.
- One-off booking 15 days ahead → invalid with "exceeds advance booking window" error.
- Recurring booking 16 days ahead → valid.
- Recurring booking 18 days ahead → invalid.

### 1.6 Generate migration

Run `pnpm drizzle-kit generate` to produce the migration SQL for the new table and the new column on reservation. Verify the output includes the `recurring_series` table, the `recurring_series_id` column on reservation, all indexes, and the self-referential FK.

---

## Epic 2: Recurring series service

Core business logic. The service manages series lifecycle and RRULE construction.

### 2.1 RRULE construction helpers

Create `src/lib/server/reservation/rrule-helpers.ts` with:

- `buildRRule(options)` — Accepts `{ startsAt: Date, frequency: 'weekly' | 'biweekly' | 'monthly' }` and returns an RRULE string. Derives `BYDAY` from the date's day of week. For monthly, computes the nth-weekday-of-month (e.g., "third Tuesday" → `BYDAY=3TU`). Sets `DTSTART` in `America/Los_Angeles` timezone. Uses `INTERVAL=2` for biweekly.

- `parseRRule(rruleString)` — Wraps `RRule.fromString()` with the `America/Los_Angeles` timezone. Returns the `RRule` instance.

- `getOccurrencesBetween(rruleString, from, to)` — Parse the RRULE and return occurrence dates within the range as `Date[]`.

- `describeSchedule(rruleString)` — Human-readable description for display: "Every Tuesday", "Every other Wednesday", "Third Saturday of the month". Use `RRule.prototype.toText()` if the output is acceptable, otherwise format manually.

**Tests** (`src/lib/server/reservation/rrule-helpers.spec.ts`):

- Weekly: given a Tuesday date, RRULE contains `FREQ=WEEKLY;BYDAY=TU`.
- Biweekly: RRULE contains `FREQ=WEEKLY;INTERVAL=2;BYDAY=WE` for a Wednesday.
- Monthly: third Tuesday of month → `FREQ=MONTHLY;BYDAY=3TU`.
- `getOccurrencesBetween` returns correct dates for a 2.5-week window.
- DST transition: an occurrence crossing spring-forward still lands at the correct local time.
- `describeSchedule` returns readable English for all three frequencies.

### 2.2 Recurring series service

Create `src/lib/server/reservation/recurring-series-service.ts` with:

- `create(options)` — Accepts `{ userId, prototypeReservationId, frequency }`. Validates: user has active subscription (call `getSubscription()`), prototype reservation exists and belongs to user. Builds RRULE from the prototype's `startsAt` + frequency. Inserts `recurring_series` row with `prototypeType = 'reservation'`, `prototypeId = prototypeReservationId`. Updates the prototype reservation's `recurringSeriesId` to the new series. Returns the series. If the prototype's date conflicts with an event/closure, walk forward through the RRULE to find the first non-conflicting occurrence and adjust the prototype's `startsAt`/`endsAt` before creating the series.

- `edit(seriesId, options)` — Accepts `{ newPrototypeReservationId, frequency? }`. Creates a new series with the new prototype. Sets `supersededBy` on the old series to the new series ID, sets `cancelledAt = now()` on the old series. Returns the new series.

- `cancel(seriesId)` — Sets `cancelledAt = now()`. Throws if already cancelled/superseded.

- `cancelAllForUser(userId)` — Cancels all active series for a user. Used by the subscription deletion listener. Sets `cancelledAt = now()` on all series where `cancelledAt IS NULL AND superseded_by IS NULL` and the prototype reservation's `createdByUserId = userId`.

- `getActive(seriesId)` — Returns the series if active, null otherwise.

- `listForUser(userId)` — Returns all current (non-superseded) series for a user, joined with prototype reservation for display data.

- `listAll(filters?)` — Staff query. Returns all current series across users, joined with prototype reservation and user for display. Optional status filter (active/cancelled).

- `getHistory(seriesId)` — Follows the `supersededBy` chain forward to build the edit history.

**Tests** (`src/lib/server/reservation/recurring-series-service.spec.ts`):

- `create` inserts series with correct RRULE, links prototype reservation.
- `create` rejects non-sustaining members.
- `edit` cancels old series, creates new one, sets `supersededBy`.
- `cancel` sets `cancelledAt`, rejects double-cancel.
- `cancelAllForUser` cancels all active series for the user, leaves other users untouched.
- `listForUser` returns only non-superseded series.

---

## Epic 3: Generation cron job

The daily job that creates reservation instances from active series.

### 3.1 Generation logic

Create `src/lib/server/reservation/generate-recurring-reservations.ts` with:

- `generateRecurringReservations()` — The main function called by the cron endpoint.
  1. Query all active series where `cancelled_at IS NULL AND superseded_by IS NULL AND prototype_type = 'reservation'`, joined with the prototype reservation.
  2. For each series, call `getOccurrencesBetween(series.rrule, now, now + MAX_ADVANCE_DAYS_RECURRING days)`.
  3. For each occurrence date, compute `startsAt` and `endsAt` (using prototype's duration).
  4. Check existence: query reservation where `recurringSeriesId = series.id` and `startsAt` matches the occurrence (any status, including cancelled).
  5. If exists, skip.
  6. Check conflicts: query for event-type reservations (`bookerType = 'event'`, non-cancelled) and closures overlapping `startsAt`/`endsAt`.
  7. If conflict, emit `reservation.recurring_skipped` domain event and skip.
  8. If clear, insert reservation cloned from prototype: `bookerType`, `bookerId`, `createdByUserId`, `startsAt`, `endsAt`, `notes`, `recurringSeriesId = series.id`, `status = 'scheduled'`.
  9. Wrap each series in try-catch. Log errors and continue to next series.
  10. Return stats: `{ processed: number, created: number, skipped: number, errors: number }`.

The existence check in step 4 should match on the date portion in `America/Los_Angeles` timezone, not exact timestamp equality — this handles edge cases where DST causes a 1-hour shift between the RRULE occurrence and an already-created reservation.

### 3.2 Cron endpoint

Create `src/routes/api/cron/generate-recurring-reservations/+server.ts` following the pattern in `auto-complete/+server.ts`:

- POST handler, protected by `CRON_SECRET` bearer token.
- Calls `generateRecurringReservations()`.
- Returns JSON with stats.

### 3.3 Add domain event for skipped occurrences

Add `RecurringSkippedEvent` interface and `'reservation.recurring_skipped'` to the event map in `src/lib/server/event-bus/event-bus.ts`:

```typescript
export interface RecurringSkippedEvent {
	seriesId: string;
	userId: string;
	userName: string;
	userEmail: string;
	date: string;
	startTime: string;
	endTime: string;
	reason: string; // e.g. "Event: Open Mic Night" or "Closure: Holiday"
}
```

**Tests** (`src/lib/server/reservation/generate-recurring-reservations.spec.ts`):

- Active series with no existing instances → creates reservations for each occurrence in window.
- Already-existing instance (any status including cancelled) → skipped, not recreated.
- Event conflict → skipped, `recurring_skipped` event emitted.
- Closure conflict → skipped.
- One-off reservation on same slot → NOT skipped (only events/closures trigger skip).
- Cancelled series → not processed.
- Superseded series → not processed.
- Bad RRULE → logged, other series still processed.
- Idempotent: running twice produces no duplicates.
- Prototype properties cloned correctly (bookerType, bookerId, notes, etc.).

---

## Epic 4: Webhook integration

Wire up the subscription cancellation listener.

### 4.1 Cancel series on subscription deletion

Modify `handleSubscriptionDeleted()` in `src/lib/server/finance/webhook-handlers.ts` to also call `cancelAllForUser(member.id)` after resetting credits. Import from the recurring series service.

Alternatively, if you prefer keeping webhook handlers thin, emit a domain event from `handleSubscriptionDeleted` and add a listener in `register-listeners.ts`. But since the existing handler already does work inline (credit reset), adding the series cancellation inline is consistent.

**Tests** (add to `webhook-handlers.spec.ts`):

- `handleSubscriptionDeleted` cancels all active series for the user.
- `handleSubscriptionDeleted` still resets credits (existing behavior preserved).

---

## Epic 5: Notification

Wire up the skip notification.

### 5.1 Add notification type

Add to `NOTIFICATION_TYPES` array in `src/lib/server/notification/notification-types.ts`:

```typescript
{
  key: 'recurring_skipped',
  label: 'Recurring reservation skipped',
  description: 'Notification when a recurring reservation is skipped due to a conflict',
  defaults: { email: true, inApp: true }
}
```

### 5.2 Add email template

Add a `recurringSkipped` template to the email template system (following the pattern of existing templates). Content: "Your recurring [day] [time] reservation was skipped this week due to [reason]."

### 5.3 Add notification listener

Add a listener for `reservation.recurring_skipped` in `src/lib/server/notification/notification-listeners.ts`, following the pattern of the reservation reminder listener. Dispatches via `dispatch()` with both email and in-app channels.

---

## Epic 6: Staff UI

Staff panel for managing recurring series.

### 6.1 Staff recurring series queries

Create `src/routes/staff/recurring/data.remote.ts` with query functions:

- `getRecurringSeries()` — Calls `listAll()` from the service. Returns series list with prototype reservation data and user info.
- `cancelSeries(id)` — Calls `cancel()` from the service.

### 6.2 Staff recurring series list page

Create `src/routes/staff/recurring/+page.svelte`:

- PageHeader with title "Recurring Reservations".
- Filters: active/cancelled toggle, member name search.
- DataTable with columns: Member (MemberLink), Schedule (human-readable from `describeSchedule`), Duration, Day/Time (from prototype), Created, Status (active/cancelled indicator).
- Row click → detail view.
- Cancel action per row.

Create `src/routes/staff/recurring/+page.server.ts` with server load calling `listAll()`.

### 6.3 Staff recurring series detail page

Create `src/routes/staff/recurring/[id]/+page.svelte`:

- PageHeader with series info (schedule description, member name).
- InfoCard showing: frequency, day/time, duration, status, created date.
- Generated instances table: list of reservations where `recurringSeriesId = series.id`, showing date, status, payment status. Reuses the reservation table pattern.
- Edit history section: shows chain of superseded series if any.
- Cancel action button.

### 6.4 Add recurring badge to reservation list

Modify `src/routes/staff/reservations/+page.svelte` to show a small recurring icon/badge on reservations where `recurringSeriesId IS NOT NULL`. Add a filter option for recurring vs one-off.

### 6.5 Add nav item

Add `{ href: '/staff/recurring', label: 'Recurring', icon: IconRepeat }` to the staff layout nav in `src/routes/staff/+layout.svelte`. Import `IconRepeat` from `@tabler/icons-svelte`. Place it after the Reservations link.

---

## Epic 7: Member UI

Member-facing booking and management.

### 7.1 Sustaining member check helper

Create a reusable helper (or use inline in the page server) that checks if a user is a sustaining member. The pattern already exists in `src/routes/events/[id]/tickets/+page.server.ts` — check `locals.user?.stripeId`, then `getSubscription(stripeId) !== null`. Consider extracting to a shared utility if it doesn't already exist.

### 7.2 Booking page — "Make this recurring" option

Modify the booking flow at `/member/reservations/new` (or wherever the slot selection lives):

- In the page server load, check if the user is a sustaining member and pass `isSustainingMember` to the page.
- In the page component, after slot selection, conditionally show a "Repeat this reservation" toggle (only for sustaining members).
- When enabled, show a frequency picker: Weekly / Every 2 weeks / Monthly.
- On form submission, if recurring is enabled: create the reservation (prototype) via the normal flow, then call the recurring series service to create the series and link it.

### 7.3 Member recurring reservations section

Add a section to the member reservations page (or a new tab/route at `/member/reservations/recurring`):

- List active recurrences for the user (from `listForUser()`).
- Each shows: schedule description, day/time, duration, next upcoming instance.
- Actions: Edit schedule, Cancel series.

### 7.4 Recurring badge on member reservations

Modify the member reservations list to show a small recurring indicator on instances linked to a series. Add a "Manage series" link that navigates to the series management view.

### 7.5 Edit schedule flow

Build the edit flow (could be a modal or separate page):

- Pre-fill with current schedule (day, time, duration, frequency).
- On submit: create a new reservation at the next occurrence of the new schedule, call `edit()` on the service which creates the new series and supersedes the old one.

---

## Epic 8: Parity report and final verification

### 8.1 Update parity report

In `docs/reports/parity-report.md`:

- Update the "Recurring reservations" row in the staff panel table to `✅` with notes.
- Update the "Recurring reservation generation" row in the scheduled jobs table to `✅ /api/cron/generate-recurring-reservations`.
- Strike through item 5 in the build order.

### 8.2 End-to-end smoke test

Verify the full lifecycle manually or with integration tests:

1. Create a sustaining member (active subscription).
2. Book a time slot and enable "Make this recurring" with weekly frequency.
3. Verify the prototype reservation is created with `recurringSeriesId` set.
4. Run the generation cron. Verify instances are created for the next 2.5 weeks.
5. Run the cron again. Verify no duplicates.
6. Cancel one instance. Run cron again. Verify it's not recreated.
7. Create an event overlapping one future occurrence. Run cron. Verify that occurrence is skipped and the `recurring_skipped` notification fires.
8. Edit the series (change day). Verify old series is superseded, new series is active, new prototype is created.
9. Cancel the series. Verify `cancelledAt` is set, cron skips it.
10. Delete the user's subscription. Verify all active series are cancelled.

---

## Dependency graph

```
Epic 1 (schema + config)
  └─▶ Epic 2 (series service)
        ├─▶ Epic 3 (generation cron)
        │     └─▶ Epic 5 (notifications)
        ├─▶ Epic 4 (webhook integration)
        ├─▶ Epic 6 (staff UI)
        └─▶ Epic 7 (member UI)

Epic 8 (parity report + smoke test) ── after all others
```

Epics 3–7 can be worked in any order after Epic 2 is complete. Epics 4, 5, 6, and 7 are independent of each other.

---

## Out of scope

- **Auto-pay with card on file** — Separate payment service feature.
- **Recurring events** — Own cron endpoint with `prototype_type = 'event'`, different conflict rules.
- **Recurring lessons** — Own cron endpoint, deferred until lessons module.
- **Conflict notification details** — Including event name or closure reason in skip notifications (requires join during generation).
- **Multiple rooms** — Prototype reservation carries the resource FK; no recurring_series changes needed.
