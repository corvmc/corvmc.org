# Staff Events: Productions vs Listings

`/staff/events` serves two jobs that share nothing but a database table. This spec splits the index
into two routes and source-gates the detail page, so each surface is shaped for one job.

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
this show, who is behind it, is anything wrong — and the work is finished when the queue is empty.

**Running a production** is the opposite shape. Staff book a show and then run it: create the event,
hold the practice space, set a price, decide whether we sell the tickets or the venue does, get the
poster up, staff the volunteer shifts, and on the night work the door with check-in. Nobody pings
you, one show is touched repeatedly over weeks, and the characteristic failure is something quietly
_missing_ — no room held, no poster, no volunteers — until it is too late to fix.

One page cannot be shaped for both, and today's does not try: it toggles between them with a
`TabBar` plus a source `Select`. Two costs follow.

- **The detail page carries every card for every source.** A community listing at another venue
  renders a "Space Reservation: no space held" card and a "Volunteer Shifts: + schedule one" form
  for a show CMC neither produces nor staffs. Both are rendered unconditionally, on purpose — the
  comment above the reservation card records that hiding it when nothing is held is how a calendar
  of events once reached production with no rooms booked.
- **The review queue never says who posted the thing**, which is the first fact a moderator needs.
  `getStaffEvents` joins the managing band for a byline but nothing joins the submitter.

---

## Scope

**In:** two index routes; the nav entries and badge; source-gating the detail page's production
cards; a "Posted by" column and card; the submitter join; a redirect for the old review URL; the
notification `href`.

**Out:**

- **Schema.** Nothing is added, dropped, or renamed.
- **Group events.** Groups phase 9 adds `source: 'group'`; see [What phase 9 changes](#what-groups-phase-9-changes).
- **Band standing.** The moderation card shows a standing warning for community submitters only.
  Whether a _band_ can be flagged the same way is a different axis.
- **Calendar-density conflict checking.** `checkConflicts` guards the room, not the night. See
  [Losing the combined index](#losing-the-combined-index).
- **Retiring `getPendingSubmissions` / `approveListing`.** Both are orphaned by the current UI and
  stay that way here; they are covered by the guard spec, so removing them is its own cleanup.

---

## Decisions

### 1. Split by source, not by status

`/staff/events` becomes **Productions** (`source = 'cmc'`). A new `/staff/listings` becomes
**Listings** (`band` + `community`), with the pending-review queue as its first tab.

The alternative was a status split: leave one all-source catalog and give `pending_review` its own
inbox. `listPendingSubmissions` is deliberately keyed on status and not source, and its comment
notes that a future booking-request pipeline could share the queue — so that reading has support.

Source wins because it separates the two _jobs_, where status separates one job's states. A
published community listing that gets reported is moderation work with no `pending_review` row
anywhere; a CMC draft is production work. A status split leaves both on the catalog page and hands
the moderator a queue that only holds half of what they do. It also leaves the catalog mixing forty
CMC shows with the listings, which is the thing being fixed.

The source axis also matches lines the code already draws: `cmcCanSell`, the `event_cmc_needs_end`
check constraint, and the community-draft exclusion in `listAll`.

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

### 3. Both indexes scope by an explicit allow-list

Productions is `sources: ['cmc']`, not "everything that is not a listing."

`eventSources` is going to grow. With allow-lists, a new source lands on **neither** page until
someone chooses — a group event going missing is a visible bug, whereas one quietly appearing in the
moderation queue is a wrong answer nobody notices. Adding a source to a page is then one array
element.

### 4. "Posted by" replaces both "Submitted by" and the Source column

The accountable party differs by source: a band gig's is the **band**, a community listing's is the
**member**. Today that is inverted — community listings get a dedicated "Submitted by" `InfoCard`
while a band's byline is a line buried inside Event Details.

One **"Posted by"** card renders whenever `!isProduction`, above Event Details, and the band line
comes out of Event Details. Band gig → the `BandRef` chip. Community listing → the member link,
email, and standing `Alert`, as today.

On the Listings index the same fact becomes a **Posted by** column, and it **replaces** the Source
column rather than sitting beside it: a band chip already reads as a band gig and a person's name as
a community listing, and the source `Select` covers the rest. This keeps the table inside its column
budget while adding the fact moderators were missing.

### 5. Listings opens on Needs review

Default tab is the queue, matching `/staff/flags` and `/staff/volunteer`. An empty queue reading
"nothing waiting" is a correct answer, and it is one the current page can never give while it also
holds every CMC show. It also means the notification link is `/staff/listings` with no query string.

### 6. Productions keeps the `/staff/events` URL

The label changes to "Productions"; the path does not. `/staff/events/[id]` and
`[id]/check-in` cannot move — `entity-href`, notification deep links, and e2e all point there — so
moving only the index would separate a label from its own children's paths, a worse mismatch than
the one it fixes.

### 7. The pending count keeps its own component

`PendingReviewBadge.svelte` already owns `getPendingSubmissionCount()` in a child component, and
Listings reuses it as-is rather than reading the count in the page. This is not stylistic:
`custom/no-concurrent-remote-queries` is an **error**, and past kit 2.64 a second in-flight query
renders the page as `effect_update_depth_exceeded`. See [Inherited constraints](#inherited-constraints).

---

## Losing the combined index

The current index is the only staff page listing all sources at once. Most of what that is used for
is served better elsewhere.

The cross-source question staff actually ask is day-level — _is anything else on that night?_ — and
that is the **public gig guide** at `(public)/events`, backed by `listPublicUpcomingEvents` and
`listPublicCalendarEvents`, which are all-source by design and whose mini-calendar dots exist to say
something is on that day. Staff read it like anyone else.

What the staff index adds over the guide is the **non-public** rows — `draft`, `pending_review`,
`rejected` — and those divide cleanly: a CMC draft is Productions, a listing awaiting or refused
review is Listings. No question needs unpublished CMC shows and unpublished listings side by side.

The one real gap is scheduling against an _unannounced_ show. That belongs in `checkConflicts`,
which guards the room and not the night; widening it is a feature, not part of this split.

---

## Service and remote delta

**No schema delta.** No migration.

`listAll` (`src/lib/server/event/event-service.ts`) — one caller, so changed in place:

- `opts.source?: EventSource` becomes `opts.sources?: EventSource[]`, filtered with `inArray`.
- Add `leftJoin(user, eq(user.id, event.createdByUserId))` selecting `submitterName`, `submitterId`.
  **Left**, not the inner join `listPendingSubmissions` uses — an event whose creator was deleted
  must not vanish from the staff index.
- The community-draft exclusion and its comment are untouched.

`getStaffEvents` (`src/lib/remote/events.remote.ts`) — `source` becomes
`sources: z.array(z.enum(eventSources)).optional()`; rows gain a `submitter` `MemberRef` via
`toMemberRef`, beside the existing `ref` and `band`.

`rejectListing` (`src/lib/remote/community-events.remote.ts`) refreshes `getPendingSubmissions()`,
which nothing renders. Point it at `getStaffEvents` and `getStaffLayout`.

---

## Route and UI delta

| Path                                                    | Change                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/routes/staff/events/+page.svelte`                  | Becomes Productions. `TabBar` and `view` state deleted; query hardcodes `['cmc']`; the source `Select` becomes a **status** filter; the Source column is dropped and **Space** promoted from `col-extra` to `col-support`. Keeps `New Event`, `CreateEventModal`, the day-group rows, `zebra={false}`, and the `goto(..., { replaceState: true })` mirroring. |
| `src/routes/staff/listings/+page.svelte`                | **New.** Lifts the table markup. `TabBar` Needs review (default, `PendingReviewBadge`) / All listings; source `Select`; columns status glyph · Event · **Posted by** · Tags. No create button — staff do not author listings.                                                                                                                                 |
| `src/routes/staff/events/[id]/+page.svelte`             | `cmcCanSell` → `isProduction`; gate the three production cards; one "Posted by" card for `!isProduction`; band byline out of Event Details; `backHref` becomes source-dependent.                                                                                                                                                                              |
| `src/routes/staff/events/+page.ts`                      | **New.** `redirect(308, '/staff/listings')` when `status=pending_review` or a listing `source` is present. Precedent: `src/routes/staff/volunteer/interest/+page.ts`.                                                                                                                                                                                         |
| `src/routes/staff/nav-items.ts`                         | `programs` section gains a `listings` row; `events` relabelled "Productions". `StaffNavBadgeKey` gains `'listingsPending'`.                                                                                                                                                                                                                                   |
| `src/lib/server/notification/notification-listeners.ts` | The listing-awaiting-review `href` becomes `/staff/listings`.                                                                                                                                                                                                                                                                                                 |

The nav section is already called **Programs** and currently holds only Events, so the second row
lands in a group that already fits it.

`getStaffLayout` already computes and returns `listingsPending` and nothing reads it — the badge
needs no server change, only the `StaffNavBadgeKey` union widened.

---

## Inherited constraints

Four rules this work must not break, each with a failure mode that is quiet rather than loud.

1. **One load-bearing query per page.** `custom/no-concurrent-remote-queries` is an error, and past
   kit 2.64 the banned shape renders as `effect_update_depth_exceeded`. Listings gets exactly one:
   `getStaffEvents`. The count stays in `PendingReviewBadge`.
2. **Leave the detail page's `Promise.all` alone.** Skipping the shift queries for a listing looks
   like a win but needs `source` first, which reintroduces the waterfall its comment documents
   fixing — and which was timing out `staff-event-reserve-space.e2e.ts` on CI. Gate the rendering,
   not the fetch.
3. **`entity-href.ts` is not touched.** Every event ref keeps resolving to `/staff/events/{id}`.
4. **`nav-items.spec.ts` fails any staff page with no nav row or explicit exemption.** Adding
   `/staff/listings` without its nav entry fails the suite, which is the desired gate.

---

## What Groups phase 9 changes

Phase 1 already repointed `event.bandId` at `group.id`, and `listAll` already joins `group`. The
events-facing churn is behind us; phase 9 adds `event_group`, `createGroupEvent()`, the
recurring-generator fix, and renames the `eventSources` value `'band'` to `'group'`.

For this split that is mechanical: `sources: ['band', 'community']` becomes
`['group', 'community']`, the source `Select` option is relabelled, and `event.bandId` is renamed in
one join. Phase 9 is seven phases out and none of the phases before it touch the staff events panel,
so this does not wait on it.

A club's jazz night is **production-shaped** — a staff-sanctioned program that holds the room free —
so phase 9 adds `'group'` to Productions, not Listings. Building the split first gives group events
a defined home rather than leaving phase 9 to invent one.

---

## Dev testing

- `scripts/seed-dev.ts` must leave at least one band listing and one community listing in
  `pending_review`, so `/staff/listings` is not empty locally. The e2e fixtures have
  `SEED_CE_PENDING_ID`; the dev seed needs its own.
- `e2e/community-events.e2e.ts` navigates to `/staff/events?status=pending_review` and must move to
  `/staff/listings`.
- `e2e/staff-event-reserve-space.e2e.ts` seeds CMC events and stays on `/staff/events`; its list
  assertions need checking against the dropped Source column.
- New coverage for the split itself: a pending community listing appears on `/staff/listings` with
  its submitter; `/staff/events` does not list it; the old review URL redirects.
- The three `events-*.remote.spec.ts` files mock `listAll` — run the whole `src/lib/remote`
  directory, since a sibling spec's mock that lacks the new parameter fails only when its own file
  runs.
