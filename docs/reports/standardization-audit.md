# Standardization & Componentization Audit

**Date:** 2026-08-15
**Scope:** 128 route `.svelte` files, 26 `src/lib/remote/*.remote.ts`, `src/lib/server/**`,
`src/lib/utils/**`, `src/lib/components/**`
**Method:** Static analysis via three parallel exploration passes, with every headline count
re-verified by direct `grep` before publication. No rendering, no runtime verification, no
behavioural testing — a claim here means "this string appears N times", not "this is broken".

---

## The shape of the problem

This is not an unstandardized codebase. The shared component library is good, the rulebook
([ui-patterns.md](../development/ui-patterns.md)) is 745 lines of real guidance, and adoption of
the core primitives is healthy: `PageHeader` 82 files, `StatusBadge` 41, `EmptyState` 34,
`InfoCard` 30, `DataList` 15, `FilterBar` 15.

The problem is **uneven adoption**, in two distinct flavours:

1. **On the UI side** — a good component exists and ~15 route files hand-roll it anyway.
2. **On the server side** — the _volunteer domain is already the reference implementation_
   (named validation constants, `mapDomainError` in every catch, enums with label maps), and
   the other 17 domains have not caught up. Nearly every server finding below reduces to
   "copy what volunteer already does."

Nothing here is a redesign. Every item is a mechanical convergence onto a pattern that already
exists somewhere in the repo.

Three findings are **correctness issues, not cosmetics**, and are marked 🔴. They are the reason
to read past the first section.

---

## 🔴 Correctness issues found while auditing

> **Revised 2026-08-16.** All three items in this section were re-verified before implementation
> began, and all three were **overstated in the original draft**. C1 is not a live bug at all; C2's
> count was 11, not ~32; C3 is a drift risk rather than a present defect. Corrections are inline
> below. The genuinely user-visible correctness problem in this codebase is the **timezone split**,
> which the original draft filed one section lower as merely "blocked".

### C1. Filter-schema divergence — latent, **not** a live bug

There is no shared filter schema. The `page` parameter is declared **16 times across 10 files**
in two incompatible forms:

| Form                                              | Count | Files                                                                                                     |
| ------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------- |
| `page: z.number().optional()`                     | 13    | `volunteer` (×3), `users` (×3), `equipment` (×2), `bands`, `flags`, `events`, `recurring`, `reservations` |
| `page: z.coerce.number().int().min(1).optional()` | 3     | `inbox` (×2), `community-events`                                                                          |

**Correction (2026-08-16):** an earlier draft of this report claimed `?page=2` was rejected by the
`z.number()` endpoints. That was wrong, and verifying it before acting on it is what caught it.
**Every caller coerces before the value reaches the schema** — pages initialise their state as
`Number(initial.get('page') ?? '1') || 1` (`staff/inbox/+page.svelte:47`,
`staff/volunteer/+page.svelte:50`, `staff/volunteer/report/+page.svelte:31`) and `DataList`'s
`onpage` hands back a number. No raw string reaches a `page` schema anywhere in the app.

What remains is a genuine **latent footgun**: the two forms disagree about what they accept, so the
first caller that forwards a raw query string — or any future URL-driven pagination — breaks on 13
endpoints and works on 3. Worth converging, but it is a consistency fix, not a bug fix.

Related dead code: **`parsePagination(url)` (`paginate.ts:14`) has zero call sites.** It is the one
helper that _would_ have read `page` straight off the URL as a string — the very path that would
have made this a real bug. It was never wired up.

The **`status` half of this finding stands on its own merits.** It shows the same split — a typed `z.enum(...)` in `flags.remote.ts:26`,
`inbox.remote.ts:53`, `events.remote.ts:416`, but a bare `z.string().optional()` in
`equipment.remote.ts:70`, `volunteer.remote.ts:140`, `users.remote.ts:162`,
`marketing.remote.ts:185` — meaning half the endpoints accept any string as a status and silently
match nothing. That one is worth fixing on its own.

`users.remote.ts` declares the shape three times by itself (`:91`, `:160`, `:183`).

**The fix already exists locally:** `volunteer.remote.ts:319` does
`reportRange.extend({ page: z.number().optional() })`. Hoist a shared `listFilters` schema and
extend it.

### C2. One error class reaches the user as a 500 — not eleven

`mapDomainError()` ([errors.ts:69](../../src/lib/server/errors.ts)) is the documented catch-block
idiom. It is imported by **4 of 26** remote files — `membership`, `reservations`,
`community-events`, `volunteer` — and volunteer alone owns 33 of its 53 call sites. There are
**81 `catch` blocks** in remote files; most hand-roll their own status mapping.

The deeper issue is underneath it. Of **64 distinct error classes** under `src/lib/server/`, 35
extend `DomainError` (handled generically via `httpStatus`) and 19 more are named in the
`instanceof` ladder at `errors.ts:76-117`. Anything else is re-thrown (`:120`) and surfaces as a 500.

**Corrected twice (2026-08-16).** The first draft said ~32 classes, from subtracting raw counts
instead of deduplicating against the ladder. The corrected figure was 11. Tracing the actual call
paths during implementation showed even that was wrong in the way that matters: **10 of those 11
are handled**, just inline in each remote file's catch block
(`if (err instanceof FlagNotFoundError) error(404, …)`) rather than through `mapDomainError`. They
never reach a 500.

Exactly **one** class was thrown and handled nowhere: `UserHasPublishedListingsError`. `purgeUser`
mapped its four siblings and omitted it, so a staffer purging a member who still had community
listings on the public calendar got an opaque 500 instead of the service's deliberate, readable
"This member has community listings on the public calendar". Fixed, with a regression test that
was confirmed failing first.

So the honest form of C2 is: **one real bug, plus status-mapping duplicated across 22 remote files
that the existing `mapDomainError` was built to absorb.** The duplication is worth removing — every
new error class has to be remembered in a hand-written ladder, which is exactly how this one got
missed — but it is a maintainability finding, not a live outage.

The flag and user clusters are exactly the domains whose remote files hand-roll their ladders
instead of calling the mapper — which is why the one omission happened there.

Corroborating signal: `error(422, …)` appears **zero** times across all remote files, because 422
is only reachable _through_ the mapper.

Raw status-code usage for contrast: `error(404)` 69, `error(400)` 44, `error(403)` 22,
`error(409)` 9, `throw new Error(...)` 9.

### C3. The Stripe fee formula is hard-coded in 3 UI files — drift risk, currently correct

`$lib/finance/fees.ts` owns the fee math (`STRIPE_PERCENT` at `:9`, the derivation documented at
`:25-26`) and is used correctly by `(public)/events/[id]/tickets/+page.svelte` and both server
payment services. Three UI files bypass it and inline the solved formula:

- `src/lib/components/member/membership/SubscriptionForm.svelte:33`
- `src/routes/member/reservations/PaymentStep.svelte:83`
- `src/routes/member/reservations/[id]/pay/+page.svelte:63`

```js
Math.ceil((baseCents + 30) / (1 - 0.029)) - baseCents;
```

Both the 2.9% rate and the 30¢ fixed fee are literals. **To be precise about severity: the values
currently agree with `fees.ts` (`STRIPE_PERCENT = 0.029`, `STRIPE_FIXED_CENTS = 30`), and the
inlined expression is arithmetically identical — so no member is being shown a wrong number
today.** This is a drift risk, not a present defect.

It earns its place here because of _which_ screens they are: the two that quote the fee to a member
immediately before they pay. A Stripe pricing change would update `fees.ts` and the server while
leaving these three displaying the old total, and nothing would fail loudly.

---

## 🔴 C4. Timezone split — the real user-visible defect (**decided 2026-08-16**)

**Two incompatible timezone regimes are live simultaneously.**
`src/lib/utils/format.ts` formats via `date-fns` in the **browser's local zone**. The reservations
flow formats via `toLocale*String(..., { timeZone: DEFAULT_TIMEZONE })` — the **venue's zone**.
The same reservation therefore displays a different time depending on which page you are on.

Venue-zone sites: `member/reservations/[id]/+page.svelte:16,25`,
`member/reservations/[id]/pay/+page.svelte:40,49` (both named re-definitions of `formatDate` +
`formatTime`), plus inline `en-CA`/`en-GB` pairs at `ConfirmStep.svelte:32-33` and
`PaymentStep.svelte:39-40`. `staff/reservations/+page.svelte` and `DayTimeline.svelte` use the
same idiom.

Five further sites call bare `toLocaleDateString()` with **no options at all** — output depends on
the viewer's OS locale (`StaffBandForm.svelte:113,121,125`,
`staff/marketing/audiences/[id]/+page.svelte:73`, `staff/marketing/campaigns/[id]/+page.svelte:57`).

`src/lib/server/reservation/timezone.ts:135-169` already has four correct tz-aware formatters, but
they are server-only and unreachable from components — which is precisely why the reservations
flow copy-pasted its own.

**This blocks any shared `DateTimeRange` / `Duration` component.** The two options:

| Option                       | Consequence                                                                                                                                                                   |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Venue zone everywhere**    | A 7pm booking reads 7pm regardless of where the member is. Requires porting `formatDateInTz`/`formatTimeInTz` into `format.ts` and migrating existing `format.ts` call sites. |
| **Browser-local everywhere** | Delete the `DEFAULT_TIMEZONE` variants. Simpler, but a touring member in another zone sees a time that doesn't match the door.                                                |

Recorded, not decided. Resolve before building the date components.

---

## Tier 1 — new shared components

Ranked by (occurrences × how identical the copies are). The top item is the cheapest.

### 1. `DefinitionList` / `Fact` — 11 byte-identical copies across 9 files

This exact string is copy-pasted verbatim:

```svelte
<dl class="grid gap-x-4 gap-y-2 text-sm" style="grid-template-columns: auto 1fr;">
```

followed each time by hand-written `<dt class="opacity-60">` / `<dd>` pairs.

- `src/routes/staff/flags/[id]/+page.svelte:48`, `:81`, `:182` — three in one file
- `src/routes/staff/equipment/loans/[id]/+page.svelte:50`
- `src/routes/staff/equipment/[id]/+page.svelte:79`
- `src/routes/staff/users/[id]/+page.svelte:282`
- `src/routes/staff/recurring/[id]/+page.svelte:49`
- `src/routes/staff/volunteer/shifts/[id]/+page.svelte:72`
- `src/routes/staff/marketing/audiences/[id]/+page.svelte:53`, `campaigns/[id]/+page.svelte:34`
- `src/routes/staff/bands/[id]/StaffBandForm.svelte:77`
- `src/routes/member/equipment/loans/+page.svelte:73`, `:135` (near-variant, `gap-y-1`)

Across all of `src/` there are 16 `<dl>` blocks in 13 files, so this one pattern is essentially
_every_ definition list in the app.

Recurring sub-idioms a component would absorb: conditional rows, `font-mono text-xs` for IDs,
`whitespace-pre-wrap` for notes, `<dd><StatusBadge/></dd>`.

**Does not already exist.** `QuickFacts.svelte` is a boxed 4-up public-profile strip with its own
scoped CSS that drops empty values — a different component for a different job.

**Effort:** low. **Risk:** very low — the source is identical, so the diff is mechanical.

### 2. `Money` — 14 inline conversions bypassing an existing formatter

`formatCents` ([format.ts:156](../../src/lib/utils/format.ts)) and `formatDollars` (`:161`) exist
and are imported by 13 files. Meanwhile `(x / 100).toFixed(2)` is inlined **14 times**, including
four byte-identical private re-definitions in the reservations flow:

- `member/reservations/ReservationCard.svelte:24`
- `member/reservations/ConfirmStep.svelte:62`
- `member/reservations/PaymentStep.svelte:87`
- `member/reservations/[id]/pay/+page.svelte:58`
- `member/events/[id]/manage/+page.svelte:70` (`toDollars`, null-tolerant)
- `SubscriptionForm.svelte:39,40`, `staff/events/[id]/+page.svelte:105`,
  `staff/reservations/ResolveModal.svelte:36`, `band/[slug]/events/[eventId]/+page.svelte:275`

Plus a server-side rename: `formatMoney` at
`src/lib/server/notification/notification-listeners.ts:42` is `formatCents` verbatim.

The reason the helper gets bypassed is a shape mismatch — `formatCents` returns the `$`, but most
call sites want `>${cents(x)}<` inside markup. A `<Money cents={…} />` component with
`hideSymbol`, `perUnit="hr"`, and `zeroLabel` props would absorb both shapes and take C3 with it.

**Effort:** low. **Risk:** low.

### 3. `RowCard` — ~10 sites, cosmetic divergence only

`card-body flex-row items-center justify-between py-4` inside `card bg-base-100 shadow`, left side
title + muted sublines, right side badge/actions:

- `band/[slug]/events/+page.svelte:117` (wrapped in `<a>`), `band/[slug]/+page.svelte:59`
- `band/[slug]/reservations/+page.svelte:57`, `:104`
- `band/[slug]/members/+page.svelte:126`, `:193`, `:233`
- `member/bands/+page.svelte:133`, `staff/events/[id]/check-in/+page.svelte:56`,
  `staff/closures/+page.svelte:60`

Divergence is limited to `py-3`/`py-4`/`p-4`, `shadow` vs `shadow-sm`, and whether the wrapper is
an `<a>`. `InfoCard` is the sibling abstraction; there is no row equivalent. (For scale: 67 raw
`class="card …"` occurrences across 28 route files.)

**Effort:** low. **Risk:** low — pick one padding value and accept the 1px shifts.

### 4. `RecordHero` — detail pages split between two rival answers

"Status + key facts at the top of a record page" is solved two different ways:

_Hand-rolled hero card_ — `staff/reservations/[id]/+page.svelte:86-100`,
`member/reservations/[id]/+page.svelte:36-50` (same shape, different shadow/gap).

_Badge stuffed into `PageHeader` actions_ — `staff/flags/[id]`, `staff/equipment/[id]:41`,
`staff/equipment/loans/[id]:36`, `staff/recurring/[id]`, `staff/events/[id]`.

`PageHeader` (82 files) owns title/subtitle/back/actions and the `<title>` tag, but has no slot for
a status+facts line — which is why half the detail pages grew a card underneath it and the other
half improvised.

Related: **`RecordNav` is used by exactly 1 route** (`staff/reservations/[id]`) despite prev/next
being applicable to every `[id]` detail page. Either adopt it broadly or delete it.

**Effort:** medium — this one requires a design call, not just extraction.

### 5. `PersonChip` — three disjoint abstractions, none reusable

| Existing                         | Reach                            | Why it can't serve the others                                                                                                                                               |
| -------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MemberLink`                     | 16 files, **all under `staff/`** | Hard-codes `href={resolve('/staff/users/' + userId)}`. Structurally unusable from member or band panels.                                                                    |
| `CrossRefList` (`CrossRef` type) | 4 directory pages                | Its `{name, sub, href, image, avatarShape, private}` shape _is_ the right generic contract — but it's list-only, with no single-chip export, and buried under `directory/`. |
| `Avatar`                         | 5 files                          | Initials + `hashPattern` poster art.                                                                                                                                        |

Six hand-rolls use none of them, most visibly `band/[slug]/members/+page.svelte:127-141`, which
uses a daisyUI `placeholder avatar` with manual `charAt(0).toUpperCase() ?? '?'` — so band members
get a plain neutral circle while every other surface in the app gets the generated poster pattern.
Same idiom again at `BandSiteRenderer.svelte:131-137`.

Also duplicated verbatim 4×: the bandleader rule
`sub: m.position ?? (m.role === 'owner' || m.role === 'admin' ? 'Bandleader' : null)`.

**Effort:** medium. Blocked on a call: does `MemberLink` get re-expressed on top of `CrossRef`, or
do they stay separate?

### 6. `ShareButton` — three byte-identical copies

The copy-current-URL handler is duplicated exactly three times:
`ProfileHeader.svelte:27`, `member/events/[id]/+page.svelte:114`,
`(public)/events/[id]/+page.svelte:88`.

Four other `navigator.clipboard` sites each handle failure differently — silent no-op, `toast.error`
(`staff/volunteer/roles/[id]:99`), no error path (`staff/users/+page.svelte:110`), and
fire-and-forget unawaited (`staff/settings/+page.svelte:780`). `CopyableId` exists but is scoped to
ID-shaped values (3 files).

**Effort:** low. QR is already centralized in `TicketQRModal` — no action needed there.

### 7. `DateTimeRange` / `Duration` — ⚠️ blocked, see above

Five distinct duration labels are in play: `"2 hours"` (`formatDuration`), `"2 hrs"`
(`formatDurationAndAmount`), inline `{h} hour{h===1?'':'s'}` (3 sites), `{h}hr ×`
(`PaymentStep.svelte:122`), and `formatVolunteerHours(minutes)`. Plus 14 raw `Intl.DateTimeFormat`
option bags. Do not build until the timezone question is settled.

---

## Tier 2 — pattern drift (a component exists and is bypassed)

| Category                    | Files | Occurrences | Note                                          |
| --------------------------- | ----: | ----------: | --------------------------------------------- |
| Raw form controls           |    66 |         242 | **See severity split below**                  |
| Hand-rolled `card` blocks   |    28 |          67 | vs. `InfoCard`                                |
| Hand-rolled `badge badge-*` |    14 |          21 | vs. `StatusBadge` — plus 5 inline status maps |
| Bare `<h1>`                 |    16 |          19 | vs. `PageHeader` — ~6 are legitimate          |
| `<textarea>`                |    14 |          16 | vs. `FormField type="textarea"`               |
| Hand-rolled `alert alert-*` |    12 |          13 | vs. `Alert`                                   |
| Hand-rolled spinners        |    11 |          13 | vs. the layout `<svelte:boundary>`            |
| Filter toolbars             |     7 |           — | vs. `FilterBar`                               |
| Raw `<form>`                |     6 |          11 | vs. `Form`                                    |
| Hand-rolled `<table>`       |     5 |           5 | vs. `Table`                                   |
| Hand-rolled tabs            |     2 |           2 | vs. `TabBar`                                  |

### The raw-input number needs splitting

242 non-hidden `<input>` elements across 66 files sounds alarming and mostly isn't. **121 of them
are `{...fields.x.as('text'|'file'|'checkbox')}` spreads inside a real `<Form>`** — correctly wired
to a remote form, just bypassing `FormField`'s label/error/readonly handling. That's a polish
issue.

The remaining ~121 are genuinely hand-rolled. They concentrate hard:

| File                                        | Non-hidden inputs |
| ------------------------------------------- | ----------------: |
| `staff/events/[id]/+page.svelte`            |                23 |
| `band/[slug]/page-editor/+page.svelte`      |                21 |
| `staff/help/+page.svelte`                   |                17 |
| `band/[slug]/page-editor/epk/+page.svelte`  |                14 |
| `staff/settings/+page.svelte`               |                11 |
| `band/[slug]/events/[eventId]/+page.svelte` |                11 |

Those six files are ~40% of the total. They are also the same files that dominate the card, filter,
and empty-state rows above — **`page-editor`, `page-editor/epk`, `staff/settings`, and
`staff/events/[id]` each appear in 5+ drift categories.** Fixing those four files resolves roughly a
third of Tier 2.

### Inline status maps (the `StatusBadge` sub-finding)

Five route files re-implement status→colour/label mapping that the registry already owns:

- `staff/volunteer/shifts/[id]/+page.svelte:33` — `Record<string, string>` of badge classes
- `staff/volunteer/clearances/+page.svelte:51,58` — `stateLabels` + `badgeClass` pair
- `staff/users/[id]/+page.svelte:224` — a 4-way nested ternary
- `staff/reservations/[id]/+page.svelte:61` — `$derived.by` returning `{ label, class }`
- `band/[slug]/events/LineupEditor.svelte:70,77` — `chipLabel()` / `chipClass()`

`band/[slug]/settings/CustomDomainSection.svelte:32-50` does the same thing but feeds `Badge
variant=` — the closest-to-correct of the group, and the model for fixing the rest.

### Missing prop, not missing discipline

`StatCard` is used in only 4 files. Two of the bypasses — `band/[slug]/+page.svelte:30-41` and
`staff/events/[id]/check-in/+page.svelte:34-41` — hand-roll raw `<div class="stat">` for one
reason: both need `stat-value text-2xl` and **`StatCard` has no size prop**. The missing prop _is_
the finding. `SectionLabel` (4 files) has the same story against ~55 hand-rolled `<h2>` treatments,
9 of which — all in `band-site/[slug]/epk` — are visually identical to `SectionLabel` with a
hardcoded `text-gray-400`.

`Pagination` is imported by **zero** route files; `DataList` covers it for 15. Three pages hand-roll
"Show more" instead (`(public)/events`, `member/directory`, `member/events`).

---

## Tier 3 — server layer

Beyond C1 and C2 above:

### Validation limits — ~110 magic numbers, pattern proven but unadopted

`src/lib/config.ts:252-326` has a well-documented named-constant block
(`VOLUNTEER_NAME_MAX`, `VOLUNTEER_BACKDATE_LIMIT_DAYS`, …) plus `SEARCH_LIMIT` / `LIST_LIMIT`
(`:22-23`). Adoption is one domain wide:

| File                    | magic `.max(N)` | named |
| ----------------------- | --------------: | ----: |
| `volunteer.remote.ts`   |               3 |    33 |
| `help.remote.ts`        |              15 |     0 |
| `equipment.remote.ts`   |              15 |     0 |
| `marketing.remote.ts`   |              14 |     0 |
| `directory.remote.ts`   |              14 |     0 |
| `band-events.remote.ts` |              11 |     0 |
| `bands.remote.ts`       |               9 |     0 |

The literals cluster — `.max(255)` ×20, `.max(100)` ×16, `.max(500)` ×15, `.max(2000)` ×12 — which
is the signature of copy-paste, not of deliberate per-field limits. `flags.remote.ts:56,85,117` is
the one non-volunteer file importing named limits, so the pattern already ports.

### Auth guards — healthiest area, with a dead helper and two private copies

Shared helpers are genuinely well-used: `requireStaff()` **206** call sites, `requireUser()` 92,
`requireBandAdmin()` 29, `requireBandOwner()` 7, `requireBandMemberOrStaff()` 5. Homes are
`src/lib/server/authorization.ts` and `src/lib/server/band/band-context.ts`.

The gaps:

- **85 raw `locals.user` guards** in `src/lib/remote/`, concentrated in `reservations` (40),
  `layout` (15), `events` (14).
- **`requireStaffOrOwner()` has zero call sites** — defined at `authorization.ts:146`, never used.
  It is dead code, while four places hand-roll the same check (`equipment.remote.ts:420`,
  `recurring.remote.ts:64`, `reservations.remote.ts:539`, `:1850`). Either adopt it or delete it.
- **`requireAdminOfBand` privately re-implemented twice**, in
  `src/routes/api/bands/[id=uuid]/avatar/+server.ts:13` and `media/+server.ts:24` — duplicating
  `requireBandAdmin()`, and each then needing its own separate `locals.user` null-check.
- A byte-identical local copy of `requireUser` at `notifications.remote.ts:13-17`.
- Deprecated `requireMember()` still live at 5 call sites, all in `membership.remote.ts`.
- Three different ways to ask "is this user staff": `requireStaff()`, `isStaff()` (11),
  `hasAnyRole()` (11), plus a raw `locals.user.isStaff` flag at `reservations.remote.ts:1925`.

### Enum / label single source — **withdrawn 2026-08-16, the finding was wrong**

This section originally claimed enum definitions were "split across two homes with no rule" and
that two route files "re-declare maps the registry already owns". Checking each claim before acting
on it dissolved all three:

**There is a rule, it is just undocumented.** Enums that real client code (routes, components)
imports live in `config.ts`; enums only server code needs live in `db/schema/*`. The apparent
counter-examples — `reservationStatuses`, `eventStatuses`, `flagStatuses`, `ticketStatuses`
appearing to have "client" importers — are all `StatusBadge.spec.ts`, which runs in the _server_
vitest project where `$lib/server` is reachable. Moving the `config.ts` enums into schema would
break client bundling, because `$lib/server` cannot be imported from the browser. **The rule
should be written down, not "fixed".**

**`CustomDomainSection.svelte` is not duplication.** Its labels are `active → "Live"`,
`pending → "Waiting on DNS"`, `failed → "Failed"`. The generic registry owns the _colours_ for
those words but would render "Active"/"Pending"/"Failed", losing the DNS context that is the whole
point of the message. Domain-specific vocabulary, correctly local.

**The two `entityLabels` maps are not identical.** `staff/flags/+page.svelte` uses
`'Member' | 'Band' | 'Event'` for a table column; `staff/flags/[id]/+page.svelte` uses
`'Member profile' | 'Band profile' | 'Event listing'` for a definition list. The original claim
came from matching them by _name_ without diffing their contents — a list and a detail page
differing in label density is correct, not accidental.

**Extracting `labels`/`badgeClass`/`variants` out of `StatusBadge.svelte` has no consumer.** The
only importer is its own spec. Doing it would be speculative generality.

Net: nothing to change here beyond documenting the enum-placement rule, which
[conventions.md](../development/conventions.md) now carries.

### Misc duplicated utilities

- **`initials()` — byte-identical, defined twice** and absent from `format.ts`:
  `VinylCard.svelte:29`, `IdCard.svelte:54`.
- **Slug generation — 3 divergent implementations.** Canonical `generateSlug`
  (`server/utils/slug.ts:13`) drops punctuation; `staff/help/create/+page.svelte:21` hand-copies it
  client-side _with a comment admitting it "Mirrors generateSlug"_; `staff/help/+page.svelte:64` is
  a third variant. Separately `utils/markdown.ts:65` has a `slugify` that _hyphenates_ — different
  semantics, defensible for heading anchors, but confusingly named.

### DTO discipline — lowest-confidence finding

`src/lib/types/` holds 6 files, dominated by band-page and email models; there are no shared types
for the core list/detail entities. Most consumers rely on inferred return types — type-safe, but
with no named contract, so where a name is needed it gets re-declared:
`member/events/+page.svelte:19` declares a local `interface EventItem`; `band-site.remote.ts:21`
imports a service-internal `EventRow`.

Three `'…' | 'all'` status views restate enum vocabularies. `staff/volunteer/+page.svelte:31`
correctly derives its union; `staff/inbox/+page.svelte:25` hand-types
`'open' | 'snoozed' | 'resolved' | 'all'` and will silently drift from `config.ts:175`.

This is mostly an _absence_, and is flagged with less confidence than the rest.

---

## Already standardized — leave alone

Recorded so a future pass doesn't churn them:

- **`paginate()`** (`db/paginate.ts:21`) — 20 importers, and the only `(page - 1) * pageSize` in
  the entire codebase is inside the helper itself. Zero hand-rolled copies.
- **Email / notification dispatch** — one path through `dispatcher.ts`, with exactly two
  deliberate, differently-channelled bypasses (`campaign-service.ts:345` broadcast,
  `channel-dispatcher.ts:77` threaded reply).
- **Modals** — **0** raw `<dialog>` or `showModal()` in routes. Fully migrated to `Modal` (17
  files) / `Action` (43 files).
- **Raw `<select>`** — **0** in routes; all go through the `Select` component.
- **`.select` wrapper placement** — 0 offenders left in routes. `FormField.svelte:219` is the
  documented `[multiple]` exception explained at `Select.svelte:16-19`.
- **Icons** — `@tabler/icons-svelte` in 86 files, and **zero** competing libraries. Imported ad hoc
  per file but consistently; the `BookerTypeIcon` / `PaymentMethodIcon` semantic-mapper precedent
  is the right pattern. No registry needed.
- **`StatusBadge` adoption** — 41 route files, no meaningful hand-rolls beyond the 5 maps noted.
- **`Nav.*` components** — no duplication.

Both nav fragilities recorded here are resolved: `Nav.Collapsible`'s hand-maintained `childHrefs`
now derive from the panel's nav data, and the triplicated `panels` array is
`$lib/components/layout/panel-tabs.ts`.

---

## Sequenced attack plan

Ordered by impact ÷ risk. Each tranche is independently shippable.

| #   | Tranche                                                                                       | Why here                                                                                                                       |
| --- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **Shared filter schemas** (C1)                                                                | Smallest diff in the audit; fixes a live `?page=` bug.                                                                         |
| 2   | **`DefinitionList`**                                                                          | 11 byte-identical copies, zero design decisions.                                                                               |
| 3   | **`Money` + route the 3 fee formulas through `$lib/finance/fees`** (C3)                       | Deletes 4 private helpers and closes a silent payment-display desync.                                                          |
| 4   | **Centralize validation limits**                                                              | Mechanical; copy the volunteer pattern outward.                                                                                |
| 5   | **Extract `StatusBadge`'s maps to a `.ts` module; pick one home for enum definitions**        | Unblocks server-side label use; deletes 3 duplicated maps.                                                                     |
| 6   | **Finish the `DomainError` migration + land `mapDomainError` in the remaining 22 files** (C2) | The ~32 classes falling through to 500 is the real payload.                                                                    |
| 7   | **Sweep raw `locals.user` guards**                                                            | Start with `reservations.remote.ts` (40). Delete the 2 `requireAdminOfBand` copies and resolve the dead `requireStaffOrOwner`. |
| 8   | **`RowCard`, `ShareButton`, `initials` → `format.ts`, `StatCard` size prop**                  | Low-risk extractions.                                                                                                          |
| 9   | **Pattern-drift sweep, per file**                                                             | Start with `page-editor`, `page-editor/epk`, `staff/settings`, `staff/events/[id]` — 4 files, ~⅓ of Tier 2.                    |
| 10  | **`RecordHero` / `PersonChip`**                                                               | Need design calls first.                                                                                                       |
| —   | **⚠️ `DateTimeRange` / `Duration`**                                                           | Blocked on the timezone decision. Do not start.                                                                                |
