# Staff Reservation Management — Spec

Staff backend for browsing, resolving, and creating reservations. Absorbs the existing `/staff/reservations/resolve` page. Staff can override conflict and business-hours rules with a warning.

Paid reservations auto-complete after their end time. The resolve modal only surfaces unpaid reservations that need staff attention.

---

## Routes

| Route                      | Purpose                                             |
| -------------------------- | --------------------------------------------------- |
| `/staff/reservations`      | Filterable list with resolve modal and create modal |
| `/staff/reservations/[id]` | Detail view with actions                            |

Add "Reservations" to the staff sidebar nav between "Users" and "Closures". Remove the "Resolve" link.

---

## 1. List page — `/staff/reservations`

### Tabs

Two tabs only:

- **Upcoming** (default) — `endsAt > now()`, excludes cancelled, sorted by `startsAt` ascending
- **All** — everything, sorted by `startsAt` descending

Each tab label shows its count as a badge.

### Table columns

| Column  | Source                | Sortable            | Notes                                                                                                  |
| ------- | --------------------- | ------------------- | ------------------------------------------------------------------------------------------------------ |
| Status  | `status`              | no                  | `StatusBadge` component                                                                                |
| Time    | `startsAt` / `endsAt` | yes (by `startsAt`) | Date on first line, time range on second. Format: "Mon, May 12" / "2:00 – 4:00 PM"                     |
| Member  | join on `user`        | yes (by name)       | Name as link to `/staff/users/{id}`, email below in `text-sm opacity-60`                               |
| Payment | computed              | no                  | Amount on first line (e.g. "$30.00"), payment status below as a small badge. See Payment Status below. |
| Booker  | `bookerType`          | no                  | Badge: "user", "band", "event", "lesson"                                                               |

Rows are clickable links to the view page.

### Payment status derivation

Payment status is derived from reservation state + `stripePaymentRecordId`. Note that `confirmed` + paid is transient — the auto-complete cron moves these to `completed` within 15 minutes of their end time.

| Reservation status | Has payment record? | Display                                                          |
| ------------------ | ------------------- | ---------------------------------------------------------------- |
| `scheduled`        | no                  | badge-warning "Unpaid"                                           |
| `confirmed`        | yes                 | badge-success "Paid"                                             |
| `confirmed`        | no                  | badge-info "Comped" (confirmed without payment = staff override) |
| `completed`        | yes                 | badge-success "Paid"                                             |
| `completed`        | no                  | badge-info "Comped"                                              |
| `cancelled`        | yes                 | badge-error "Refunded"                                           |
| `cancelled`        | no                  | badge-ghost "Cancelled"                                          |
| `no_show`          | any                 | badge-error "No-show"                                            |

Amount is computed as `durationHours × HOURLY_RATE_CENTS`, formatted as currency. Shown on first line of the cell.

### Filters

Row of controls above the table:

- **Status** — multi-select checkboxes: scheduled, confirmed, completed, no_show, cancelled
- **Date range** — from/to date pickers
- **Search** — text input searching member name or email

Filters apply as query parameters so they survive page reloads.

### Header actions

- **"Resolve"** button with a badge showing the unresolved count. Opens the resolve modal (see below). Uses `btn-warning` when count > 0, `btn-ghost` when 0.
- **"New Reservation"** button → opens the create modal (see section 3)

### Resolve modal

A daisyUI modal triggered by the "Resolve" header button. Shows only **unpaid** reservations that need staff attention — reservations with status `scheduled` whose `endsAt` is in the past. Paid reservations (status `confirmed`) are auto-completed by the cron job and never appear here.

Each card contains:

```
┌─────────────────────────────────────────────────────┐
│  Jane Smith                        Mon, May 12      │
│  jane@example.com                  2:00 – 4:00 PM   │
│                                    2 hrs · $30.00   │
│                                                     │
│           ┌───────────────┐  ┌──────────┐           │
│           │ Cash Received │  │ No-Show  │           │
│           └───────────────┘  └──────────┘           │
└─────────────────────────────────────────────────────┘
```

Card details:

- **Left side**: member name (bold), email below in muted text
- **Right side**: date, time range, duration + amount
- **Action buttons**: bottom of card, right-aligned
  - **Cash Received** — `btn-success btn-sm btn-outline`. Records cash payment, transitions `scheduled → completed`.
  - **No-Show** — `btn-error btn-sm btn-outline`. Transitions `scheduled → no_show`.

Cards sorted by `endsAt` ascending (oldest unresolved first).

When an action completes, the card animates out and the count badge updates. When all cards are resolved, show "All caught up!" with a checkmark and auto-close after a moment.

Each action uses `AsyncButton` for status feedback.

The modal title shows "Resolve (N)".

### Data loading

Use `+page.server.ts` with a `load` function. Query params drive tab, filters, and sort. Load up to 200 rows per tab. Unresolved reservations for the modal are loaded alongside the main query.

---

## 2. View page — `/staff/reservations/[id]`

### Page header

`PageHeader` with title "Reservation" and `backHref="/staff/reservations"`. Action buttons in the header slot (see Actions section).

Between the back link and the title, show prev/next navigation arrows to step through reservations chronologically. These link to the adjacent reservations by `startsAt` (excluding cancelled), so staff can flip through the day's bookings without returning to the list. Disabled at the ends. Keyboard shortcut: `←` / `→`.

When the next button is disabled (this is the last non-cancelled reservation of the day), replace it with a "Last of the day" label in muted text. Tells staff when to lock up.

### Layout

Single column, max-w-3xl centered, `space-y-6`.

### Hero section

A card at the top with the reservation's key identity:

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  ┌──────────────┐                                       │
│  │  confirmed   │                                       │
│  └──────────────┘                                       │
│                                                         │
│  Monday, May 12, 2025                                   │
│  2:00 PM – 4:00 PM  ·  2 hours                         │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │  ░░░░░░░░░░░░░░░████████░░░░░░░░░░░░░░░░░░░░░░  │   │
│  │  9am          2pm    4pm                  10pm   │   │
│  └──────────────────────────────────────────────────┘   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

- **StatusBadge** prominent at top
- **Date** in full format ("Monday, May 12, 2025")
- **Time range** with duration: "2:00 PM – 4:00 PM · 2 hours"
- **Day timeline bar**: a horizontal bar representing 9 AM – 10 PM, with the reservation's slot filled in. Other reservations for the same day shown in a muted color. Closures shown in red. This gives at-a-glance context for the day's schedule. Simple CSS bar, not a chart library.

### Member section

A card with the booker's info:

```
┌─────────────────────────────────────────────────────────┐
│  Member                                                 │
│                                                         │
│  ┌────┐                                                 │
│  │ JS │  Jane Smith                    View profile →   │
│  └────┘  jane@example.com                               │
│          (503) 555-1234                                  │
│          she/her                                         │
│                                                         │
│  Booked as: user                                        │
└─────────────────────────────────────────────────────────┘
```

- **Avatar placeholder**: circle with initials, `bg-primary text-primary-content`
- **Name**: bold, linked to `/staff/users/{id}`
- **"First reservation"** badge — shown next to the name when the user has zero `completed` reservations (i.e. they've never successfully used the space before). Uses `badge-info badge-sm`. Helps staff know to offer extra guidance or a walkthrough.
- **"View profile →"** link on the right
- **Email**: `mailto:` link
- **Phone**: shown if present, `tel:` link
- **Pronouns**: shown if present, muted text
- **Booker type**: "Booked as: user/band/event/lesson" at the bottom in muted text. If bookerType is "band" and we can resolve the band name, show it. Otherwise just the type.

### Payment section

A card showing payment state:

```
┌─────────────────────────────────────────────────────────┐
│  Payment                                                │
│                                                         │
│  $30.00                           ┌────────┐            │
│  2 hours × $15.00/hr              │  Paid  │            │
│                                   └────────┘            │
│                                                         │
│  Stripe record: pr_abc123...          Copy              │
└─────────────────────────────────────────────────────────┘
```

- **Amount**: large text, computed from duration × hourly rate
- **Breakdown**: "N hours × $15.00/hr" in muted text
- **Payment status badge**: same derivation as the list page table
- **Stripe payment record ID**: shown if present, truncated with a copy button. Links to Stripe dashboard if we have the URL pattern, otherwise just copyable text.

### Notes section

Only rendered if notes are present. Simple card with the notes text.

```
┌─────────────────────────────────────────────────────────┐
│  Notes                                                  │
│                                                         │
│  "Bringing extra amps, may need extension cord"         │
└─────────────────────────────────────────────────────────┘
```

### Cancellation section

Only rendered if status is `cancelled`. Shows the cancellation reason if present.

```
┌─────────────────────────────────────────────────────────┐
│  Cancelled                                              │
│                                                         │
│  "Double-booked, member rescheduled"                    │
└─────────────────────────────────────────────────────────┘
```

Uses `border-error` or a subtle red tint to visually distinguish.

### Actions

Shown in the `PageHeader` slot, right-aligned. Available actions depend on current status:

| Current status | Available actions                       |
| -------------- | --------------------------------------- |
| `scheduled`    | Confirm, Cash Received, Cancel, No-Show |
| `confirmed`    | Complete, Cancel, No-Show               |
| `completed`    | —                                       |
| `no_show`      | —                                       |
| `cancelled`    | —                                       |

Button styles:

- **Confirm**: `btn-success` — transitions `scheduled → confirmed`
- **Complete**: `btn-success` — transitions `confirmed → completed`
- **Cash Received**: `btn-success btn-outline` — records cash payment, transitions `scheduled → completed`
- **Cancel**: `btn-error btn-outline` — opens a small inline form (text input for optional reason + confirm button). Skips ownership check (staff override). Triggers refund if payment exists.
- **No-Show**: `btn-warning btn-outline` — transitions `scheduled|confirmed → no_show`

All actions use `AsyncButton` for status feedback. On success, the page reloads to reflect the new state. Show a success toast for each action.

### Data loading

`+page.server.ts` loads the reservation by ID joined with user info. Also loads:

- **Same-day reservations** (for the timeline bar and "last of the day" check) — all non-cancelled reservations on the same calendar day
- **Prev/next IDs** — the immediately preceding and following reservation IDs by `startsAt` (excluding cancelled), for the navigation arrows
- **User's completed count** — `COUNT(*)` of reservations with `status = 'completed'` for this user, to determine the "first reservation" badge (show when count is 0)

Returns 404 if the reservation is not found.

---

## 3. Create modal

A daisyUI modal triggered by the "New Reservation" button in the list page header. No separate route.

### Form fields

All fields in a single scrollable modal body:

- **Member** — searchable select. Server query function searches users by name or email, returns top 20 matches. Each option shows name + email.
- **Date** — date picker. No minimum date constraint (staff can book today or past dates). Defaults to today.
- **Start time** — select from all time slots for the chosen date. Unavailable slots shown with strikethrough text and a muted style but remain selectable. Fetched reactively when date changes.
- **End time** — select from valid end times given the chosen start. Same treatment: unavailable times marked but selectable.
- **Notes** — optional textarea.

### Override warnings

When the selected time would normally be rejected, show stacked `alert alert-warning` banners below the time selects:

- "Conflicts with existing reservation: Jane Smith, 2:00 – 4:00 PM"
- "Overlaps with closure: Building maintenance, May 12"
- "Outside operating hours (9:00 AM – 10:00 PM)"
- "Duration is less than 1-hour minimum" / "Duration exceeds 8-hour maximum"

Submit button stays enabled regardless.

### Modal footer

Cancel button (closes modal) and "Create Reservation" submit button (`btn-success`).

### Submission

- Default status: `confirmed`
- Calls `staffCreate()` (skips conflict and validation checks)
- On success, close the modal, show `successToast: "Reservation created"`, and navigate to the new reservation's view page (`/staff/reservations/{id}`)

### Data loading

The member search and slot queries use `query()` functions from a colocated `data.remote.ts` on the list page. Slot fetching is triggered reactively when the date field changes.

---

## 4. Auto-complete paid reservations

Paid reservations (`status = 'confirmed'`, `stripePaymentRecordId IS NOT NULL`) whose `endsAt` is in the past should automatically transition to `completed`. This eliminates them from the resolve workflow entirely — resolve only handles unpaid (`scheduled`) reservations.

### Implementation

Add an `autoCompleteExpired()` function to `reservation-service.ts`:

```typescript
export async function autoCompleteExpired(): Promise<number> {
	const now = new Date();
	const result = await db
		.update(reservation)
		.set({ status: 'completed', updatedAt: now })
		.where(
			and(
				eq(reservation.status, 'confirmed'),
				isNotNull(reservation.stripePaymentRecordId),
				lt(reservation.endsAt, now)
			)
		);
	return result.rowCount ?? 0;
}
```

### Cron endpoint

Add `POST /api/cron/auto-complete` following the same pattern as `/api/cron/lock-access` — protected by `CRON_SECRET`, calls `autoCompleteExpired()`, returns the count. Run every 15 minutes from an external scheduler.

### Opportunistic completion on page load

Also call `autoCompleteExpired()` at the top of the staff reservations list page `load` function. This ensures the list is always fresh even if the cron hasn't run yet. The query is cheap (single UPDATE with an index hit) and idempotent.

---

## 5. Service changes

### reservation-service.ts

**Add `staffCreate()`:**

```typescript
export interface StaffCreateReservationParams extends CreateReservationParams {
	status?: ReservationStatus; // defaults to 'confirmed'
}

export async function staffCreate(params: StaffCreateReservationParams): Promise<ReservationRow> {
	// No validateBooking() call
	// No hasConflict() call
	// Insert directly with the given status
}
```

**Add `confirm()`:**

```typescript
export async function confirm(reservationId: string): Promise<void> {
	await updateStatus(reservationId, ['scheduled'], 'confirmed');
}
```

**Modify `cancel()`** — add `staffOverride` option that skips the `createdByUserId` check:

```typescript
export async function cancel(
	reservationId: string,
	userId: string,
	reason?: string,
	options?: { staffOverride?: boolean }
): Promise<void>;
```

### conflict-service.ts

**Add `getConflictDetails()`** — returns specifics for the warning UI:

```typescript
export interface ConflictDetail {
	type: 'reservation' | 'closure';
	startsAt: Date;
	endsAt: Date;
	label: string; // member name or closure reason
}

export async function getConflictDetails(startsAt: Date, endsAt: Date): Promise<ConflictDetail[]>;
```

**Add `getValidationWarnings()`** — returns human-readable warnings without throwing:

```typescript
export function getValidationWarnings(startsAt: Date, endsAt: Date): string[];
```

`getAvailableSlots()` already returns all slots with `available: boolean`. Staff create page uses the same data but renders unavailable slots as selectable.

---

## 6. Navigation changes

In the staff layout, replace the "Resolve" nav item with "Reservations" using the same icon slot. Delete the resolve route files after the new page absorbs the functionality.

---

## 7. Out of scope

- Editing/rescheduling existing reservations
- Recurring reservation management
- Multi-space/room support
- Server-side pagination
- Activity/audit log on view page
- Lock code display
