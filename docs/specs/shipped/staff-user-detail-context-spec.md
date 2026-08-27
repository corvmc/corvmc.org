# Staff User Detail — Operational Context — Spec

## Purpose

`/staff/users/[id]` currently shows: an editable name/pronouns/email/phone/roles
card, a credits balance, a reference block (user id, Stripe id, join date), a
Danger Zone, and a payment records table.

That is an _account administration_ page. It is not the page a practice-space
manager actually needs, because it answers none of the questions a member calls
about:

- "Why was my booking cancelled?" → no reservations shown; staff cross-reference
  `/staff/reservations` by hand.
- "Am I still a sustaining member?" → the list page computes a `sustaining`
  tier, but the detail page never mentions membership or subscription state.
- "Can you add me to my band's booking?" → **there is no user → bands navigation
  anywhere in the app.** The relationship is only traversable band → members.
- "Where did my free hours go?" → a balance is shown with no history, even
  though `listTransactions` and `getUsageSinceLastAllocation` already exist.

Every one of those answers is already reachable in `src/lib/server/`; none of it
is wired to this page.

## Decisions

- **The page becomes a member's operational record, and the edit form becomes
  one card on it.** Editing a phone number is not the primary job; understanding
  the account is. The Account Info card stays where it is but stops being the
  whole page.
- **Reuse existing services; add no new tables.** `getMemberSubscription`,
  `listTransactions`, `listByUser` (payments), `listUpcoming` (events) and the
  `bandMember` join are all already imported into `users.remote.ts` or adjacent.
  This is a composition problem, not a data problem.
- **Summarise on the page, link out for depth.** Each new card shows a bounded
  slice (next 5 reservations, last 10 credit transactions) with a "View all"
  link into the existing filtered list route. The detail page must not become a
  second reservations browser.
- **Each card loads independently.** The page already `await`s several queries
  in parallel; new sections get their own `{#await}` so a slow or failing
  subscription lookup does not blank the reservations. Every one of them needs a
  real empty state — the Payment Records card shipped without one and "no
  payments" was indistinguishable from "the query failed" until this round of
  fixes.
- **Everything is read-only except what already had actions.** No cancelling
  reservations from this page; link to the reservation instead. Adding mutation
  surface multiplies the guard burden on `users.remote.ts`, which is exactly
  where the #162 escalation hole lived.

## Proposed layout

`PageContent width="3xl"`, single column, in the order a manager reads:

1. **Header strip** — name, pronouns, Deactivated badge, membership tier badge
   (Admin / Staff / Sustaining / Member), join date. At-a-glance identity.
2. **Account Info** (existing) — the edit form. Unchanged apart from the email
   change entry point (see `staff-email-change-spec.md`).
3. **Membership & subscription** _(new)_ — sustaining status, subscription
   status from `getMemberSubscription`, current period end, and the Stripe
   subscription id as a `CopyableId`. Empty state: "No membership subscription."
4. **Reservations** _(new)_ — next 5 upcoming plus a count of past, as a compact
   table: date/time, status via `StatusBadge`, booker type via `BookerTypeIcon`,
   linked to `/staff/reservations/[id]`. Cancelled-in-the-future rows are shown
   too — this is the card that answers "why was my booking cancelled?", so
   hiding cancellations would defeat it. "View all" → `/staff/reservations`
   filtered to this member.
5. **Bands** _(new)_ — the missing navigation. Rows of band name + this member's
   role in it (owner / admin / member) via `StatusBadge`, linked to
   `/staff/bands/[id]`. Includes inactive bands, greyed. Empty state: "Not in
   any bands."
6. **Credits** (existing, extended) — the two balances, plus the last 10
   `listTransactions` rows (date, delta, type, description, actor once the audit
   log exists). This is what turns "where did my free hours go?" from a database
   question into a glance.
7. **Payment Records** (existing) — unchanged, now with the empty state added in
   this round.
8. **History** _(new, collapsed)_ — audit entries for this user as subject. See
   `audit-log-spec.md`; this card is the reason that spec's "user detail page"
   surface exists.
9. **Details** (existing) — user id, Stripe id, joined, deactivated-at.
10. **Danger Zone** (existing) — deactivate / reactivate / purge.

Cards 8 and 9 are `collapsible().collapsed()`-style deep-dive sections; 1–7 are
open. Nothing goes in a second column — the current `lg:grid-cols-2` wrapper
held one card and left the right half blank on wide screens, which is why it was
dropped in this round.

## Data surface

New queries in `src/lib/remote/users.remote.ts`, all `await requireStaff()`
first — remote functions are directly addressable endpoints and the route guard
does not protect them (the rule #162 established):

```ts
getUserReservations(userId); // { upcoming: […5], pastCount: number }
getUserBands(userId); // { id, name, slug, role, active }[]
getUserMembership(userId); // { sustaining, subscription: … | null }
getUserCreditHistory(userId); // last 10 transactions + usage since last allocation
```

`getUserBands` is the only one needing a query that does not exist yet — a join
of `bandMember` → `band` filtered by user, which is the mirror of the existing
band → members query in `src/lib/server/band/`. It belongs in `band-service.ts`,
not in the remote file.

Everything else wraps a service function that already exists.

## Open questions

1. **Is "View all reservations for this member" a real filter on
   `/staff/reservations`?** The list has filters but the audit did not confirm a
   member filter exists. If not, either add one or make the link go nowhere —
   and a dead link is worse than no link (see the impersonate menu item).
2. **How much does this page need to load?** Nine cards is a lot of round trips
   on a D1-backed Worker. Do reservations/bands/membership get folded into one
   `getUserContext` query, trading independent failure isolation for latency?
   Leaning: keep them separate, measure, merge if it hurts.
3. **Should the Bands card be editable?** Adding a member to a band from here is
   the natural next ask, but band membership has its own permission model
   (`requireBandAdmin`) and staff override semantics. Out of scope; flag it.
4. **Does the member's own profile view need the same treatment?**
   `/member/profile` shows far less. If the two converge, some of these cards
   become shared components rather than staff-only ones — worth deciding before
   building rather than after.
5. **Privacy of the History card.** Once the audit log exists, this card shows
   which staff member did what to the account. Fine for a five-person volunteer
   team; worth re-checking if staff ever grows or if the `admin`/`staff` split
   lands (`admin-vs-staff-spec.md`) and staff should not see admin actions.
6. **Deactivated members.** Several cards are meaningless for a deactivated
   account (upcoming reservations are all cancelled by definition). Do they
   collapse, or render with an explanatory note? The note is probably more
   useful — it explains the cancellations.

---

## Revision — tabbed cross-section (implemented)

The layout above was superseded before it was built. The scope grew from "the
operational record" to _every_ program a member takes part in — roughly fifteen
domains rather than four — and a single column of fifteen cards is several
screens of scroll that fetches everything on every view.

### What changed

- **Tabs, not one column.** A persistent identity header and scoreboard sit
  above a `TabBar`: Overview · Space · Bands · Volunteer · Money · Comms ·
  Moderation · Account. Panels mount on first selection and stay mounted
  (`SvelteSet` of visited keys + `class:hidden`), so a tab's queries run exactly
  once and switching away does not discard a half-typed edit — `Form`'s `guard`
  only fires on navigation, and a tab change is not one.
- **Everything else in the original stands**: read-only apart from the actions
  that already existed, summarise-and-link-out, every card its own `{#await}`
  with a real empty state and a `{:catch}`.

### Open questions, resolved

1. **"View all reservations for this member"** — no. `/staff/reservations`
   reads nothing from the URL, so the link had nowhere to point, and a dead link
   is worse than none. The card pages in place instead. Adding URL seeding to
   that list is a separate change; the link can follow it.
2. **One `getUserContext` or N round trips** — both, split by need. Everything
   that must be correct _before_ a click (identity badges, scoreboard, tab
   badges, and therefore the whole Overview tab) comes from a single
   `getUserOverview`. Everything else belongs to its tab and is fetched when
   that tab is opened. First paint is two queries; no view fetches more than it
   shows.
3. **Deactivated members** — a note, not collapsed cards. It is the first item
   in Needs attention and says why the upcoming bookings are all cancelled,
   which is the question the state actually raises.

Questions 3 (editable Bands card), 4 (convergence with `/member/profile`) and 5
(History card privacy, pending the audit log) are untouched and still open.

### Note on feature flags

The tabs are **not** gated on feature flags. `src/lib/remote/layout.remote.ts`
records the panel-wide rule — staff surfaces ignore flags so staff can
administer a feature before and after it is switched on — and this page is not
worth making the exception. A switched-off program shows its empty state.

### Bug found and fixed in passing

`AdjustCreditsAction`, the certification grant/revoke actions,
`restoreListingTrust` and the whole Danger Zone were nested inside the
page-level `<Form remote={updateUser}>`. `Action` renders a bare `<Button>` →
`BitsButton.Root` with no `type`, so inside a form every one of those triggers
was `type=submit` and posted the profile edit on click. Removing the page-level
form — the edit form is now one card in the Account panel — fixes it.

---

## Density pass (implemented)

The tabbed record shipped saying the same things at four altitudes, and its tab
bar did not survive contact with a phone.

### What changed

- **One identity block.** `PageHeader` took an optional `leading` snippet and
  now carries the avatar, so the strip below it stopped restating the name. What
  is left there is what the header cannot hold: the contact line, and the
  member's bands as links.
- **Programs is gone.** The twelve-tile grid on Overview was a table of contents
  for a tab bar one row above it, and every tile restated a number its
  destination tab showed in full. Cutting it orphaned seventeen fields in
  `getUserOverview`, three of which — `cancelledUpcomingReservations`,
  `recurringSeries`, `unreadNotifications` — had never had a reader at all. The
  function went from 18 `select` statements to 8. `user-overview-service.spec.ts`
  now pins that: every count it computes must be a count it returns.
- **Bands are names, not a number.** The membership rows were already being read
  to scope reservations, and the join to `band` was already there to skip
  deleted ones — so the names come out of a query that was happening anyway. The
  scoreboard dropped from five stats to four, which also lays out as a clean 2×2
  on a phone.
- **Moderation is its own tab.** Comms was answering "how do we reach them" and
  "what have they done" at once. Standings and both report tables moved to
  `ModerationPanel`, leaving Comms with conversations, notifications and email
  lists.
- **Standings are read-only.** A standing is applied by the system when a report
  is upheld (`flag-service` → `restrictStanding`) and lifted through the appeal
  workflow. Setting one by hand from a member's record is a non-goal, so the
  restore actions and the "Direct messages" card went with it —
  `setMemberStanding` and `restoreMemberStanding` are now called by no UI.
- **Badges mean one thing.** A badge is a task, not a size. The neutral volume
  counts (upcoming bookings, band count) lost theirs; Comms kept unread threads
  and Moderation took the open reports.

### The tab bar was broken on a phone

`TabBar` rendered a daisyUI `join`, which does not wrap, inside an
`overflow-x-hidden` `<main>`. Past about five tabs the rest were clipped off the
edge with no way to reach them — not scrolled, gone. Three pages had already
hand-rolled an `overflow-x-auto` wrapper around the component to dodge it.

The fix is a `collapse` prop: below `md` the set becomes a `bits-ui`
`DropdownMenu` whose trigger names the active tab and carries its badge. Above
`md` it is the button group as before. The three pages dropped their wrappers.

While in there, the desktop control became a real `Tabs.List` of `Tabs.Trigger`.
It had been a `ToggleGroup`, which announces `role="radiogroup"` of `role="radio"`
— a tab UI presenting itself as a set of radio buttons, with no arrow-key
navigation and no "tab 3 of 8". `activationMode="manual"`, because the automatic
default would mount and fetch every panel you arrow past. Trigger ids are
explicit (`tab-{key}`) so the panels, which the page renders outside the
component, can point back at them with `aria-labelledby`.
