# 0006 Listings publish first and are moderated after

- **Date:** 2026-08-13
- **Status:** Accepted

## Context

`/events` became one gig guide across CMC shows and member bands' gigs, and then gained a third
layer: any signed-in member can list a show at another venue (`source = 'community'`). Band admins
already published without staff review. Staff needed a way to hear about a bad listing and pull it,
without a queue that every listing waits in.

## Decision

1. **Publishing is direct for everyone by default.** Moderation is reactive: anyone may report a
   published listing, anonymously and behind Turnstile, and staff triage it in the content-flag
   queue. Upholding a report can unpublish the listing in the same step, which notifies every band
   on the bill.
2. **Review follows an upheld report, not an accusation.** When staff uphold a report against a
   member's community listing, that member's later listings go to `pending_review` first.
   Dismissing a report changes nothing, so an anonymous report cannot cost anyone their standing.
   Restoring trust flips the standing row rather than deleting it.
3. **Members own a `draft` state.** Every listing starts as a draft; standing decides only where
   publishing lands. The staff queue keys on `pending_review`, so a half-written draft never
   reaches staff.
4. **`rejected` is its own status,** with a required note on `reviewNotes`. A rejected listing can
   be edited and resubmitted.
5. **A cancelled listing stays on the guide,** marked, until its date passes, for all three
   sources. Cancelling is an announcement to the people who already had the date.
6. **Abuse controls are a signed-in author, a publish rate limit, reports and per-member review.**
   There is no cap on how many listings a member holds.

## Alternatives rejected

- **A pre-approval queue for every listing.** A queue nobody works is worse than a listing nobody
  reported.
- **Reusing `cancelled` for a rejected submission.** `cancelled` is a public fact that the show
  was called off, and it is terminal; `cancel()` also releases rooms, voids tickets and emails
  holders, none of which applies.
- **Dropping cancelled shows from the guide.** Their detail pages started to 404, and anyone with a
  shared link learned nothing.
- **A total listing cap per member.** A published listing costs staff nothing, and the cap would
  stop a promoter who knows about fifteen real shows.
- **A feature flag.** Turning it off would hide the submit form and leave every published listing
  on the guide.

## Consequences

- Staff deletion is its own act, `remove()`, for a row that should never have existed. It is
  refused once the event has any ticket, because ticket rows are payment and check-in records.
- Standing is a per-member row at scope `community_event`; no row means good standing.
