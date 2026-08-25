# Remote query fan-out — progress checklist

Converting the 50 components that hold more than one remote query in flight at once, so
`custom/no-concurrent-remote-queries` can be widened to catch them. Survives between
sessions. Update the status column as tranches land.

## Why

A page gets one load-bearing query. Fanning several out of a component is a design smell
first — first paint waits on the slowest of N requests, and one screen's data contract is
spread across N round trips that nothing coordinates. Past `@sveltejs/kit` 2.64 (bisected
to kit#15991, "dedupe remote data") it is also a crash: the component drives Svelte into
`effect_update_depth_exceeded` and renders the error boundary instead of the page.

[#270](https://github.com/corvmc/corvmc.org/pull/270) established the fix and added the
rule, but the rule only matched `Promise.all([call(), call()])` with literal call
expressions. Every real offender uses a shape it could not see — sibling
`$derived(await …)` statements, `$state(q())`, `{@const}`, and `Promise.all` over
identifiers — so 50 files fanned out while lint stayed green. Two of them were live Sentry
issues: `-1V` (`member/directory/bands/[slug]`, three queries) and `-2H` (`SiteFooter`,
two), both fixed in the pass that produced this checklist.

## Status

**The widened rule is not registered yet.** It lands with tranche 15, once nothing violates
it — so `pnpm lint` stays green at every commit in between. Until then the inventory below
is the enforcement.

| #   | Tranche                                                    | Status | Commit |
| --- | ---------------------------------------------------------- | ------ | ------ |
| 1   | **Band panel — layout context** — 9 files, 22 queries      | ⬜     |        |
| 2   | **Directory — member and public** — 3 files, 9 queries     | ⬜     |        |
| 3   | **Help** — 3 files, 6 queries                              | ⬜     |        |
| 4   | **Equipment** — 4 files, 9 queries                         | ⬜     |        |
| 5   | **Events and recurring** — 6 files, 13 queries             | ⬜     |        |
| 6   | **Suggestions** — 4 files, 13 queries                      | ⬜     |        |
| 7   | **Marketing** — 3 files, 7 queries                         | ⬜     |        |
| 8   | **Reservations** — 3 files, 10 queries                     | ⬜     |        |
| 9   | **Inbox and messages** — 2 files, 6 queries                | ⬜     |        |
| 10  | **Volunteer — staff** — 6 files, 21 queries                | ⬜     |        |
| 11  | **Volunteer — member** — 2 files, 10 queries               | ⬜     |        |
| 12  | **Settings and account** — 2 files, 12 queries             | ⬜     |        |
| 13  | **Staff band detail** — 1 file, 4 queries                  | ⬜     |        |
| 14  | **Serial waterfalls** — 2 files, 6 queries — read the note | ⬜     |        |
| 15  | Register the widened rule at `error`                       | ⬜     |        |

Legend: ⬜ not started · 🔵 in progress · ✅ done · ⏸️ parked · ❌ withdrawn (finding didn't hold)

## Ground rules

- One tranche per commit. No co-author lines.
- **Repoint every `.refresh()` the conversion orphans.** Most are not in the component you
  are editing — they are single-flight refreshes inside the `.remote.ts` mutations, and a
  missed one leaves the page showing stale data after a save rather than failing, so nothing
  necessarily catches it. `custom/refresh-the-composed-query` catches the same-file ones;
  `grep -rn 'getThing(.*).refresh()' src/` before calling a conversion done.
- A constituent another page still reads directly needs **both** refreshes, not one instead
  of the other. `getOrgAddress` is the worked example — `/contact` reads it directly, the
  footer reads it through `getFooterInfo`.
- Not everything belongs in a composed query. Where the data is not first paint, it moves to
  the control that needs it and loads behind its own boundary — #270 did that for the
  inbox's assignable-staff list and the certification catalogue.
- Full suite before each commit; `pnpm check` and `pnpm lint` too.

## Inventory

Counts are from the widened rule. A lazy call — an event handler, a `loadMore` prop, a
`.then` continuation — is not a fan-out and is not counted.

### 1. Band panel — layout context

Every one of these re-awaits `getBandLayout(slug)`, which
[`band/[slug]/+layout.svelte:26`](../../src/routes/band/[slug]/+layout.svelte) is already
holding. One decision covers all nine: have the layout `setContext` its resolved value and
have the pages read it. Free — `bands.remote.ts:646,654` already refreshes `getBandLayout`,
so the pages inherit that refresh instead of needing their own.

- `src/routes/band/[slug]/reservations/+page.svelte` — 4
- `src/routes/band/[slug]/events/+page.svelte` — 3
- `src/routes/band/[slug]/members/+page.svelte` — 3
- `src/routes/band/[slug]/+page.svelte` — 2
- `src/routes/band/[slug]/events/[eventId]/+page.svelte` — 2
- `src/routes/band/[slug]/page-editor/+page.svelte` — 2
- `src/routes/band/[slug]/page-editor/epk/+page.svelte` — 2
- `src/routes/band/[slug]/settings/+page.svelte` — 2
- `src/routes/band/[slug]/subscription/+page.svelte` — 2

### 2. Directory — member and public

`member/directory/+page.svelte` also duplicates `getMe` from `(public)/+layout.svelte:10`.
The two profile pages in this area were already converted (`-1V`).

- `src/routes/member/directory/+page.svelte` — 4
- `src/routes/(public)/directory/+page.svelte` — 3
- `src/routes/(public)/directory/members/[id]/+page.svelte` — 2

### 3. Help

- `src/routes/member/help/[slug]/+page.svelte` — 2
- `src/routes/staff/help/+page.svelte` — 2
- `src/routes/staff/help/[id]/+page.svelte` — 2

### 4. Equipment

- `src/routes/staff/equipment/[id]/+page.svelte` — 3
- `src/routes/member/equipment/+page.svelte` — 2
- `src/routes/staff/equipment/+page.svelte` — 2
- `src/routes/staff/equipment/loans/[id]/+page.svelte` — 2

### 5. Events and recurring

`(public)/events` also mounts `MiniCalendar`, which starts `getPublicCalendar` of its own —
three in flight across the tree even though no single component fans out that far.

- `src/routes/member/events/+page.svelte` — 3
- `src/routes/(public)/events/+page.svelte` — 2
- `src/routes/member/events/[id]/+page.svelte` — 2
- `src/routes/member/events/[id]/manage/+page.svelte` — 2
- `src/routes/staff/events/+page.svelte` — 2
- `src/routes/staff/recurring/[id]/+page.svelte` — 2

### 6. Suggestions

- `src/routes/staff/suggestions/+page.svelte` — 5
- `src/routes/member/suggestions/[id]/+page.svelte` — 3
- `src/routes/staff/suggestions/[id]/+page.svelte` — 3
- `src/routes/member/suggestions/+page.svelte` — 2

### 7. Marketing

`campaigns/[id]/edit` and `campaigns/new` both hold `getPreview(markdownBody)`, which
re-fires on every keystroke-derived body change. That one is a debounce question as much as
a composition question.

- `src/routes/staff/marketing/campaigns/[id]/edit/+page.svelte` — 3
- `src/routes/staff/marketing/audiences/[id]/+page.svelte` — 2
- `src/routes/staff/marketing/campaigns/new/+page.svelte` — 2

### 8. Reservations

`staff/reservations` recreates four query promises on every filter keystroke. The superseded
ones reject with no consumer left, which is where `-3`'s 33 events came from — the client
filter now drops them, but this is the source.

- `src/routes/member/reservations/+page.svelte` — 4
- `src/routes/staff/reservations/+page.svelte` — 4
- `src/routes/staff/reservations/CreateModal.svelte` — 2

### 9. Inbox and messages

`InboxList` absorbs `inbox.remote.ts` L139, 218, 219, 245, 276, 277.
`ConversationList` duplicates `getMemberLayout`.

- `src/routes/staff/inbox/InboxList.svelte` — 4
- `src/routes/member/messages/ConversationList.svelte` — 2

### 10. Volunteer — staff

- `src/routes/staff/volunteer/roles/[id]/+page.svelte` — 6
- `src/routes/staff/volunteer/+page.svelte` — 4
- `src/routes/staff/volunteer/clearances/+page.svelte` — 3
- `src/routes/staff/volunteer/report/+page.svelte` — 3
- `src/routes/staff/volunteer/shifts/[id]/+page.svelte` — 3
- `src/routes/staff/volunteer/shifts/+page.svelte` — 2

### 11. Volunteer — member

The worst of the set, and the largest refresh cluster in the repo: `volunteer.remote.ts`
L497, 513, 587, 739-740, 815-818, 831, 844-846, 1257, 1271 — three of them already
`Promise.all([...refresh()])` bundles.

- `src/routes/member/volunteer/+page.svelte` — 7
- `src/routes/member/volunteer/interests/+page.svelte` — 3

### 12. Settings and account

`staff/settings` absorbs `settings.remote.ts` L112, 157, 196, 197, 237, 267 — note 196/197
now also carry `getFooterInfo`. `member/account` absorbs `account.remote.ts` L170, 171, 188,
189 plus `notifications.remote.ts:71`, and fans out twice: two in the script, then two more
as `{@const}` inside the template.

- `src/routes/member/account/+page.svelte` — 6
- `src/routes/staff/settings/+page.svelte` — 6

### 13. Staff band detail

- `src/routes/staff/bands/[id]/+page.svelte` — 4

### 14. Serial waterfalls — read before converting

These two are **not** the crash shape. They use plain sequential `const x = await q()`, and
both carry a comment saying they were deliberately written that way to escape an earlier
`effect_update_depth_exceeded` (`JAVASCRIPT-SVELTEKIT-W`). The rule flags them because a
page still gets one query and three serial round trips before first paint is a waterfall —
but this is a performance change to code that is the way it is on purpose. Convert with the
existing comments intact, or park the tranche; do not quietly undo the earlier fix.

- `src/routes/band/[slug]/edit/+page.svelte` — 3
- `src/routes/member/profile/+page.svelte` — 3

## Out of scope, recorded here so it is not lost

Every authenticated layout already has three queries in flight before any page runs: the
layout's own, plus `NotificationBell` (`getNotifications`) and `AccountDropdown` (`getMe`)
inside `AppTopbar`. Neither component fans out on its own, so the rule will not flag them,
but the tree-level concurrency is real and no page can get below it.
