# 0021 A club gets a page, not a panel

- **Date:** 2026-08-08
- **Status:** Accepted
- **PRs:** #326, #327, #328, #329

## Context

Bands have a panel at `/band/{slug}`: its own layout, nav and topbar entry. Clubs and committees
share the band's roster, announcements and documents code. A club member reads announcements, sees
upcoming sessions, downloads charts and occasionally leaves. Notifications and `/member/events`
already served the first two. A panel would have needed its own layout, nav items, a widened
`PanelTab` type and a merged topbar dropdown, for an audience of the few people who lead a program.

## Decision

1. **A club or committee is one tabbed page in the member panel**, `/member/groups/{slug}`, with
   `TabBar` in URL-driven mode. Announcements is the default tab. Editing the public face is a child
   route, `/member/groups/{slug}/edit`.
2. **`/member/groups` does membership and discovery together**: your programs, then open, then
   by-application, then invite-only programs. Bands never appear there; `/member/bands` stays their
   index.
3. **The shared parts are components, not a frame.** Announcements, documents and the roster live in
   `src/lib/components/groups/` and take the group as a prop, so the band panel mounts them as pages
   and the club page mounts them as tabs.
4. **`visibility` and `joinPolicy` are staff's.** The leader's edit form does not offer them,
   because free room time rests on staff deciding who a program admits.

## Alternatives rejected

- **A panel for every group.** A full frame for a receive-shaped relationship.
- **Member sections revealed on the public `/groups/{slug}` page.** Private documents on a public,
  cacheable route, and no precedent: the app mirrors public pages into the member panel instead.
- **A leader-only `/group/{slug}` panel.** Still a full frame, for a smaller audience.
- **An index of your own memberships only.** Discovery would land on a page only non-members open,
  and an `open` join policy would reach nobody.

## Consequences

- The topbar and `panel-tabs.ts` stay bands-only.
- The member sidebar has two groups, **My Bands** and **My Groups**.
- `getMemberGroup` returns the whole page in one query; announcement paging is the first thing to
  add if a club outgrows it.
