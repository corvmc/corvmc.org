# NNNN Partner feeds import as community listings

- **Date:** 2026-11-02
- **Status:** Accepted
- **Issue:** [#1459](https://github.com/corvmc/corvmc.org/issues/1459)

## Context

Other venues in town publish their calendars as iCalendar feeds, and nothing read them, so a show
nobody at CMC wrote up never reached the gig guide. `venue` and `event_listing.venueId` already
existed. No partner venue had been named, and #1460 had parked the importer until one was.

## Decision

1. **Build it now** (#2208). Nothing reaches the guide until staff add a feed, so building early
   publishes nothing.
2. **An imported show is an ordinary `source = 'community'` listing** (#2209), at the feed's venue,
   with the staffer who added the feed as its author. Upholding a report against one costs nobody
   standing, because that staffer did not write the show. A feed producing bad listings is paused.
3. **The feed owns a listing only while it is public** (#2210). A run overwrites a `published` or
   `cancelled` imported row with the feed's values, leaves a row staff pulled alone, and leaves a
   show that vanished from the feed as it is.
4. **A listing already on the guide wins** (#2211). A new show is skipped when a public listing that
   was not imported is at the same venue on the same local day.

## Alternatives rejected

- **Waiting for a named partner.** The importer is inert without a feed row, so waiting bought
  nothing.
- **Charging an upheld report to the staffer who added the feed.** That staffer chose a venue, not
  the show.

## Consequences

- `calendar_source` belongs to a venue and is added, paused, removed or fetched from that venue's
  staff page. Removing a feed keeps the listings it imported.
- Imported rows stay out of the adding staffer's own listings, where an edit would be overwritten
  by the next run.
- The dedupe key is `(importSourceId, importUid)`, the VEVENT `UID` plus the occurrence start for an
  expanded recurrence.
