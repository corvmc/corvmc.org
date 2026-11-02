# Partner calendar import

> ## Status
>
> 🔧 Building on `feature/partner-calendar-import` (#1459, the import half of #596). The outbound
> half, `/events/calendar.ics` and `/events/feed.xml`, shipped in #1442.

## Purpose

Other venues in town publish their calendars as iCalendar feeds. Staff paste a venue's feed URL
once, and the daily cron copies that venue's upcoming shows onto the public gig guide. A show nobody
at CMC authored and no member submitted still reaches the guide.

## Premise, checked against `main` on 2026-11-02

- Nothing reads an external calendar. The band "Import past gigs" modal parses pasted text.
- `venue` exists (`src/lib/server/db/schema/venue.ts`), and `event_listing.venueId` points at it.
- Community listings publish directly until staff uphold a report against one. The upheld report
  costs the author `community_event` standing (`scopeForFlag`).
- No partner venue has been named yet. #1460 parked the importer until one was named. Building it
  now is a decision (see [Decisions](#decisions)): nothing reaches the guide until staff add a feed.

## Model

**`calendar_source`** is one partner feed, and it always belongs to a venue (`venueId`, not null,
cascade). Staff add it from the venue's page. Columns: `url` (unique), `paused`, `lastFetchedAt`,
`lastError`, `lastImportedCount`, `createdByUserId`, timestamps.

**`event_listing` provenance** is `importSourceId` (FK to `calendar_source`, set null) and
`importUid`. A partial unique index on the pair is the dedupe key. `importUid` is the VEVENT's `UID`.
An expanded recurrence adds `#` and the occurrence's UTC start.

An imported listing is an ordinary `source='community'` row. It is `published` (or `cancelled`), at
the source's venue, and `createdByUserId` is the staffer who added the feed.

## The run

`/api/cron/import-partner-calendars` is in the daily batch, before `sweep-media`. For each source
that is not paused:

1. Fetch with a 15-second timeout and a 2 MB cap. A failure is written to `lastError` and the run
   moves to the next source. The job itself only fails when it throws.
2. Parse with `ical.js` (no Node built-ins). Keep events that start between today and a year ahead.
   Skip all-day events: they are closures and notices, not shows. Expand `RRULE`s within the window.
   Times with a `TZID` are read in that zone, floating times in `DEFAULT_TIMEZONE`.
3. Upsert by `(importSourceId, importUid)`:
   - **Existing row, `published` or `cancelled`:** the feed's title, description, times, URL and
     status overwrite ours.
   - **Existing row in any other status:** left alone. Staff pulled it, and a feed refresh must not
     put it back.
   - **New row:** skipped if `STATUS:CANCELLED`, or if a public listing that was not imported is at
     the same venue on the same local day. Otherwise inserted as `published`.
4. A listing that disappears from the feed is left as it is.

## Moderation

Imported listings are community listings, so anyone can report one. Upholding the report unpublishes
it the usual way. It costs nobody standing, because the staffer who added the feed did not write
the show. If a partner's feed keeps producing bad listings, staff pause the feed.

Imported rows stay out of the adding staffer's own "My listings": an edit there would be overwritten
by the next run.

## Decisions

Recorded for the owner to confirm or reverse. #1459 links them.
