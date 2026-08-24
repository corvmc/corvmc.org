# Community Calendar — Phase 1: Unified Gig Guide on /events

## Purpose

First pass of the larger community calendar vision (IDEAS.md "Community Calendar"):
the public `/events` page aggregates CMC venue events (`source='cmc'`) and member
bands' events (`source='band'`) into one poster-forward gig guide. Band events
previously had no shared public surface — they were only visible on band pages and
microsites. The page answers "what's coming up" across the Collective and its member
bands, including gigs at other venues.

## Scope

**In:**

- `/events` composition, top to bottom: hero of the next 3 CMC shows as full
  `PosterCard`s → gig guide: compact `MiniCalendar` date-jumper beside a scannable
  `GigList` with a "Show more" pager.
- **GigList rows** (`src/lib/components/shared/events/GigList.svelte`, also used by the
  directory profiles' `ShowsBox`): fixed date
  block (month / day-number / weekday) · small framed poster thumb (uploaded art or
  the generated `poster-gen` pattern) · title link · "by {band}" link or CMC badge ·
  venue/time/price line. Rows group under coarse relative sections — "This Week"
  (today..+6 days), "This Month" (rest of the calendar month), "Looking Ahead";
  past-anchored rows group under their month name (`groupGigs` in
  `src/lib/utils/gig-groups.ts`).
- **Continuous pagination**: `getPublicGigGuide({ from?, offset })` returns
  20-per-page from the anchor date forward (fetches limit+1 to derive `hasMore`);
  the page appends client-side via "Show more".
- **MiniCalendar**: compact month grid with per-day dots (orange = any CMC that day,
  teal = band-only), prev/next month, today ringed. Clicking a day navigates to
  `/events?from=YYYY-MM-DD`, re-anchoring the list (works for past dates too);
  "Back to today" link appears when anchored.
- Generalized `/events/[id]` detail: band events render with a band byline linking
  to `/directory/bands/[slug]`, an external Tickets button when `externalTicketUrl`
  is set, and no internal RSVP UI.

  **CMC never sells a band's gig — not for bands, not for staff.** The money
  would land in CMC's Stripe account with no payout path back to the band, so a
  band gig is sold at the door, sold off-site via `externalTicketUrl`, or free.
  This is a rule about the event, not a permission split between bands and staff.

  Scoped precisely to `ticketingEnabled`, the platform-checkout flag. The other
  two ticketing fields are fine on a band gig and the band event forms offer
  both: `ticketPrice` is the display price an attendee pays wherever they buy,
  and `externalTicketUrl` is how a band sells at all. Only our checkout is off
  limits — see `src/lib/utils/event-ticketing.ts` for the three modes.

  Enforced in three places, because the UI is the weakest of them:
  - `createBandEvent` / `updateBandEvent` accept a price and a ticket link but
    have no `ticketingEnabled` param, and the band forms never submit one.
  - `update()` — the staff path, and the only other writer that can reach the
    flag — throws when a `source='band'` row tries to turn it on. Turning it
    _off_ is allowed, so opening the staff edit form on a row written before this
    rule clears the stale flag. The price is left alone either way.
  - `/staff/events/[id]` hides the "Sell tickets through the site" toggle for a
    band gig (keeping the price field) rather than offering an action the service
    refuses. `getPublicTicketPage`, `purchaseTickets` and `claimFreeTicket` also
    reject `source='band'` on source, which is a property of the row itself
    rather than a setting, so a row that predates the rule still cannot reach
    checkout.

  RSVPs are deliberately _not_ restricted: `rsvpToEvent` writes a headcount row,
  takes no money and issues no code, so band gigs get it like any other event.

- Home page "Upcoming Events" section shows the same next-3 CMC posters
  (`getPublicEvents`).
- Sitemap lists `/events/[id]` detail pages (including published band events when
  the flag is on) instead of `/events/[id]/tickets`, which 404s for non-ticketed
  events.

**Out (deferred to later phases):**

- ~~Community-submitted events.~~ **Shipped in phase 2** — the extension point
  held: `source='community'` slotted into the same queries with no structural
  change to them. See `docs/specs/shipped/community-events-spec.md`.
- Partner feed imports; subscribable `.ics` / RSS feeds (the RFC-5545 helpers in
  `src/lib/utils/calendar.ts` make this cheap when wanted).
- Band-admin notice that published events appear on the public gig guide.
- Unified cross-source "More shows" on event detail pages (currently CMC-only).
- Per-band or per-event opt-out from the public gig guide.
- Extending the `contentFlag` moderation system to events — band events publish
  without staff review, so this is the only backstop.

## Decisions

- **One page, not two.** An earlier iteration shipped a separate `/calendar` route;
  design review cut it — "Events" in the nav shouldn't imply CMC-only, and a second
  page hurt discoverability. `/calendar` was never published, so it was removed
  without a redirect.
- **List, not month grid.** A full month grid was built first and reversed: mostly
  negative space at this event density, truncated titles, and it erased the show
  poster — the main vibe-carrier. The gig list keeps rows scannable (fixed date
  column) while giving every event its art. The compact `MiniCalendar` covers the
  "what's on the 20th?" case as a date-jumper.
- **No new dependencies.** Mini-calendar and list are small custom components on the
  already-installed `@internationalized/date`.
- **No feature flag.** Band gigs are part of the gig guide unconditionally. The
  `bandEvents` flag this originally shipped behind has been removed — a
  permanently-on flag is worse than none, and the soft/hard check split it forced
  (`isFeatureEnabled` on public paths, `requireFeature` on band ones) was a
  standing source of confusion.
- **All entries link to `/events/[id]`.** Band microsites are subdomain-hosted and
  have no per-event detail page; the main-site detail page is the canonical URL for
  both sources.
- **Visual language:** CMC = `--cmc-orange`, band = `--cmc-teal` (mini-calendar
  dots, badges/links in rows). Off-site gigs are communicated by the venue line. No
  gradients.
- **Moderation:** none in this phase — a band publishing an event is the existing
  gate (band admins only).

## Superseded by phase 2

Two statements above no longer describe the code:

- **The guide is no longer published-only.** `listPublicCalendarEvents` and
  `listPublicUpcomingEvents` now select `publicEventStatuses` —
  `['published', 'cancelled']`. A cancelled show stays on the guide, marked,
  until its date passes, because cancelling is an announcement and the people
  who need it are the ones who already had the date; dropping it silently left
  them with nothing. Applies to all three sources. The hero posters
  (`listUpcoming`) and the mini-calendar dots stay published-only.
- **"CMC never sells a band's gig" is now "CMC only sells what CMC produces."**
  The rule is unchanged in substance; the four `source === 'band'` checks are
  `source !== 'cmc'`, so community listings are covered by the same three
  enforcement layers.

## Dev testing

Seeded band events (`seedBandEvents` in scripts/seed-dev.ts) include published
rows with off-site locations, so they show up in the gig guide straight after a
seed — no flag to enable.
