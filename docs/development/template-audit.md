# Template audit — toward a component-based design system

The goal: **minimise raw Tailwind/daisyUI classes in route templates.** A page should read as a
composition of named components, not as a pile of utility strings that happen to look right.

Run the scoreboard any time:

```bash
node scripts/class-census.mjs
```

It counts literal `class="…"` attributes across `src/routes` and `src/lib/components`, ranks the
most-repeated class strings, and names the worst-offending files. Every phase below records its
delta against it. A dynamic `class={expr}` is deliberately invisible to the census — the point is
to remove hand-written class soup, and an expression is usually a component already doing its job.

## Baseline

Measured at `e58a707` (post-#221), excluding `*.stories.svelte` and test harnesses:

| Scope                   | files | lines  | `class="…"` | tokens    | tok/line | inline `style=` |
| ----------------------- | ----- | ------ | ----------- | --------- | -------- | --------------- |
| `src/routes/**`         | 145   | 26,783 | 3,260       | **7,705** | 0.29     | 148             |
| `src/lib/components/**` | 151   | 12,640 | 1,034       | **2,771** | 0.22     | 45              |

- **74% of all class tokens live in route templates**, not components.
- **80% of route class tokens are raw utilities**, not daisyUI component classes.
- 185 distinct multi-class strings repeat 3+ times in routes, covering 1,390 occurrences.

[#221](https://github.com/DevonCash/corvmc-svelte/pull/221) is the proof the approach works:
extracting `DefinitionList`/`Fact` erased 15 of the 19 hand-rolled
`<dl style="grid-template-columns: auto 1fr">` blocks in a single pass. It is also the **idiom this
audit follows** — a namespaced folder with an `index.ts`, semantic boolean/enum props (`mono`,
`wrap`, `size`) rather than class strings, a `class` escape hatch, a `.spec.ts` plus harness, and a
doc comment that says _why the component exists_.

## Findings

The problem is not that pages are sloppy. It is five structural gaps, each of which forces the
class soup that sits on top of it.

### 1. No variant/size prop system on `Button`

`Badge` is the only primitive with a typed variant enum. `Button` (67 importers) takes its variant
as a raw class string — `class="btn-ghost btn-sm"`, defaulting to `'btn-primary'`. All 44
`shared/actions/*Action.svelte` hardcode strings like `'btn-error btn-sm'` as their `class` default,
and `ShareButton` defaults to `'btn btn-ghost btn-sm btn-square'`.

Result: `btn-sm` ×196, `btn-ghost` ×119, `btn-primary` ×89, `btn-outline` ×37, `btn-xs` ×36,
`btn-square` ×26 — with one concept spelled four ways (`btn-primary btn-sm` ×22, `btn btn-primary
btn-sm` ×5, `btn btn-sm btn-primary` ×5, `btn-sm btn-primary` ×5). **72 raw `<button class="btn …">`
/ `<a class="btn …">` in routes bypass `Button` entirely**, plus 41 in components.

### 2. Design tokens exist and are bypassed

`src/routes/layout.css` defines `.eyebrow` — **used in 1 file** — while pages hand-roll `text-sm
font-bold uppercase tracking-wider mb-2`. It defines `.display` — **used in 0 files** — while five
pages hand-roll `text-5xl font-bold leading-tight tracking-tight text-balance`.

`--fg-2` and `--fg-3` have no Tailwind utility, so **59 inline `style="color: var(--fg-…)"`** reach
past the class system entirely, alongside `--surface`/`--surface-border` (×11).

The muted-text idiom is spelled at least six ways: `text-sm opacity-60` (63), `text-xs opacity-60`
(39), `text-sm opacity-70` (35), `truncate text-sm opacity-60` (16), `mb-3 text-sm opacity-70` (12),
`mb-3 text-sm opacity-60` (10) — plus `opacity-50` variants and 9 uses of `text-gray-400` in an
otherwise semantic-token codebase.

### 3. `FilterBar` owns layout but not controls

Every list page hand-writes its own inputs: `input input-bordered input-sm w-full` (32),
`select-bordered select-sm` (25), `input input-bordered w-full` (20), `input input-bordered
input-sm` (15), `checkbox checkbox-sm` (18), `form-control w-full` (14), `textarea
textarea-bordered w-full` (13). The documented `searchText`-not-`search` snippet-shadowing footgun
exists only because pages write the `<input>` themselves.

### 4. No general `Card`

`InfoCard` (39 importers) is hardcoded to one shape. Everything else hand-rolls: `card bg-base-100
shadow` (26) **and** `card bg-base-100 shadow-sm` (17) — the second contradicting the documented
"use `shadow` not `shadow-sm`" convention — plus `card-body` (65 raw), `card-title text-lg` (9),
`card-title text-base` (8), and six different `card-body` padding/direction spellings.

### 5. Public marketing routes have no component layer at all

`(public)/` + `band-site/` = 22 files with a _highly consistent but unnamed_ section vocabulary:
`<section class="section-tint-* py-16 px-6">` + `<div class="max-w-5xl mx-auto">` (14), `text-4xl
font-bold tracking-tight mb-3` (8), `text-center mb-12` (8), `text-5xl font-bold leading-tight
tracking-tight text-balance` (5), `max-w-2xl mx-auto flex flex-col items-center gap-4` (5). This is
a `Section`/`Hero`/`SectionHeading` set that was never written down.

## Two mechanisms, chosen per pattern

- **Semantic CSS utilities** in `layout.css` for _atomic_ swaps (muted text, brand foregrounds).
  One token replaces two or three, with no new DOM node and no import. This is what `col-support` /
  `cell-num` already are.
- **Svelte components** for anything with _structure_ (Card, Section, filter controls) and for
  anything with a _variant vocabulary_ (Button).

Deliberately **not** done: reviving a column-owning `DataTable` (deleted in `525bfff`; the rationale
in `DataList.svelte` is explicit), and wrapper components for bare flex rows — `flex items-center
gap-2` is trivial layout, and a `<Row>` component buys a DOM node and an import to delete two
tokens.

### Phase 1 notes

`text-muted` / `text-subtle` / `text-fg-2` / `text-fg-3` / `surface` live in `src/routes/layout.css`
beside the table-tier utilities. 337 `text-sm|text-xs` + `opacity-60|70` pairs collapsed to a single
token, and all 67 inline `style="color: var(--fg-…)"` / `surface` declarations became classes.

Two things were deliberately left alone:

- **31 `text-sm|text-xs opacity-50` pairs.** `opacity-50` is a third, dimmer tier that no utility
  covers yet; folding it into `text-muted` would brighten 31 places in one unreviewed pass. It wants
  its own decision about whether the muted scale has two rungs or three.
- **`text-gray-400` on the band-site EPK page.** `band-site/` is a separate theme context with its
  own token set (`src/lib/themes/band-site/index.css`) and deliberately neutral print-style greys —
  not the app palette these utilities target.

### Phase 2 notes

`Button` gained `variant` / `size` / `shape` / `outline`; `Action`, `SubmitButton` and all 44
`shared/actions/*Action.svelte` wrappers forward the same props. 268 call sites and 97 raw
`<button class="btn …">` / `<a class="btn …">` elements moved onto the component.

Twelve raw `btn` elements remain, and all of them should: five `<label class="btn">` (the `for`
attribute is the whole point — the drawer toggle, `FilterBar`'s disclosure, the file picker, two
radio labels), two `<summary class="btn">` inside `<details>`, three
`<span class="btn btn-disabled">` placeholders that are deliberately not interactive, and one
`pointer-events-none` filler. `Button` renders a `<button>` or an `<a>`; none of these is either.

`variant="default"` exists because the old component defaulted `class` to `'btn-primary'`, so any
caller-supplied `class` replaced it and produced an uncoloured button. The migration preserves that
rather than silently promoting those buttons to primary.

### Phase 3 notes

`Card` / `CardBody` / `CardTitle` under `shared/Card/`, with `InfoCard` (39 importers) rebuilt on
top of them rather than replaced. 57 card surfaces, 74 bodies and 31 titles migrated.

The `shadow` vs `shadow-sm` split — 26 against 24, with `ui-patterns.md` having always said
`shadow` — is settled inside the component, so ~24 cards gained a slightly deeper shadow. That is
the intended normalisation, not a side effect.

`CardTitle` carries `level` separately from `size` because the two were conflated: `card-title
text-lg` and `card-title text-base` were size choices, but the underlying elements were a mix of
`<h2>` and `<h3>`, which is the page outline. `level` preserves each call site's original element.

Left hand-written on purpose: clickable cards (`<a class="card">`), list cards (`<li>`), tinted
one-offs like `bg-warning/10 border-warning/40`, and `ProfileSection` — its scoped `<style>` targets
`.profile-section` on the card element, and Svelte's scoped CSS cannot reach a class passed into a
child component. svelte-check's unused-selector warning is what caught that.

### Phase 4 notes

**`input-bordered`, `select-bordered`, `textarea-bordered` and `file-input-bordered` emit no CSS at all.** They are daisyUI
4 spellings; daisyUI 5 makes the border the default and dropped the classes. Verified against the
built stylesheet — zero occurrences of any of the three — so deleting all 185 of them changed
nothing visually. Worth knowing before adding another.

`SearchInput` owns the debounce that thirteen list pages had each copied: an immediate `searchText`,
a debounced `searchQuery`, a `setTimeout` between them and a cleanup effect. It also cancels a
pending search when its value is reset from outside, which those copies each had to remember in
their own `clearFilters`.

`Select` gained `size="sm"` — the only modifier it was ever given, on every filter bar in the app.
Note that `size` is _also_ a valid attribute on a native `<select>` (visible row count), so the
migration was checked to confirm all 30 landed on the component and none on a bare element.

The `searchText`-not-`search` snippet-shadowing footgun in `ui-patterns.md` is now only relevant to
pages that still name their own state.

### Phase 5 notes

`Section`, `Hero` and `SectionHeading` under `shared/marketing/` name the shape the public pages had
already converged on without writing down: a tinted full-bleed `<section>` wrapping a centred
measure, fourteen times over. The hero markup was byte-identical on five pages, inline
`style="color: var(--cmc-navy)"` included.

`text-cmc-navy` / `text-cmc-teal` / `text-cmc-orange` join the utilities from Phase 1. The brand
palette is not in Tailwind's colour space, so an inline `style` was previously the only way to reach
it from markup — which is why there were 29 of them.

Two design-system tokens are still unused and now clearly redundant: `.display` (0 uses) overlaps
what `Hero` renders, and `.eyebrow` (1 use) overlaps the
`text-sm font-bold uppercase tracking-wider` eyebrows. Neither is a drop-in — `.display` is 3.75rem
against the hero's 3rem, and `.eyebrow` is `--color-primary` against the eyebrows' `--fg-3` — so
adopting either is a visual decision rather than a refactor, and was left alone.

### Phase 6 notes

`eslint-rules/no-utility-soup.js`, warn-level on `**/+page.svelte` only — a component library is
allowed to write the classes it exists to encapsulate. It flags five things:

- more than five utility classes on one element (97% of the tree's class attributes are five or
  fewer, so this catches a component being built inline rather than ordinary styling);
- a raw `btn` / `card` / `badge` / `alert` / `stat` / `table` class where a component owns it,
  excepting the shapes a component cannot render (`btn` on a `<label>` or `<summary>`, `card` on an
  `<a>` or `<li>`);
- the dead `*-bordered` classes;
- `text-sm|text-xs` beside `opacity-50|60|70`, which `text-muted` / `text-subtle` replace;
- an inline `style` reaching a `var(--…)` token.

147 warnings remain, and they are the backlog rather than noise: the `opacity-50` tier deferred in
Phase 1, the clickable and tinted cards deliberately left in Phase 3, and the pages that were never
in a phase — `(public)/+page.svelte` (13) and `band-site/[slug]/epk` (13), the latter being a
separate theme context.

### Two regressions the suites caught

Both were the same shape: a prop that quietly changes what an attribute means.

**Storybook.** `Button`'s `title` renders as a bits-ui tooltip, and `Tooltip.Root` _throws_ without
a `Tooltip.Provider` above it. The app has one at the root layout, so the app was fine — but
Storybook mounts components outside that layout, so every story containing a button with a tooltip
failed to render. `.storybook/preview.ts` now wraps stories in the same provider, the way it already
imports the app's stylesheet.

Worth knowing about the vitest setup: the `storybook` project reports these as **unhandled errors**,
not failed tests, so the summary line still reads `Test Files … passed`. Check the exit code, not
the summary.

### A regression the e2e suite caught

Converting a disabled `<button title="…">` to `<Button>` made the explanation unreachable.
`Button`'s `title` becomes a bits-ui tooltip, and a disabled trigger gets no hover events, so it
never opened — on the one control whose whole job was to answer "why can't I delete this?".

`Button` now falls back to a native `title` attribute whenever it is disabled. Worth knowing before
adding any other prop that quietly changes what an attribute means.

### Phase 7 notes

Four components in `shared/entity/` (`EntityChip`, `EntityIdentity`, `EntityCard`, `RelatedList`)
and one server projection (`server/entity/refs.ts`) replaced the per-page spelling of "show a
record": a `<a class="block truncate font-medium hover:underline">` over a muted `<div>`, repeated
about ninety times, each deciding its own link.

The token count understates it, because the win is not mainly tokens. `entityHref` derives one
canonical route per record _per viewer_, which closed a class of bug the census cannot see — band
links written by hand pointed at `/staff/bands/[id]` in three places and `/directory/bands/[slug]`
in three others, so a staff reader was sent to a public profile of a record whose staff page was one
click away. Three staff queries read a member's role but not their subscription, drawing sustaining
members as ordinary ones. And `staff/flags/[id]` rebuilt five routes in a nested ternary beside the
`entityHref` the server already handed it.

What the tiers deliberately do not cover: `member/events/**` and `member/directory/**` keep their
art-directed set (`PosterCard`, `VinylCard`, `IdCard`), and `member/reservations/ReservationCard`
keeps its own card — see CHORES for the divergence that leaves.

## Progress

| Phase                            | route tokens | inline `style=` | Δ                                      |
| -------------------------------- | ------------ | --------------- | -------------------------------------- |
| Baseline (`e58a707`)             | 7,705        | 148             | —                                      |
| 1 — semantic text utilities      | 7,477        | 81              | −228 tokens, −67 inline styles         |
| 2 — `Button` variant API         | 6,854        | 81              | −623 tokens; daisyUI share 1,569 → 970 |
| 3 — `Card`                       | 6,543        | 81              | −311 tokens; daisyUI share 970 → 827   |
| 4 — filter controls              | 6,324        | 81              | −219 tokens, plus 185 dead ones        |
| 5 — marketing section vocabulary | 6,193        | 52              | −131 tokens, −29 inline styles         |
| 6 — `no-utility-soup` lint rule  | 6,193        | 52              | 147 warnings left as the backlog       |
| 7 — entity presentation tiers    | 6,041        | 52              | −152 tokens; 4 tiers, 1 projection     |
