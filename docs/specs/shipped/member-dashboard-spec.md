# Member Dashboard

The member dashboard is the landing page at `/member`. It gives members an at-a-glance view of what's happening now and soon: this week's practice sessions, upcoming events, their credit balance, and quick links to common actions. No new tables or services — it aggregates data that already exists.

---

## Sections

### 1. Quick links

A row of action cards linking to the most common member tasks:

- **Book a Session** → `/member/reservations/new`
- **Browse Events** → `/events`
- **Manage Membership** → `/member/membership`

Each card has an icon, a label, and is an anchor element. This section sits at the top of the page as a horizontal row (3 cards across on desktop, stacked on mobile).

### 2. This week's reservations

Shows the member's non-cancelled reservations for the current week (Monday 00:00 through Sunday 23:59, America/Los_Angeles). Each item shows the day of week, date, time range, duration, and status badge. Items link to the member reservations page.

If no reservations exist for the week, show an empty state: "No sessions booked this week" with a link to book one.

Data source: query the `reservation` table for `createdByUserId = user.id`, `startsAt` within the current week bounds, `status != 'cancelled'`, ordered by `startsAt`.

### 3. Upcoming events

Shows the next 4 upcoming public events as compact cards. Each card shows the event title, date, time, and poster thumbnail (if available). Cards link to the public events page (no individual event detail page exists in the member panel).

If no upcoming events, show an empty state: "No events on the horizon."

Data source: reuse `listUpcoming()` from the event service, limited to 4 results. The event service already handles filtering to published future events.

### 4. Credit balance widget

**For sustaining members** (have an active subscription): show free hours remaining this month, hours used, and total allocated. Display as a compact card with a radial or bar indicator showing usage.

**For non-sustaining members** (no subscription): show a brief prompt — "Become a sustaining member to get free practice hours" — with a link to `/member/membership`.

Data source: `getAllBalances(userId)` for credit balance, subscription object for allocation amount (subscription quantity = monthly free hours).

---

## Data loading

The `+page.server.ts` load function fetches all four sections in parallel:

```typescript
const [weekReservations, upcomingEvents, credits, subscription] = await Promise.all([
  // reservations for current week
  db.select()...where(userId, weekStart, weekEnd, not cancelled),
  // next 4 events
  listUpcoming(4),
  // credit balance
  getAllBalances(user.id),
  // subscription status
  user.stripeId ? getSubscription(user.stripeId) : null
]);
```

The week boundaries are computed in `America/Los_Angeles` using the shared timezone utility.

---

## Layout

```
┌─────────────────────────────────────────────────┐
│  Quick Links                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
│  │ Book a   │  │ Browse   │  │ Manage       │  │
│  │ Session  │  │ Events   │  │ Membership   │  │
│  └──────────┘  └──────────┘  └──────────────┘  │
├─────────────────────────┬───────────────────────┤
│  This Week              │  Credits              │
│  ┌─────────────────┐   │  ┌─────────────────┐  │
│  │ Mon 5/12 2-4pm  │   │  │ 3 of 5 hrs left │  │
│  │ Wed 5/14 6-8pm  │   │  │ ████░░ 60%      │  │
│  └─────────────────┘   │  │                 │  │
│                         │  │ or: "Become a   │  │
│                         │  │  sustaining..." │  │
│                         │  └─────────────────┘  │
├─────────────────────────┴───────────────────────┤
│  Upcoming Events                                 │
│  ┌─────┐  ┌─────┐  ┌─────┐  ┌─────┐           │
│  │evt 1│  │evt 2│  │evt 3│  │evt 4│           │
│  └─────┘  └─────┘  └─────┘  └─────┘           │
└─────────────────────────────────────────────────┘
```

Desktop: quick links span full width. Reservations and credits sit side-by-side (2-column grid, reservations taking more space). Events span full width as a row of cards.

Mobile: everything stacks vertically — quick links, reservations, credits, events.

---

## Components

All sections use existing shared components where possible:

- **InfoCard** — wraps each section
- **StatusBadge** — reservation status indicators
- **EmptyState** — when no reservations or events exist
- **BookerTypeIcon** — reservation type icon in the week list

New components to create:

- **QuickLinkCard** — small card with icon + label, just an anchor styled as a card. Simple enough it might not need its own file — could just be inline markup in the dashboard page.

---

## Nav update

Add "Dashboard" as the first nav item in the member layout, pointing to `/member`. Use `IconHome` (or `IconLayoutDashboard`) from tabler icons.

---

## What changes

| Area                                    | Change                                    |
| --------------------------------------- | ----------------------------------------- |
| `src/routes/member/+page.svelte`        | New file — dashboard page                 |
| `src/routes/member/+page.server.ts`     | New file — data loading                   |
| `src/routes/member/+layout.svelte`      | Add Dashboard nav item                    |
| `src/lib/server/event/event-service.ts` | Add `limit` parameter to `listUpcoming()` |

## What doesn't change

| Area                 | Notes                                                       |
| -------------------- | ----------------------------------------------------------- |
| Reservation service  | Reads only, no new operations                               |
| Credit service       | Uses existing `getAllBalances()`                            |
| Subscription service | Uses existing `getSubscription()`                           |
| Event service        | Uses existing `listUpcoming()`, possibly with a limit param |
| Database schema      | No new tables or columns                                    |

## Deferred

- **Personalized event recommendations** — filter events by member's interests/tags. Needs a user preferences system.
- **Recent activity feed** — show completed reservations, payment history. Adds complexity without clear value for an MVP dashboard.
- **Band reservations** — once the band module exists, show band sessions on the dashboard too.
- **Equipment loans** — once equipment is built, show active loans with return dates.

## Open questions

None.
