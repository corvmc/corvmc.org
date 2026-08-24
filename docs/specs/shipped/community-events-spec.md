# Community Events — Phase 2: Member-Sourced Listings

## Purpose

Phase 2 of the community calendar (IDEAS.md "Community Calendar", building on
`docs/specs/shipped/community-calendar-spec.md`). A signed-in member can put an off-site
show on the public gig guide — a gig at another venue, a house show, a festival
— as a third source layer alongside CMC events and member bands' gigs.

The gap this closes: a member who isn't a band admin had no way to put anything
on the calendar at all, so the "what's happening in the Corvallis scene" page
only knew what CMC and its member bands were doing.

Phase 1 pre-declared the extension point, and it held — `source='community'`
slots into the existing public queries with no structural change to them.

## Scope

**In:**

- `source='community'` listings, authored end to end by a member: draft, edit,
  publish, unpublish, cancel, delete.
- `/member/events/submit` (create) and `/member/events/[id]/manage` (edit +
  status-driven actions), mirroring the band panel's create modal on
  `/band/[slug]/events` and its detail page `/band/[slug]/events/[eventId]`,
  which is itself the edit form.
- Optional lineup credits through the existing `event_band` table, so a credit
  naming a platform band lands `pending` and never reaches that band's profile
  until they confirm (`docs/specs/shipped/event-lineup-spec.md`, unchanged).
- Per-member publishing standing (`member_standing` at scope `community_event`;
  originally `community_event_standing`) and a staff review
  queue at `/staff/events` → "Needs review".
- **Event tips**: an "Event Tip" topic on the public `/contact` form revealing
  four optional fields, formatted into the message body. No account needed. Lands
  as an ordinary `web` thread in `/staff/inbox`.
- **Cancelled events stay on the public guide** (all sources, not just
  community) — see Decisions.

**Out (deferred):**

- Partner feed imports; subscribable `.ics` / RSS syndication.
- Community listings at the CMC space (that entangles the reservation system).
- A public, account-free submission form. The contact-form tip is the front door
  for now.
- Reporter-facing status updates, automated takedowns, per-listing opt-out.

## Decisions

- **Trust by default, verify after a first offense.** Publishing is direct — no
  staff in the loop — matching band events. `docs/specs/shipped/event-moderation-spec.md`
  rejected a blanket pre-approval queue and that still holds. What is added is
  narrower: when staff _resolve_ (uphold) a report against a member's community
  listing, that member's future listings queue for review instead. A _dismissed_
  report changes nothing.

  The dismiss/resolve split is load-bearing. Event reports are public and
  anonymous (Turnstile-gated, null reporter allowed), so if a bare accusation
  cost a member their standing, any visitor would have a griefing tool. Wired in
  exactly one place: `resolveFlag` in `src/lib/server/flag/flag-service.ts`.

  Staff restore trust from `/staff/users/[id]`. Restoring flips
  `requiresReview` to false rather than deleting the row, so "looked at and
  forgiven" stays distinguishable from "never happened".

- **Members own a real `draft` state.** A listing is created as a draft whatever
  the author's standing; publishing is a separate, deliberate step. Standing only
  decides where publishing _lands_.

- **Two new event statuses: `pending_review` and `rejected`.**

  ```
  draft ──member publishes──▶ published            (trusted)
        └─member publishes──▶ pending_review ──staff approve──▶ published
                                             └─staff reject───▶ rejected
  rejected  ──member edits + republishes──▶ pending_review
  published ──member edits──▶ pending_review       (review-required only)
  published ──member withdraws──▶ cancelled
  published ──staff unpublish via a flag──▶ draft
  ```

  `draft` and `pending_review` are distinct because they have **different
  owners**: a draft waits on its author, a `pending_review` row waits on staff.
  The queue keys on `pending_review` alone, so a member's half-written listing
  never reaches a staffer. `listAll` (the staff events list) also holds back
  `source='community' AND status='draft'` for the same reason.

  Reusing `cancelled` for the rejected state was considered and dropped.
  `cancelled` means _the show was called off_ — a public fact about the world —
  not _we declined to list this_. It is terminal, which would kill the
  correct-and-resubmit loop that `rejectHourLog` exists to support. And
  `cancel()` does real work on the way through (cancels the reservation, deletes
  the poster, voids tickets, emits `event.cancelled`), all of it meaningless for
  a submission staff simply didn't want.

  Rejection notes are **required** and stored on `event.reviewNotes`, not only
  emailed: a member who can't see what was wrong can't fix it.

- **A cancelled event stays on the public guide, marked, until its date passes.**
  Cancelling is an announcement, and it used to be a silent deletion — the guide
  filtered on `status='published'`, so a cancelled show dropped off `/events` and
  its detail page started 404ing. Anyone who had it in their calendar, or who
  followed a shared link, got nothing.

  This applies to **all three sources**, not just community. A rule where a
  cancelled community gig announces itself but a cancelled CMC show disappears
  would be incoherent, and CMC is the case that matters most — those are the
  shows with ticket holders.

  The window falls out for free: the guide already selects `startsAt >= from`, so
  a cancelled event ages off on its own date. Cancelled events are excluded from
  the next-3 hero posters (`listUpcoming`, unchanged) and from the mini-calendar
  dots — a dot means "something is on that night".

  This makes the `rejected`/`cancelled` split load-bearing rather than tidy:
  `cancelled` is now a _public_ state, so a rejected submission absolutely cannot
  share it.

- **CMC never sells a community listing's tickets**, for the same reason it never
  sells a band's gig — the money would land in CMC's Stripe account with no payout
  path back to whoever is putting the show on. The Phase 1 rule, written as
  `source === 'band'` in four places, is now `source !== 'cmc'`. Enforced in three
  layers, as before: `createCommunityEvent`/`updateCommunityEvent` have no
  `ticketingEnabled` param; `update()` refuses to turn it on for any non-CMC row;
  the three ticket endpoints reject on source. A display `ticketPrice` and an
  `externalTicketUrl` are both fine.

- **RSVPs stay open**, exactly as for band gigs. `rsvpToEvent` takes no money and
  issues no code, so there is nothing to protect against. The headcount may reach
  nobody when the submitter isn't the organizer; that's an accepted cost for
  members getting the same "I'm going" marker everywhere on the guide.

- **No feature flag.** Phase 1's argument applies unchanged: a flag that ends up
  permanently on is worse than none, and the soft/hard check split it forces was
  a standing source of confusion. It would also be a poor kill switch — flipping
  it off would hide the submit form while leaving every published listing on the
  guide.

  Abuse is handled by four real controls instead: submitters must be signed in
  (no Turnstile, no anonymous writes); a velocity throttle on the publish path
  only (`allowRateLimited`, 20/hour per member — loose enough that a real person
  never sees it); the existing `contentFlag` report → triage → unpublish path;
  and per-member probation.

  Deliberately **not** a total cap on listings per member. An earlier draft had
  one, copied from `MAX_OPEN_PORTAL_THREADS`. That cap protects a scarce resource
  — every open portal thread demands a staffer's attention — and a published
  listing demands none. The only person a total cap reliably stops is the best
  user we have: the promoter who legitimately knows about fifteen upcoming shows.

- **Standing is its own table**, not columns on `user`, which already carries
  auth, billing, credits and directory-profile concerns. `volunteer_profile` is
  the precedent for a per-user gating record, and a table gives room for the FK
  to the upheld flag. (That table is now the shared, scoped `member_standing` —
  see `docs/specs/shipped/member-standing-spec.md`. The argument is unchanged; only the
  table's name and key are.)

- **404, not 403, for someone else's listing.** "This exists but isn't yours"
  tells a stranger a listing id is real.

## Schema delta

`src/lib/server/db/schema/event.ts`:

- `eventSources` gains `'community'`; `eventStatuses` gains `'pending_review'`
  and `'rejected'`; new `publicEventStatuses = ['published', 'cancelled']`.
- `event.reviewNotes` — why staff turned a listing down or pulled it. Mirrors
  `volunteer_hour_log.reviewNotes`.
- The `event_cmc_needs_end` CHECK becomes `source != 'cmc' OR ends_at IS NOT
NULL` (was `source = 'band' OR …`). Only CMC events hold the room; a member
  posting someone else's show usually can't say when the night ends. SQLite table
  rebuild.
- New `community_event_standing`: `userId` (PK → user, cascade),
  `requiresReview`, `reason`, `triggeringFlagId` (→ contentFlag, set null),
  `updatedByUserId`, `updatedAt`. **Absence of a row means trusted.**
  **Superseded:** merged into `member_standing`, keyed `(userId, scope)` with
  `requiresReview` becoming `status: 'restricted'`. Read it with
  `getStanding(userId, 'community_event')`; see
  `docs/specs/shipped/member-standing-spec.md`.

`src/lib/server/db/schema/inbox.ts` — `submitContactFormSchema` gains four
optional tip fields plus `EVENT_TIP_SUBJECT`.

`src/lib/server/db/schema/notification.ts` — `community_event_submitted` (staff,
in-app only, same reasoning as `volunteer_hours_submitted`),
`community_event_reviewed`, `community_event_unpublished`.

Migrations are generated by the maintainer with `pnpm db:generate`.

## Two defects fixed along the way

Both were pre-existing, and both got sharper once any member could author a
listing:

1. **The takedown path didn't take the poster down.** Posters are served straight
   from R2 by `getPublicUrl` at a guessable key (`events/posters/{id}.{ext}`),
   and that URL consults nothing — not status, not source. Unpublishing removed a
   listing from the guide while its image stayed world-readable forever.
   Tolerable while only staff and band admins could write to the bucket; not once
   any member can, because that path is the advertised kill switch and an image
   is the riskiest content on the page. `unpublishWithNotice` now deletes the
   object for `source='community'`. CMC and band unpublish are unchanged —
   those are reversible workflows where destroying artwork would be wrong.

2. **Purging a member deleted public calendar entries.** `event.createdByUserId`
   is `onDelete: cascade` and `purgeUser` is a real hard delete; it guarded band
   ownership but not event authorship. `purgeUser` now throws
   `UserHasPublishedListingsError`. The show still happens after someone leaves
   the Collective, and other people's plans are attached to it.

## Deleting an event

Cancelling used to double as "make this go away" — it dropped the row off the
guide. Now that a cancelled show _stays_ on the guide (above), staff had no way
to remove a row that should never have existed: a test event, a duplicate, a
spam listing. `remove()` in `event-service.ts` is that control, on
`/staff/events/[id]`.

It is not a lifecycle transition. A show that was real and isn't happening gets
`cancel()`, which announces it to the people who were coming.

**Refused once any ticket exists, in any status.** Cancelling voids tickets and
emails their holders, but the rows themselves are payment and check-in records —
so cancel is the _end state_ for a ticketed event rather than a step on the way
to deletion. `ticket.eventId` cascades, so without this guard a delete would
take that history with it silently. The button renders disabled, with the reason
in its tooltip, rather than failing after the click.

Four things the FKs get wrong on their own, all handled explicitly:

- **The linked reservation is cancelled, not deleted.** `event.reservationId`
  has no `onDelete` rule, so deleting the event would orphan the reservation and
  leave the room booked forever. Worse, for a recurring instance the generation
  job dedupes on _reservation_ rows rather than events, so a deleted-and-orphaned
  instance would be quietly recreated on the next cron run. Cancelling keeps the
  row, which is what makes the job skip it.
- **The poster is removed from R2.** Same lesson as the takedown path: nothing
  about that object's URL consults the database.
- **`content_flag` rows are deleted.** They're polymorphic with no FK, so a
  report against the event would survive pointing at nothing and break triage.
- **`event_band` and `event_rsvp` cascade**, which is correct — the bill and the
  headcount describe an event that, after this, never happened. The confirmation
  names both counts so a staffer can tell a mistake from a real show before
  confirming; `volunteer_shift.eventId` is `set null`, so shifts survive
  detached.

Members already have the equivalent for their own listings — a draft (or a
returned one) can be deleted outright, and a published listing reaches that by
being unpublished first.

## Dev testing

`seedCommunityEvents` in `scripts/seed-dev.ts` leaves every state reachable
without clicking: published listings from a trusted member, a draft, and a
review-required member with one listing in the queue and one returned with a
reason. The dev seed's existing cancelled events are already dated forward, so
the cancelled treatment shows on `/events` straight after a seed.

`e2e/community-events.e2e.ts` covers the round trips unit tests can't: a draft
absent from _both_ the public guide and the staff queue, publishing routing by
standing, and a rejection reaching the member as written English with its reason.
