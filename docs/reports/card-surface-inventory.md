# Card surfaces: what the app draws as a list of cards, and how dense it is

**Date:** 2026-09-11
**Scope:** every route whose main content is a repeated card per record — 30 surfaces, plus the
card components and grid utilities behind them.
**Method:** `src/routes/**/+page.svelte` swept for `{#each}` blocks producing card markup, plus
`src/lib/components/**/*Card.svelte`. Each surface was then read in full — page, card component,
remote function and the service behind it — against the density rulebook in
[ui-patterns.md](../development/ui-patterns.md). Static reading at `c5b9540`; no rendering and no
runtime verification. A claim here means "this is what the code does", not "this was observed in a
browser". Where a claim needed the query behind it — row caps, ordering, unbounded joins — the
service was read and the limit quoted.

The work this argues for left as [#1032](https://github.com/corvmc/corvmc.org/issues/1032) and its
26 sub-issues before this was written. This document keeps the evidence and the method; the issues
keep the things to do.

---

## What shifted during the review

The review set out to measure pages against the rulebook. It found that **the rulebook's own
citations do not hold**.

`ui-patterns.md:959-961` decides whether a list is a `Table` or a card list — the most consequential
density decision in the app:

> Give it a card list instead of a `Table` when the row's primary content is unbounded prose
> (`/staff/flags`) or the row has three or more always-visible actions. `/staff/closures` and the
> event check-in list are the card precedents.

All three named precedents were checked against the rule they are cited for:

| Precedent         | Cited for       | What it is                                                           |
| ----------------- | --------------- | -------------------------------------------------------------------- |
| `/staff/flags`    | unbounded prose | reason capped at 100 chars (`flag-service.ts:22`); **0** row actions |
| `/staff/closures` | 3+ actions      | 2 facts per row, **2** actions, both conditional on `isFuture`       |
| event check-in    | 3+ actions      | **2** actions; justified by a 44px touch target at a door (#971)     |

None demonstrates the test. Every "should this be a table?" question in the sub-issues is downstream
of settling that, which is why it is the first one.

---

## Three families, three different constraints

**1. Art-directed browse surfaces.** `PosterCard`, `VinylCard`, `IdCard`, `InstructorCard`,
`TicketStub`, and the `grid-gallery*` / `.pgrid` wrappers. `ui-patterns.md:508` exempts these from
the panel rules deliberately — "Don't 'consistency-fix' one into the other — they optimise for
different things." That exemption is respected here: these surfaces were audited on their own terms,
as browse surfaces, and several were found sound.

**2. Panel card lists.** ~15 pages that hand-roll `Card`/`CardBody` + `EntityIdentity` inline. These
are measurable against the column-slot grammar (`:1018-1053`) and the exception test.

**3. The generic record card nothing uses.** `EntityCard` is the documented card tier
(`:466-471`) and is used on exactly one route; `EntityGallery` on none.

```
$ grep -rl "EntityCard" src
src/lib/components/ui/entity/EntityCard.stories.svelte
src/lib/components/ui/entity/index.ts
src/routes/member/MatchesCard.svelte
```

The consequence is drift rather than mere duplication: the hand-rolled copies have already
diverged from each other and from the component, and three of those divergences are independent
defects on three different pages.

---

## The inventory

Audience is `P` public, `M` member, `B` band, `S` staff.

| Route                           | Page file                                     | Card                        | Aud. | Filters / paging                           | Layout                       |
| ------------------------------- | --------------------------------------------- | --------------------------- | ---- | ------------------------------------------ | ---------------------------- |
| `/` upcoming                    | `(public)/+page.svelte`                       | `PosterCard`                | P    | none (3 items)                             | `grid-cols-1 sm:2 lg:3`      |
| `/events`                       | `(public)/events/+page.svelte`                | `PosterCard` + `GigList`    | P    | `?from=`, "Show more"                      | `grid-gallery` + 2-col guide |
| `/directory`                    | `(public)/directory/+page.svelte`             | `VinylCard`, `IdCard`       | P    | name search, genre facet, client window 24 | `grid-gallery{,-tight}`      |
| `/directory/instructors`        | `(public)/directory/instructors/+page.svelte` | `InstructorCard`            | P    | name search                                | `sm:2 lg:3`                  |
| `/groups`                       | `(public)/groups/+page.svelte`                | inline `Card`               | P    | kind filter                                | `md:grid-cols-2`             |
| `/band-site/[slug]/events`      | `band-site/[slug]/events/+page.svelte`        | inline panels               | P    | none (capped 10/20)                        | `max-w-3xl` stack            |
| `/member/events`                | `member/events/+page.svelte`                  | `PosterCard`, `TicketStub`  | M    | tag chips                                  | `.pgrid` + `Carousel`        |
| `/member/directory`             | `member/directory/+page.svelte`               | `IdCard`, `VinylCard`       | M    | search, 4 toggles, instrument + genre      | `grid-gallery{,-tight}`      |
| `/member/directory/instructors` | `member/directory/instructors/+page.svelte`   | `InstructorCard`            | M    | name search                                | `sm:2 lg:3`                  |
| `/member` matches               | `member/MatchesCard.svelte`                   | **`EntityCard`**            | M    | none                                       | `sm:2 lg:3`                  |
| `/member` events                | `member/+page.svelte`                         | inline tile                 | M    | none (4 items)                             | `sm:2 lg:4`                  |
| `/member/bands`                 | `member/bands/+page.svelte`                   | inline `Card`               | M    | none                                       | `space-y-3`, `2xl`           |
| `/member/groups`                | `member/groups/+page.svelte`                  | inline `Card`               | M    | sectioned by state                         | `space-y-3`, `3xl`           |
| `/member/reservations`          | `member/reservations/+page.svelte`            | `ReservationCardShell`      | M    | Active/All tabs, client window             | 1 / `@lg` 2 / `@3xl` 3       |
| `/member/equipment`             | `member/equipment/+page.svelte`               | inline `Card`               | M    | search + category, grouped                 | `sm:2 lg:3`                  |
| `/member/equipment/loans`       | `member/equipment/loans/+page.svelte`         | inline `Card`               | M    | Current/Past tabs                          | single column                |
| `/member/suggestions`           | `member/suggestions/SuggestionCard.svelte`    | `SuggestionCard`            | M    | `FilterBar` + `DataList`                   | `ul.space-y-2`               |
| `/member/help`                  | `member/help/+page.svelte`                    | inline `Card`               | M    | typeahead                                  | `sm:grid-cols-2`, `2xl`      |
| `/member/volunteer`             | `member/volunteer/+page.svelte`               | `MyShiftCard`, `OpenShifts` | M    | none                                       | `lg:grid-cols-2`, `5xl`      |
| `/band/[slug]`                  | `band/[slug]/+page.svelte`                    | `BandReservationCard`       | B    | none                                       | stack + stat row             |
| `/band/[slug]/reservations`     | `band/[slug]/reservations/+page.svelte`       | `BandReservationCard`       | B    | Upcoming/Past tabs                         | stack, `2xl`                 |
| `/band/[slug]/events`           | `band/[slug]/events/+page.svelte`             | inline `Card` ×3            | B    | sectioned                                  | `space-y-3`                  |
| `/band/[slug]/music`            | `band/[slug]/music/ReleaseCard.svelte`        | `ReleaseCard`               | B    | none                                       | `space-y-3`, `2xl`           |
| `/band/[slug]/members`          | `band/[slug]/members/+page.svelte`            | inline `Card` ×3            | B    | sectioned                                  | `grid-cols-1 gap-2`          |
| `/band/[slug]/packing`          | `band/[slug]/packing/PackingCrate.svelte`     | `PackingCrate`              | B    | none                                       | stack + stat row             |
| `/staff/flags`                  | `staff/flags/+page.svelte`                    | inline `li.card`            | S    | `FilterBar` + `DataList`                   | `ul.space-y-2`               |
| `/staff/closures`               | `staff/closures/+page.svelte`                 | inline `Card`               | S    | none                                       | `space-y-3`                  |
| `/staff/volunteer`              | `staff/volunteer/+page.svelte`                | 7 queue cards               | S    | none                                       | stack, `5xl`                 |

### Grid utilities

Defined in `src/routes/layout.css`, all three sizing off the **viewport** while every table in the
app sizes off its **container**:

| Utility              | Columns                                                | Gap     | Where        |
| -------------------- | ------------------------------------------------------ | ------- | ------------ |
| `grid-gallery`       | 1 / 2 @40rem / 3 @64rem                                | 24px    | `:349-366`   |
| `grid-gallery-tight` | 2 / 3 @40rem / 4 @64rem                                | 24px    | `:368-385`   |
| `.pgrid`             | `auto-fill minmax(180px, 1fr)`, forced to 1 col ≤640px | 38/20px | `:1019-1029` |

The comment above the first two (`:343-348`) already makes the argument against the mechanism it
uses: "how many fit per row … is a property of the card, not of the page". That is the definition of
a container query, and `PageContent` is already an `@container` — which is how the `col-support` /
`col-extra` tiers work (`:544-550`).

---

## Examined and found sound

Recorded so the absence reads as a decision rather than an oversight.

- **`/member/suggestions`** — the rulebook-compliant example. `FilterBar` + `SearchInput` + `Select`
  - `DataList` with `onpage`, `space-y-2` rows, and it passes the card-list exception honestly:
    `suggestion.body` is unbounded prose, clamped at `SuggestionCard:81` because it is. The one
    finding against it is that the staff _response_ beside it is not clamped.
- **`MatchesCard`** — the reference implementation for `EntityCard` + `BadgeList max={3}`.
- **`/band/[slug]/packing`** — the crate body is an editable form, not a record's facts, so no table
  could hold it. Only nit is a stat that renders `itemCount` twice (`+page.svelte:115-116`).
- **`/groups`** — two columns at a dozen records is right, and the page's docstring (`:12-23`) says
  why.
- **The homepage's three-poster teaser** — a teaser linking to `/events`, not a browse grid.
- **`/events`' poster hero over `GigList`** — this pairing is the model the other browse surfaces
  are measured against.
- **`/member/directory`'s filter panel** — server-side filters with instrument and genre facets;
  it is what the public directory lacks.
- **The four `Table`-based cards on `/staff/volunteer`** — well-built; the finding is about the
  three beside them that are not.
- **`InstructorCard`'s free-text `ratesNote`** — deliberate and documented at `:106-107`. CMC does
  not process lesson money; this is not a price column waiting to happen.

## Not card lists

- **Row lists:** `/member/messages`, `/band/[slug]/messages`, `/staff/inbox`, `/member/purchases`,
  and the `/events` gig guide.
- **Marketing tile grids with no records behind them:** `/programs`, `/membership`, `/contribute`,
  `/local-resources`, `/contact`.
- **`StatCard` dashboards:** `/staff`, `/staff/music`, `/staff/volunteer/report`,
  `/staff/inventory/spend`.
- **Single cards containing row lists:** `/radio`, `/band-site/[slug]/epk`.
- **Every other `/staff/*` index**, which already uses `Table` + `FilterBar` + `DataList`.

## What this pass did not do

No rendering. The density figures in the sub-issues are computed from grid definitions and card
heights, not measured in a browser, and two claims are flagged in their issues as needing a visual
check before being treated as confirmed — `IdCard`'s aspect-ratio overflow above all.

No sorting was proposed anywhere. `ui-patterns.md` rules it out on purpose, and
[#904](https://github.com/corvmc/corvmc.org/issues/904) — which overlaps this pass on
`/member/reservations` — is linked rather than restated.
