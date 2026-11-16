# 0007 The canonical event URL holds the general view

- **Date:** 2026-08-28
- **Status:** Accepted

## Context

`/staff/events` served two jobs over one table. **Moderating listings** is reactive: a staffer
arrives because a listing was reported or held for review, and needs to know who posted it and what
else is on that date. **Running a production** is the opposite: one CMC show touched over weeks,
where the failure is something missing, such as no room held or no poster. The page toggled between
the two, and the detail page showed room and shift cards on listings CMC neither produces nor
staffs.

## Decision

1. **The split is work against publicity, not source against status.** The Calendar shows every
   source at public statuses plus `pending_review`, forward from today. The productions index
   shows `source = 'cmc'` at every status, drafts included. A published CMC show appears on both.
2. **The Calendar is scoped by status and never by source,** so a new source reaches it with no
   change. The productions index names the one source it wants rather than excluding the others, so
   a new source goes visibly missing instead of silently joining.
3. **The canonical URL holds the least-privileged useful view.** `/staff/events` is the Calendar,
   `/staff/events/[id]` the general detail view for every source, and
   `/staff/events/[id]/production` the console. Privilege is additive at the more specific address.
4. **"Posted by" replaces the Source column:** a band chip, a member's name, or CMC.

## Alternatives rejected

- **Splitting by source** (productions against everyone else's listings). Moderation asks what is
  public and whether it should be, and that includes CMC's own shows. A source-scoped page cannot
  show that a member's listing duplicates a CMC show on the same night.
- **Splitting by status.** A reported listing that is already published has no `pending_review`
  row, so it would stay on the work page.
- **Keeping the production console at `/staff/events/[id]`.** `entity-href` sends every event
  reference there, so a volunteer coordinator following a shift would land on the most privileged
  view, and gating it later would mean re-pointing every inbound link.

## Consequences

- `/staff/calendar` briefly existed and now redirects with a 308, because notifications written
  then keep that href.
- The console redirects a non-CMC listing to the general view.
- Staff still have no explicit duplicate warning; the Calendar shows a duplicate by putting it in
  its day group.
