# 0074 A listing says who may see it

- **Date:** 2026-11-13
- **Status:** Accepted
- **Issue:** [#2662](https://github.com/corvmc/corvmc.org/issues/2662)

## Context

Every published listing appeared on the public guide, the calendar feed and RSS, including a
committee's working session and a club's weekly meeting. The month poster left meetings and
committee listings out by its own rule, so the two disagreed. #2607 made club and committee
sessions `kind = 'meeting'`.

## Decision

1. **`event_listing.visibility` is `public`, `members` or `group`.** `members` is any signed-in
   member. `group` is the active members of the listing's owning group (`group_id`).
2. **A new listing starts at `defaultVisibility(kind, ownerKind)`.** A meeting owned by a
   committee or a band is `group`; any other meeting is `members`; every other kind is `public`.
   Creation takes no visibility. Staff, band admins, the member who posted a community listing and
   a session's group admins change it on the edit form. A community listing has no owning group,
   so its form offers `public` and `members` only. A recurring occurrence copies its prototype's.
3. **One predicate.** `visibleTo(viewer)` in `src/lib/server/event/visibility.ts` is a SQL
   condition on visibility alone; each read keeps its own status rule. `null` is the public; a
   member sees `public`, `members` and their own groups' `group` listings; a reader with
   `event.read` sees all. `canSeeListing` runs the same condition on one row.
4. **Public reads pass `null`:** the gig guide, calendar feed, RSS, sitemap, homepage posters,
   show tonight, band and member profiles' shows, recaps, the duplicate check and the month
   poster. Only public listings appear on a public profile. The member events page's guide passes
   the signed-in member.
5. **The event page 404s for a viewer who may not see the listing**, with no notice that it
   exists. So do its ticket page, ticket and RSVP actions, the report form, the market pages, the
   member page's related cards, `/api/events/<id>` and `/e/<code>`, which 404s before it
   redirects.
6. **The month poster keeps club sessions.** It prints public listings and, as 0061 decided, a
   club's meeting at `members`. A meeting set to `group` does not print.
7. **The backfill** leaves every row `public` except group-owned meetings, which take their
   owner's default. Production's five Real Book Club rows become `members`.

## Alternatives rejected

- **A visibility check per page.** Remote functions bypass page loads, so the check lives in the
  service read and the remote.
- **Members events on the public guide when signed in.** The guide is the public's; a member's
  wider view is the member events page.
- **Group visibility for a club meeting by default.** The issue sets a club's meeting to members,
  and 0061 already treats club sessions as open.

## Consequences

- `scripts/event-visibility.spec.ts` fails any function that filters listings on a published
  status without `visibleTo` or a guard built on it, unless it is listed with a reason. It also
  fails a listing insert with a computed or `meeting` kind that does not name its visibility.
- `src/lib/server/event/visibility.spec.ts` runs every public read on real SQLite against one
  listing per visibility.
- A club meeting at `members` appears on the printed poster and not on the public guide.
