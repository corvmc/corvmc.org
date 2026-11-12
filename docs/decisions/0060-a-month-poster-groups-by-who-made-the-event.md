# 0060 A month poster groups by who made the event

- **Date:** 2026-11-12
- **Status:** Accepted
- **Issue:** [#2597](https://github.com/corvmc/corvmc.org/issues/2597)

## Context

Staff need one image of a month's public events to post and print. Sustaining members are meant
to get more visible placement than other members. The show flyer (#2545) already has the brand
pieces and sponsor logos.

## Decision

1. **Three blocks, in order:** CMC events (`source = 'cmc'`), sustaining member events, then
   member events. Only `published` listings print. Partner-feed imports are left out.
2. **A band or group listing is a sustaining member's when any active member of the owning group
   subscribes.** A community listing is one when its submitter subscribes. `calendarBlock` in
   `src/lib/server/poster/calendar-service.ts` holds the rule.
3. **The footer credits every sponsor that any listing on the poster credits on its event page.**
   No placement exists above the event.
4. **A busy month shrinks, then splits into two columns.** A month too long for two columns at
   the smallest size ends its last block with "+N more <block> events".
5. **The poster is rendered on request and not stored.** The page previews it and offers the PNG.

## Alternatives rejected

- **Only the group owner's subscription counts.** Sustaining membership is personal, a band with
  one sustaining member is the case the benefit is for, and the owner row can drift from
  `group.owner_id`.
- **Store the poster as media.** Nothing reads it back, and a stored copy goes stale.

## Consequences

- A club whose chair subscribes prints every session under sustaining member events.
- A sponsor with an active deal and no placement in the month is not on the poster.
