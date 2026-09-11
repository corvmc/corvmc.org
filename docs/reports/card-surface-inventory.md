# Card surfaces: how many boxes the app draws, and for how many facts

**Date:** 2026-09-11
**Scope:** every route whose body is built out of cards — 31 that render a **list** of them, one card
per record, and 28 that render a **stack** of them around a single record. 59 surfaces, plus the
card components and grid utilities behind them.
**Method:** two sweeps of `src/routes`. The first matched `{#each}` blocks producing card markup,
plus `src/lib/components/**/*Card.svelte`. The second counted `Card`/`InfoCard` blocks per route
**including its route-local components**, which is what finds the pages that delegate their cards to
children — `staff/users/[id]` renders none in its own `+page.svelte` and thirty across `panels/`.
Every surface was then read in full — page, card component, remote function, and the service behind
it — against the rulebook in [ui-patterns.md](../development/ui-patterns.md). Static reading at
`c5b9540`; no rendering and no runtime verification. A claim here means "this is what the code
does", not "this was observed in a browser". Where a claim needed the query behind it — row caps,
ordering, unbounded joins, a missing projection — the service was read and the line quoted.

The work this argues for left as [#1032](https://github.com/corvmc/corvmc.org/issues/1032) and its
46 sub-issues before this was published, per [the rule for this
directory](README.md). This document keeps the evidence and the method; the issues keep the things
to do.

---

## One question, asked of every surface

**How many boxes, for how many facts?**

A card is a border, a shadow, a title and two lots of padding. It earns those when it groups facts
that belong together and separates them from facts that do not. It does not earn them around a
single sentence, or around five values already rendered a hundred pixels to the left.

That question turns out to have two different answers depending on which kind of card surface you
ask it of, and a third finding cuts across both.

## Finding 1 — the rule that decides card-vs-table cites three precedents, and none of them satisfies it

`ui-patterns.md:959-961` is the most consequential density decision in the app:

> Give it a card list instead of a `Table` when the row's primary content is unbounded prose
> (`/staff/flags`) or the row has three or more always-visible actions. `/staff/closures` and the
> event check-in list are the card precedents.

All three named precedents were checked against the rule they are cited for:

| Precedent         | Cited for       | What it is                                                                                                             |
| ----------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `/staff/flags`    | unbounded prose | reason capped at 100 chars (`flag-service.ts:22`, enforced in both Zod schemas and a `.slice()`); **zero** row actions |
| `/staff/closures` | 3+ actions      | two facts per row, **two** actions, both conditional on `isFuture`                                                     |
| event check-in    | 3+ actions      | **two** actions; the real justification is a 44px touch target at a door (#971)                                        |

Three pages failing a rule would be a finding about those pages. The three _precedents_ failing it is
a finding about the rule, and every per-page "should this be a table" question is downstream of
settling it ([#1034](https://github.com/corvmc/corvmc.org/issues/1034)).

The check-in page is the interesting one: its comment at `:67-68` gives a genuine reason cards beat a
table there — _"44px on purpose: tapped a hundred times in a row at a door, one-handed"_ — and that
reason is not in the rule. The rule may be under-specified rather than the pages wrong.

## Finding 2 — a record's own page routinely shows less than the row you clicked to reach it

This is the strongest result of the pass, and it was invisible from either page alone. Reading each
detail page beside its list row showed the same defect twelve times:

| Detail page                          | The row shows                                 | The page shows                        |
| ------------------------------------ | --------------------------------------------- | ------------------------------------- |
| `staff/recurring/[id]`               | "Every Tuesday", booker as `EntityChip`       | `FREQ=WEEKLY;BYDAY=TU`, `user: 9f3c…` |
| `member/volunteer/shifts/[signupId]` | status rail, **Drop out**, **How did it go?** | none of the three                     |
| `staff/volunteer/duty-lists/[id]`    | `StatusBadge`, description                    | neither, anywhere                     |
| `staff/events/[id]/production`       | the event's time range                        | the date only inside the edit form    |
| `staff/reservations/[id]`            | recurring glyph, teaching booker              | neither                               |
| `member/reservations/[id]`           | Cancel, Pay-when-confirmed                    | neither                               |
| `band/music/[releaseId]`             | cover, sales, price, date                     | a plain member sees none              |
| `staff/suggestions/[id]`             | author as `EntityChip`                        | author as a bare `<a>`                |
| `staff/events/[id]`                  | submitter as `EntityChip`                     | a hand-written link                   |
| `staff/inventory/orders/[id]`        | `Late` badge                                  | no late treatment                     |
| `staff/groups/[id]`                  | member count, created date                    | neither                               |
| `member/groups/[slug]`               | your role badge                               | gated behind `canManage`              |

The mechanism is consistent: **the list service computes the presentation and the detail service does
not.** `recurring-series-service.ts` is the clearest case — `listAll` maps `booker: toBookerRef(…)`
and `frequencyLabel: describeFrequency(r.rrule)` at `:468-469`; `get()` at `:251-277` selects
neither, from the same file. Nothing is missing from the database. The projection was written once
and not carried across ([#1064](https://github.com/corvmc/corvmc.org/issues/1064)).

## Finding 3 — the entity set is adopted at the tiers that feed tables, and not at the tiers that feed cards

`ui-patterns.md:466-471` documents four ways to show one record. Measured across `src/routes`:

| Tier   | Component                    | Routes |
| ------ | ---------------------------- | ------ |
| chip   | `EntityChip`                 | 14     |
| row    | `EntityIdentity` (`sm`/`md`) | 40     |
| card   | `EntityCard`                 | **1**  |
| detail | `EntityIdentity size="lg"`   | **1**  |

**These two ones mean different things, and conflating them would be the easy mistake.**

`EntityCard` simply never got adopted. ~15 pages hand-roll a record card instead, and the copies have
drifted into three independent defects — a conditional poster that ruins a grid
(`member/+page.svelte:167-191`), a hand-written identity that has diverged from the one two sections
above it (`band/[slug]/members/+page.svelte:260-265`), and a title fallback re-implemented in
different words from the one the query already returned
(`member/equipment/loans/+page.svelte:50,130`). That is a real gap
([#1035](https://github.com/corvmc/corvmc.org/issues/1035)).

`EntityIdentity size="lg"` is the opposite. Its single use
(`staff/reservations/[id]/+page.svelte:226`) renders the _member_, not the reservation — so the
detail tier has zero adopters as the thing the doc describes. But the richest detail page in the repo
**rejected it deliberately and wrote down why**:

> One identity block, not two. The avatar rides in the header rather than in a strip below it,
> because the strip's only reason to restate the name was to have something to put beside the
> picture.
> — `staff/users/[id]/+page.svelte:121-124`

That page uses `PageHeader` with the only `{#snippet leading()}` in `src/routes`, and it is where
`RelatedList` came from — the component's docstring says it was "promoted from
`staff/users/[id]/panels/AsyncCard.svelte`". The documented `lg` strip lost an argument and stayed in
the table. Filing "adopt `size='lg'`" against 28 detail pages would propagate a pattern the one page
that thought hardest about it discarded on purpose
([#1063](https://github.com/corvmc/corvmc.org/issues/1063)).

---

## The card-list surfaces

Three families, bound by three different constraints.

**Art-directed browse.** `PosterCard`, `VinylCard`, `IdCard`, `InstructorCard`, `TicketStub`, and the
`grid-gallery*` / `.pgrid` wrappers. `ui-patterns.md:508` exempts these from the panel rules on
purpose — "Don't 'consistency-fix' one into the other — they optimise for different things" — so they
were audited on their own terms, as browse surfaces, and several were found sound.

**Panel card lists.** ~15 pages hand-rolling `Card`/`CardBody` + `EntityIdentity`, measurable against
the column-slot grammar (`:1018-1053`) and the exception test above.

**The generic record card nothing uses**, per Finding 3.

Audience is `P` public, `M` member, `B` band, `S` staff.

| Route                           | Page file                                     | Card                        | Aud. | Filters / paging                      | Layout                       |
| ------------------------------- | --------------------------------------------- | --------------------------- | ---- | ------------------------------------- | ---------------------------- |
| `/` upcoming                    | `(public)/+page.svelte`                       | `PosterCard`                | P    | none (3 items)                        | `grid-cols-1 sm:2 lg:3`      |
| `/events`                       | `(public)/events/+page.svelte`                | `PosterCard` + `GigList`    | P    | `?from=`, "Show more"                 | `grid-gallery` + 2-col guide |
| `/directory`                    | `(public)/directory/+page.svelte`             | `VinylCard`, `IdCard`       | P    | name search, genre facet, window 24   | `grid-gallery{,-tight}`      |
| `/directory/instructors`        | `(public)/directory/instructors/+page.svelte` | `InstructorCard`            | P    | name search                           | `sm:2 lg:3`                  |
| `/groups`                       | `(public)/groups/+page.svelte`                | inline `Card`               | P    | kind filter                           | `md:grid-cols-2`             |
| `/band-site/[slug]/events`      | `band-site/[slug]/events/+page.svelte`        | inline panels               | P    | none (capped 10/20)                   | `max-w-3xl` stack            |
| `/member/events`                | `member/events/+page.svelte`                  | `PosterCard`, `TicketStub`  | M    | tag chips                             | `.pgrid` + `Carousel`        |
| `/member/directory`             | `member/directory/+page.svelte`               | `IdCard`, `VinylCard`       | M    | search, 4 toggles, instrument + genre | `grid-gallery{,-tight}`      |
| `/member/directory/instructors` | `member/directory/instructors/+page.svelte`   | `InstructorCard`            | M    | name search                           | `sm:2 lg:3`                  |
| `/member` matches               | `member/MatchesCard.svelte`                   | **`EntityCard`**            | M    | none                                  | `sm:2 lg:3`                  |
| `/member` events                | `member/+page.svelte`                         | inline tile                 | M    | none (4 items)                        | `sm:2 lg:4`                  |
| `/member/bands`                 | `member/bands/+page.svelte`                   | inline `Card`               | M    | none                                  | `space-y-3`, `2xl`           |
| `/member/groups`                | `member/groups/+page.svelte`                  | inline `Card`               | M    | sectioned by state                    | `space-y-3`, `3xl`           |
| `/member/reservations`          | `member/reservations/+page.svelte`            | `ReservationCardShell`      | M    | Active/All tabs, window               | 1 / `@lg` 2 / `@3xl` 3       |
| `/member/equipment`             | `member/equipment/+page.svelte`               | inline `Card`               | M    | search + category, grouped            | `sm:2 lg:3`                  |
| `/member/equipment/loans`       | `member/equipment/loans/+page.svelte`         | inline `Card`               | M    | Current/Past tabs                     | single column                |
| `/member/suggestions`           | `member/suggestions/SuggestionCard.svelte`    | `SuggestionCard`            | M    | `FilterBar` + `DataList`              | `ul.space-y-2`               |
| `/member/help`                  | `member/help/+page.svelte`                    | inline `Card`               | M    | typeahead                             | `sm:grid-cols-2`, `2xl`      |
| `/member/volunteer`             | `member/volunteer/+page.svelte`               | `MyShiftCard`, `OpenShifts` | M    | none                                  | `lg:grid-cols-2`, `5xl`      |
| `/band/[slug]`                  | `band/[slug]/+page.svelte`                    | `BandReservationCard`       | B    | none                                  | stack + stat row             |
| `/band/[slug]/reservations`     | `band/[slug]/reservations/+page.svelte`       | `BandReservationCard`       | B    | Upcoming/Past tabs                    | stack, `2xl`                 |
| `/band/[slug]/events`           | `band/[slug]/events/+page.svelte`             | inline `Card` ×3            | B    | sectioned                             | `space-y-3`                  |
| `/band/[slug]/music`            | `band/[slug]/music/ReleaseCard.svelte`        | `ReleaseCard`               | B    | none                                  | `space-y-3`, `2xl`           |
| `/band/[slug]/members`          | `band/[slug]/members/+page.svelte`            | inline `Card` ×3            | B    | sectioned                             | `grid-cols-1 gap-2`          |
| `/band/[slug]/packing`          | `band/[slug]/packing/PackingCrate.svelte`     | `PackingCrate`              | B    | none                                  | stack + stat row             |
| `/staff/flags`                  | `staff/flags/+page.svelte`                    | inline `li.card`            | S    | `FilterBar` + `DataList`              | `ul.space-y-2`               |
| `/staff/closures`               | `staff/closures/+page.svelte`                 | inline `Card`               | S    | none                                  | `space-y-3`                  |
| `/staff/volunteer`              | `staff/volunteer/+page.svelte`                | 7 queue cards               | S    | none                                  | stack, `5xl`                 |

### Grid utilities

Defined in `src/routes/layout.css`, all three sizing off the **viewport** while every table in the app
sizes off its **container**:

| Utility              | Columns                                                | Gap     | Where        |
| -------------------- | ------------------------------------------------------ | ------- | ------------ |
| `grid-gallery`       | 1 / 2 @40rem / 3 @64rem                                | 24px    | `:349-366`   |
| `grid-gallery-tight` | 2 / 3 @40rem / 4 @64rem                                | 24px    | `:368-385`   |
| `.pgrid`             | `auto-fill minmax(180px, 1fr)`, forced to 1 col ≤640px | 38/20px | `:1019-1029` |

The comment above the first two (`:343-348`) already makes the argument against the mechanism it
uses: "how many fit per row … is a property of the card, not of the page". That is the definition of a
container query, and `PageContent` is already an `@container` — which is how `col-support` /
`col-extra` work (`:544-550`). ([#1036](https://github.com/corvmc/corvmc.org/issues/1036))

---

## The card-stack surfaces

A page presenting one record as stacked card sections. 28 of them, found by the second sweep. The
density question is the same one, asked per box rather than per row.

The shapes that recur:

**Cards that are chrome around one sentence.** `staff/inventory/orders/[id]:142` — an entire titled
card whose body is "This order is closed." `staff/inventory/loans/[id]:237-239` — "No actions
available", which is the state most historical loans are in. `member/reservations/[id]` — four of
five door-code branches. `staff/groups/[id]:117-129` — one link.
`staff/marketing/audiences/[id]:118-120` — one button.

**Cards that repeat what is already on screen.** `staff/inventory/acquisitions/[id]:224-241` renders
five `Fact`s, all five duplicated from the edit form beside it or the table below — and reads
`donorName` where the form edits `sourceName`, so one row presents two different fields as the same
thing.

**Hand-rolled primitives, sometimes beside correct uses of the same primitive.** The
`<dl style="grid-template-columns: auto 1fr">` that `DefinitionList` was built to replace
(`ui-patterns.md:846`) survives in `staff/suggestions/[id]:123`, `staff/flags/[id]:96` — the latter
beside two cards on the same page using `DefinitionList` properly — and
`band/[slug]/rider:281-294`. 47 of the 59 multi-card routes use no `DefinitionList` at all, against a
component whose own docstring calls itself "the label/value grid that **every** staff detail page
uses".

**Form width on a record page.** `member/reservations/[id]` and `band/[slug]/reservations/[id]` both
use `PageContent width="md"` — 448px, the login-form width — to hold a two-column payment grid and a
`text-4xl tracking-[0.3em]` door code.

### The model

`staff/users/[id]` is the reference implementation and should be read before any of this is acted on:
35 `Fact`s, 6 `DefinitionList`s, 22 `RelatedList`s, 8 `InfoCard`s, zero raw `Card`s across 13 files.
**Not one box on it has a single sentence for a body** — every one is a label/value grid or a list of
records. Eight tabs, each a panel owning its own queries, with one page-level query documented at
`:25-29` as paying for both the member and every tab badge.

It is also the page that argues with the doc and wins, twice: the `leading`-snippet identity above,
and a deleted twelve-tile grid recorded at `OverviewPanel.svelte:126-136` — _"It was a table of
contents for a tab bar sitting one row above it, and every tile restated a number the destination tab
shows in full."_ That sentence is the whole report in miniature.

`staff/flags/[id]` and `staff/bands/[id]` are the next best, both using `DefinitionList` correctly and
both strict supersets of their list rows.

---

## Examined and found sound

Recorded so the absence reads as a decision rather than an oversight.

- **`/member/suggestions`** — the rulebook-compliant card list. `FilterBar` + `DataList` with
  `onpage`, and it passes the exception test honestly: the body is unbounded prose, clamped at
  `SuggestionCard:81` because it is. Its one finding is that the staff _response_ beside it is not.
- **`MatchesCard`** — correct `EntityCard` + `BadgeList max={3}`.
- **`staff/users/[id]`, `staff/flags/[id]`, `staff/bands/[id]`, `staff/inventory/[id]`,
  `staff/volunteer/roles/[id]`** — detail pages using the documented primitives about as well as the
  codebase does.
- **`member/suggestions/[id]`, `member/account`, `band/[slug]/music/payouts`, `act/[token]`** — sound
  stacks; the last is deliberately outside the panel frame and says so at `:13-24`.
- **`/band/[slug]/packing`** — the crate body is an editable form, so no table could hold it.
- **`/groups`, the homepage teaser, `/events`' poster-over-`GigList` pairing** (the model the other
  browse surfaces are measured against), and **`/member/directory`'s filter panel**.
- **The four `Table`-based cards on `/staff/volunteer`** — the finding is about the three beside them
  that are not.
- **`InstructorCard`'s free-text `ratesNote`** — deliberate and documented at `:106-107`. CMC does not
  process lesson money; this is not a price column waiting to happen.
- **`staff/settings`'s card count** — 11 blocks across 7 tabs, three inside `{#each}` loops, at most
  ~4 on screen. A settings page behaving like one. (Its Save buttons are a separate finding.)
- **`staff/inbox/daily`** — three card states, strictly mutually exclusive, documented at `:4-14` as
  one activity. Exactly one card is ever on screen.

## Not card surfaces

- **Row lists**: `/member/messages`, `/band/[slug]/messages`, `/staff/inbox`, `/member/purchases`, and
  the `/events` gig guide.
- **Forms and wizards**, which use `FormField` and correctly have no fact grid: `member/profile`,
  `band/[slug]/press-kit`, `band/[slug]/edit`, `band/[slug]/settings`, `member/groups/[slug]/edit`,
  the ticket checkout, `member/reservations/[id]/pay`, `staff/inventory/intake`,
  `staff/volunteer/setup`.
- **Table indexes**: `staff/productions`, `staff/instructors`, and every other `/staff/*` index, which
  already use `Table` + `FilterBar` + `DataList`.
- **`StatCard` dashboards**: `/staff`, `/staff/music`, `/staff/volunteer/report`,
  `/staff/inventory/spend`.
- **Marketing tile grids with no records behind them**: `/programs`, `/membership`, `/contribute`,
  `/local-resources`, `/contact`.
- **Single cards containing row lists**: `/radio`, `/band-site/[slug]/epk`.
- **`(public)/music/[bandSlug]/[releaseSlug]`** — art-directed public page, excluded by
  `ui-patterns.md:508`. Only 1 of 25 public pages imports `PageContent` at all; that is the documented
  split, not drift.

## What this pass did not do

No rendering. Density figures are computed from grid definitions and card heights, not measured in a
browser, and two claims are flagged in their own issues as needing a visual check before being treated
as confirmed — `IdCard`'s aspect-ratio overflow above all.

No sorting was proposed anywhere; `ui-patterns.md` rules it out on purpose, and
[#904](https://github.com/corvmc/corvmc.org/issues/904) — which overlaps this pass on
`/member/reservations` — is linked rather than restated.

Five findings in the list sweep and fourteen in the stack sweep turned out to be correctness bugs
rather than density, and are filed as Bugs. The sharpest are a band site pricing an
externally-ticketed show by omission (which reads as free), two marketing pages rendering a blank
document for a missing record, and a release cover slot with three readers, one deleter and no writer
anywhere in the app.
