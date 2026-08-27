# Staff Events: Productions and Calendar

`/staff/events` serves two jobs that share nothing but a database table. This spec splits the index
into two routes — one shaped for **producing a show**, one shaped for **what the public can see** —
and source-gates the detail page so each surface does one job.

No schema changes. This is a routing and presentation split over data that already exists.

---

## Purpose

**Moderating listings** is reactive. A member — or a band, through its own panel — posts a show to
the community calendar. These are people in the collective (`createListing` is guarded on
`requireUser`), so this is never an anonymous submission queue. Almost all posts go straight to the
public guide untouched; that is the design. But when a report has been upheld against a member,
`publishCommunityEvent` holds their posts at `pending_review` instead and staff get a notification.
Separately, something already public gets reported and needs pulling down.

So a staffer arrives **because they were pinged**. The questions come in a fixed order — what is
this show, who is behind it, is anything wrong, **is it already on the calendar** — and the work is
finished when the queue is empty.

**Running a production** is the opposite shape. Staff book a show and then run it: create the event,
hold the practice space, set a price, decide whether we sell the tickets or the venue does, get the
poster up, staff the volunteer shifts, and on the night work the door with check-in. Nobody pings
you, one show is touched repeatedly over weeks, and the characteristic failure is something quietly
_missing_ — no room held, no poster, no volunteers — until it is too late to fix.

One page cannot be shaped for both, and today's does not try: it toggles between them with a
`TabBar` plus a source `Select`. Three costs follow.

- **The detail page carries every card for every source.** A community listing at another venue
  renders a "Space Reservation: no space held" card and a "Volunteer Shifts: + schedule one" form
  for a show CMC neither produces nor staffs. Both are rendered unconditionally, on purpose — the
  comment above the reservation card records that hiding it when nothing is held is how a calendar
  of events once reached production with no rooms booked.
- **The review queue never says who posted the thing**, which is the first fact a moderator needs.
  `getStaffEvents` joins the managing band for a byline but nothing joins the submitter.
- **Staff cannot see duplicates.** See [The duplicate gap](#the-duplicate-gap) — this is the reason
  the moderation surface is a calendar rather than a source filter.

---

## Scope

**In:** two index routes; the nav entries and badge; source-gating the detail page's production
cards; a "Posted by" column and card; a staff calendar read; a redirect for the old review URL; the
notification `href`.

**Out:**

- **Schema.** Nothing is added, dropped, or renamed.
- **An explicit staff duplicate warning.** The Calendar makes a duplicate _visible_; a
  `checkForDuplicate` call surfaced on the review screen would make it _loud_. Cheap follow-up, not
  this change — see [The duplicate gap](#the-duplicate-gap).
- **Where club sessions are administered.** Groups adds a fourth source, `'group'`. It reaches the
  Calendar for free; its work-side home is open — see [The third category](#the-third-category).
- **Band standing.** The moderation card shows a standing warning for community submitters only.
  Whether a _band_ can be flagged the same way is a different axis.
- **Retiring `getPendingSubmissions` / `approveListing`.** Both are orphaned by the current UI and
  stay that way here; they are covered by the guard spec, so removing them is its own cleanup.

---

## Decisions

### 1. The axis is work versus publicity, not source versus status

|       | Productions                                   | Calendar                                             |
| ----- | --------------------------------------------- | ---------------------------------------------------- |
| URL   | `/staff/events` (unchanged)                   | `/staff/calendar` (new)                              |
| Scope | `source = 'cmc'`, **every** status            | **every** source, public statuses + `pending_review` |
| Order | newest first, as today                        | forward from today, like the gig guide               |
| Shape | work-shaped: drafts, room holds, ticket sales | publicity-shaped: what the world can see             |

An earlier draft of this spec split purely by source — Productions for `cmc`, Listings for
`band` + `community`. That is clean and it is wrong, because it answers a question moderators do not
ask. Moderation is not "show me the events we didn't produce." It is **"what is publicly visible,
and should it be?"** — and the answer to that includes CMC's own shows, which is why the source
filter could not detect a duplicate (below).

A pure status split was also considered and rejected: `listPendingSubmissions` is deliberately keyed
on status and not source, and its comment anticipates a booking-request pipeline sharing the queue.
But a queue that empties is only half of moderation. A published listing that gets reported has no
`pending_review` row anywhere, and a status split leaves it on the catalog page with the production
work.

**A CMC show therefore appears on both pages, in two different roles**, and that is the design
rather than a leak. Productions is where you _build_ a show — it holds drafts, the room, the ticket
ledger, the check-in door. The Calendar is where you see _what the public sees_, and a CMC show is
on the public calendar exactly like everything else. Neither page is a superset of the other:
Productions holds drafts the Calendar must never show, and the Calendar holds three sources
Productions does not.

### 2. One detail route, with production cards gated on source

`/staff/events/[id]` stays the only event detail page. Production cards render only when
`source === 'cmc'`.

Two detail routes would be conceptually cleaner and were rejected on cost.
`src/lib/utils/entity-href.ts:79` resolves **every** event ref to `/staff/events/{id}`, and
`EventRef` carries `bandId`/`bandSlug` but no `source`. Splitting the route means either adding
`source` to every producer of an event ref, or making `/staff/events/[id]` a source-sniffing
redirect hop. Gating the cards removes the dead UI for a fraction of that, and the benefit was
always asymmetric anyway: the listing side loses two meaningless cards, while the CMC side loses
only branches.

Gated on `source === 'cmc'`: the Space Reservation card, the Volunteer Shifts card, and the poster
**upload** input. The poster image itself still displays for every source — a listing's art is the
member's, and the moderation remedy for bad art is Turn down or Unpublish, both already present.

Two things this deliberately gets wrong, both recorded so they are not rediscovered as bugs:

- **A CMC production at an outside venue still shows "Space Reservation: no space held."** Nothing
  on the record distinguishes an offsite show — `location` is free text. The alternative failure,
  an unheld room going unnoticed, is the one that already happened.
- **The Space Reservation card stays unconditional _within_ productions.** Gate it on source, never
  on whether a reservation exists.

`cmcCanSell` is renamed to `isProduction` and becomes the single gate. Both read
`source === 'cmc'`. Keeping two names was considered — "may we take the money" and "is this ours to
run" are different questions — and rejected as a distinction without a difference today; the
comment at the ticketing call site keeps the rule's reasoning where the rule is applied.

The rename is behaviour-preserving for offsite productions, which is the case worth stating in that
comment: `cmcCanSell` gates whether the ticketing toggle is **offered**, never its value. A CMC show
at the Whiteside is `source='cmc'`, so the toggle is offered, staff leave it off, and
`externalTicketUrl` + `ticketPrice` carry the venue's own ticketing.

### 3. Productions names the sources it wants; the Calendar does not scope by source at all

Productions passes `source: 'cmc'` — an allow-list of one, never "everything that is not a
listing." An exclusion filter silently adopts every source added later; naming the source means a
new one goes visibly missing instead, which is the failure you want.

The Calendar has no source filter in its query at all. It is scoped by **status**, and every source
that can reach the public calendar reaches it. That is what makes it immune to
[the third category](#the-third-category): a fourth source needs no decision here.

A source `Select` still appears in the Calendar's `FilterBar`, but as a user affordance for
narrowing a view, not as the page's definition.

### 4. "Posted by" replaces both "Submitted by" and the Source column

The accountable party differs by source: a band gig's is the **band**, a community listing's is the
**member**, a CMC show's is the collective. Today that is inverted — community listings get a
dedicated "Submitted by" `InfoCard` while a band's byline is a line buried inside Event Details, and
CMC rows carry a Source column that only ever says "CMC".

One **"Posted by"** card renders whenever `!isProduction`, above Event Details, and the band line
comes out of Event Details. Band gig → the `BandRef` chip. Community listing → the member link,
email, and standing `Alert`, as today.

On the Calendar the same fact becomes a **Posted by** column, and it **replaces** the Source column
rather than sitting beside it: a band chip reads as a band gig, a person's name as a community
listing, and a plain "CMC" as ours. One column, one fact, three answers.

### 5. The Calendar opens on Needs review, and is filter-driven

No `TabBar`. A status `Select` in the `FilterBar` defaults to **Needs review**, exactly as
`/staff/flags` defaults to `pending` and counts "not pending" as an active filter. The queue is not
a separate view of the calendar — it is the calendar filtered to the rows asking for a decision, and
a pending listing already has a date to sit on.

Defaulting to the queue keeps the notification link honest: it becomes `/staff/calendar` with no
query string. An empty queue reading "nothing waiting" is a correct answer, and it is one the
current page can never give while it also holds every CMC show.

`rejected` is reachable from the same filter but is never in the default view — it was never public
and is terminal.

### 6. Productions keeps the `/staff/events` URL

The label changes to "Productions"; the path does not. `/staff/events/[id]` and `[id]/check-in`
cannot move — `entity-href`, notification deep links, and e2e all point there — so moving only the
index would separate a label from its own children's paths, a worse mismatch than the one it fixes.

### 7. The pending count keeps its own component

`PendingReviewBadge.svelte` already owns `getPendingSubmissionCount()` in a child component, and the
Calendar reuses it as-is rather than reading the count in the page. This is not stylistic:
`custom/no-concurrent-remote-queries` is an **error**, and past kit 2.64 a second in-flight query
renders the page as `effect_update_depth_exceeded`. See [Inherited constraints](#inherited-constraints).

---

## The duplicate gap

This is the finding that set the axis, so it is worth stating plainly.

`checkForDuplicate` exists, and its own comment says two people posting the same gig is _"the
characteristic failure of a community calendar"_ and that a determined duplicate _"isn't stopped by
anything short of moderation."_ Moderation is named as the backstop.

**Staff have no duplicate detection.** `findDuplicateListing` returns `null` unless the caller is
the listing's own author (`evt.createdByUserId !== user.id`), so it is a member-only affordance on
the manage page. The moderation UI offers nothing.

A moderator can only catch a duplicate by seeing what else is already on that date — and the
duplicate is frequently **one of our own shows**, re-posted by a member who did not know we had it
listed. A source-scoped moderation page structurally cannot show that. A calendar-scoped one shows
it by construction: the row being judged sits in the day group it belongs to, with everything else
on that date around it.

Making it _loud_ — surfacing `checkForDuplicate` on the review screen with a staff-reachable guard —
is a small follow-up this makes obvious, and is out of scope here.

---

## The third category

Groups adds **a fourth event source, not a rename**: `eventSources` becomes
`['cmc', 'band', 'community', 'group']` for club and committee sessions. `'band'` stays as it is,
and community listings are untouched — they arrived after that spec was drafted and keep their own
draft/review path. (The `'band'` → `'group'` rename in the Groups spec is `reservation.bookerType`,
a different enum on a different table. An earlier draft of this spec conflated the two.)

Sorting the four sources by what staff do with them:

| Source      | Staff's job                                      | Productions | Calendar |
| ----------- | ------------------------------------------------ | ----------- | -------- |
| `cmc`       | Produce it — room, tickets, poster, shifts, door | ✅          | ✅       |
| `group`     | Oversee it — the club runs its own sessions      | **open**    | ✅       |
| `band`      | Moderate it — off-site, someone else's show      | —           | ✅       |
| `community` | Moderate it — off-site, someone else's show      | —           | ✅       |

**The Calendar column needs no decision.** A published group event reaches the public events page
for free — `listPublicUpcomingEvents` applies no source filter — so a club session appears in the
staff Calendar the moment it publishes, like every other public event.

**The Productions column is genuinely open.** An earlier draft folded `'group'` into Productions;
that was wrong. A club's jazz night is collective programming, but it is not a CMC production: no
tickets through our checkout, no bill, no settlement, no poster campaign, and the person running it
is the club's leader rather than staff. It holds the room free precisely because it is not a
commercial show. Whether club sessions are administered on the club's own record once
`/staff/groups` exists in phase 5 — the unit staff care about being the club and its series, not any
one Tuesday — or earn a work surface of their own, is left for the Groups panel design to settle.
Decision 3 keeps `'group'` out of Productions until someone decides, rather than letting it default
in.

Phase 9 is otherwise irrelevant to this work. Phase 1 already repointed `event.bandId` at `group.id`
and `listAll` already joins `group`, so the events-facing churn is behind us, and none of the phases
before 9 touch the staff events panel.

---

## Service and remote delta

**No schema delta. No migration.** And, because the Calendar needs its own read anyway,
**`listAll` and `getStaffEvents` are unchanged** — Productions calls the existing query with
`source: 'cmc'`.

One new service function, `listStaffCalendar`, in `src/lib/server/event/event-service.ts`, modelled
on `listPublicUpcomingEvents` rather than on `listAll`:

- `gte(event.startsAt, from)`, `orderBy(asc(event.startsAt))` — forward from today, not the admin
  index's `desc`.
- `inArray(event.status, statuses)`, optional `inArray(event.source, sources)` for the UI filter.
- `leftJoin(group, …)` for the band byline, plus `leftJoin(user, eq(user.id, event.createdByUserId))`
  for `submitterName` / `submitterId`. **Left**, not the inner join `listPendingSubmissions` uses —
  an event whose creator was deleted must not vanish from a staff index.
- **Keep the community-draft exclusion** — `not(and(eq(source,'community'), eq(status,'draft')))` —
  even though `draft` is not an allowed status. The status list is caller-supplied, and a private
  working copy leaking into a staff view should be prevented by the service, not by a Zod enum
  someone widens later.

One new remote query, `getStaffCalendar`, in `src/lib/remote/events.remote.ts`: `requireStaff()`,
a Zod schema restricting `statuses` to the reviewable-or-public set, and rows carrying `ref`,
`band`, and a `submitter` `MemberRef` via `toMemberRef`.

`rejectListing` (`src/lib/remote/community-events.remote.ts`) refreshes `getPendingSubmissions()`,
which nothing renders. Point it at `getStaffCalendar` and `getStaffLayout`.

---

## Route and UI delta

| Path                                                    | Change                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/routes/staff/events/+page.svelte`                  | Becomes Productions. `TabBar` and `view` state deleted; query passes `source: 'cmc'`; the source `Select` becomes a **status** filter; the Source column is dropped and **Space** promoted from `col-extra` to `col-support`. Keeps `New Event`, `CreateEventModal`, the day-group rows, `zebra={false}`, and the `goto(..., { replaceState: true })` mirroring. |
| `src/routes/staff/calendar/+page.svelte`                | **New.** `getStaffCalendar`, day-grouped forward from today. `FilterBar` with a status `Select` defaulting to Needs review (`PendingReviewBadge` beside the heading) and a source `Select`. Columns: status glyph · Event · **Posted by** · Tags. No create button — staff do not author listings here.                                                          |
| `src/routes/staff/events/[id]/+page.svelte`             | `cmcCanSell` → `isProduction`; gate the three production cards; one "Posted by" card for `!isProduction`; band byline out of Event Details; `backHref` becomes `isProduction ? '/staff/events' : '/staff/calendar'`.                                                                                                                                             |
| `src/routes/staff/events/+page.ts`                      | **New.** `redirect(308, '/staff/calendar')` when `status=pending_review` or a non-CMC `source` is present. Precedent: `src/routes/staff/volunteer/interest/+page.ts`.                                                                                                                                                                                            |
| `src/routes/staff/nav-items.ts`                         | `programs` section gains a `calendar` row; `events` relabelled "Productions". `StaffNavBadgeKey` gains `'listingsPending'`.                                                                                                                                                                                                                                      |
| `src/lib/server/notification/notification-listeners.ts` | The listing-awaiting-review `href` becomes `/staff/calendar`.                                                                                                                                                                                                                                                                                                    |

The nav section is already called **Programs** and currently holds only Events, so the second row
lands in a group that already fits it.

`getStaffLayout` already computes and returns `listingsPending` and nothing reads it — the badge
needs no server change, only the `StaffNavBadgeKey` union widened.

---

## Inherited constraints

Four rules this work must not break, each with a failure mode that is quiet rather than loud.

1. **One load-bearing query per page.** `custom/no-concurrent-remote-queries` is an error, and past
   kit 2.64 the banned shape renders as `effect_update_depth_exceeded`. The Calendar gets exactly
   one: `getStaffCalendar`. The count stays in `PendingReviewBadge`.
2. **Leave the detail page's `Promise.all` alone.** Skipping the shift queries for a listing looks
   like a win but needs `source` first, which reintroduces the waterfall its comment documents
   fixing — and which was timing out `staff-event-reserve-space.e2e.ts` on CI. Gate the rendering,
   not the fetch.
3. **`entity-href.ts` is not touched.** Every event ref keeps resolving to `/staff/events/{id}`.
4. **`nav-items.spec.ts` fails any staff page with no nav row or explicit exemption.** Adding
   `/staff/calendar` without its nav entry fails the suite, which is the desired gate.

---

## Dev testing

- `scripts/seed-dev.ts` must leave at least one band listing and one community listing in
  `pending_review`, and published events of every source on nearby dates so the Calendar has a
  realistic day grouping. The e2e fixtures have `SEED_CE_PENDING_ID`; the dev seed needs its own.
- `e2e/community-events.e2e.ts` navigates to `/staff/events?status=pending_review` and must move to
  `/staff/calendar`.
- `e2e/staff-event-reserve-space.e2e.ts` seeds CMC events and stays on `/staff/events`; its list
  assertions need checking against the dropped Source column.
- New coverage for the split itself: a pending community listing appears on `/staff/calendar` with
  its submitter; a published CMC show appears there too, and on `/staff/events`; a CMC **draft**
  appears on `/staff/events` and **not** on `/staff/calendar`; the old review URL redirects.
- A service-level test that `listStaffCalendar` never returns a community draft, even when `draft`
  is passed in `statuses` — the exclusion is the guard, not the schema.
