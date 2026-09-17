# Card lists: density and hierarchy

Status: **proposal**, for #1032 — its fifteen open card-list children and its three detail-tier ones — and for the staff-panel sweep in #1214.
Designs: <https://claude.ai/artifact/A1f6cCEmSBLTb4tMLG5gaH>

The canvas is a UX work-up, not a style proposal: twenty-one artboards, each naming the primary and
secondary task for its surface before arguing a layout from them. Three set up the problem (the task
map, the five failure patterns, the card rule), eight draw a list surface before and after at the
same scale, one holds the card anatomy, four cover the detail tier, four sweep the staff panel, and
one evaluates the set. This file is the part that belongs in the repo — the rules themselves, and
what they decide.

Nothing on the canvas was rendered. Every claim is argued from the source at `c5b9540`, at
plausible data; they are claims about the design, not measurements of the app.

## The problem this solves

The repo has a rigorous grammar for a table row: four slots, one fact per column, merge before you
hide, a budget of six. It has **no grammar for a card**. Fifteen pages invented one each, and they
have drifted — each drift is a separate child of #1032.

Read together, the fifteen are five failure patterns, not fifteen problems:

1. **Flat facts.** Every fact at one weight, so the one the page exists to answer is found by
   reading, not scanning. (#1042, #1043, #1049, #1061)
2. **One fact in many places.** Status as a dot _and_ a badge _and_ a sentence; a date in the
   heading and again in the row. (#1043, #1044, #1052)
3. **Shape keyed to data.** Card height tracks article count, poster presence, note length — so the
   grid goes ragged and nothing aligns between neighbours. (#1042, #1045, #1046, #1047)
4. **Split by status, not by task.** One set of records cut into two or three lists that the reader
   has to recombine. (#1048, #1050, #1053, #1054)
5. **No end and no anchor.** An unbounded list with no count, and an order nobody can predict.
   (#1044, #1053, #1058)

A surface is fixed by naming the task it serves and answering that task before the list, not by
restyling the card.

The rule that was supposed to arbitrate is `ui-patterns.md:959-961`. It cites three precedents and
[none of them satisfies it](https://github.com/corvmc/corvmc.org/issues/1034).

## The rule

> **A table, unless the row earns a card.** A row earns one by passing at least one of four tests.

1. **Unbounded prose.** The primary content has no schema cap and routinely wraps past two lines.
   _Check: grep the Zod schema for `.max(`. A cap means a table._
2. **The artwork is the content.** Somebody made an image for this record and choosing between
   records depends on seeing it. _A poster, a sleeve, a face — not an avatar beside a name._
3. **Three or more always-visible actions**, each needing a 44px target. _Count them. A conditional
   action counts as zero; a dropdown holds them._
4. **Operated standing up.** Used one-handed, away from a desk. _56px targets, one row per
   screen-third, no hover-only affordance._

**Corollary.** A card list passing none of the four is a table that lost its columns.

Clause 4 is new. It is what actually justifies the event check-in list, which the current rule
justifies by miscounting its actions.

### Re-testing the three cited precedents

| Precedent         | Cited for  | Measured                               | Verdict   |
| ----------------- | ---------- | -------------------------------------- | --------- |
| `/staff/flags`    | prose      | `FLAG_REASON_MAX = 100`; 0 row actions | **Table** |
| `/staff/closures` | 3+ actions | 2 facts, 2 conditional actions         | **Table** |
| Event check-in    | 3+ actions | 2 actions — but clause 4 holds         | **Card**  |

## The card grammar

A card is the same four slots, folded at the **container** query — the tier the tables already use,
so a list folds when the sidebar opens rather than when the window does.

| Slot        | In a card                                                                  |
| ----------- | -------------------------------------------------------------------------- |
| 0 · status  | A dot beside the title. Never a second badge.                              |
| 1 · primary | Title + subline, unchanged. Still the only two-fact slot.                  |
| 2 · facts   | A labelled strip, **label above value** — no header row to carry the name. |
| 3 · actions | Full-width, 44px. Labels return: no header row means no tooltip anchor.    |

Three rules carry over unchanged: **merge before you hide**; **another record is not a qualifier**
(it gets its own slot, as a chip); **budget** — six facts wide, **three** folded.

## What it decides, per surface

| Issue             | Surface             | Outcome                                                                                                                                                                                                                                               |
| ----------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #1052             | `/staff/flags`      | → table. Reason is the primary cell; the flagged record is a chip column. Repeat flaggers surface in the sort.                                                                                                                                        |
| #1042             | `/member/equipment` | → table. Seven facts become four: category and daily rate merge into the subline, condition-at-checkout moves to the detail page, status becomes the dot plus a relative due date.                                                                    |
| #1054             | `/staff/volunteer`  | The seven cards are **sections, not records**: the list rule governs the rows inside them, dashboard rules the cards around them. They are not merged — a coordinator does not treat "approve hours" and "nobody is on the door Saturday" as one job. |
| #1044             | Open shifts         | **keeps cards** (clause 4). Commitments move above the board; day becomes a heading so it is said once; the list ends at eight with the true count beside it.                                                                                         |
| #1035 #1036 #1047 | Browse grids        | **keep cards** (clause 2). Fixed tile shape with a monogram plate when there is no artwork; columns counted off the container, thresholds re-picked rather than translated.                                                                           |

The remaining children apply the same findings. #1043 and #1049 are the primary-cell rule. #1045
and #1047 are the fixed-shape rule: a card's height must not track its content's length. #1048 and
#1050 are pattern 4 — three lists of the same records become one list with a filter, twice. #1053
is pattern 5, and splits past from upcoming rather than paginating one stream.

**#1046 is decided here: clamp the staff response to two lines, not three.** The issue asks whether
the response should match the member's three-line clamp or take fewer. Fewer. The member wrote the
suggestion and knows what it says; the response is the news, and two lines carry whether it was a
yes. Matching at three makes the row six lines of prose with nothing distinguishing the two voices.
The response also needs to stop reading as a continuation of the body — a quote rule and a "Staff
replied" label, so the clamp reads as a boundary rather than a truncation.

## The detail rule

Every row links somewhere, so a list design is half a design. #1064 found twelve detail pages showing
**less** than the row that reaches them, and the shape is always the same: the list service computes
the presentation — a ref, a label, a flag — the detail service selects raw columns instead, and the
template hand-rolls a poorer version of what the row already had. Nothing is ever missing from the
database.

> **Never less than the row.** If a fact, a badge or an action was on the row, it is on the page.
> The row is the floor, not a preview.

1. **Share the projection by construction.** The detail query calls the same `toXRef` / label helper
   as the list query, from the same service file. Written twice is drifted once.
2. **Every action the row offered.** A page that cannot do what its row could is a dead end — the
   reader goes back and does it from the list, which is exactly #1062.
3. **Raw is never the answer.** If the row rendered "Every Tuesday", the page does not print an
   RRULE. A UUID on a page is a missing join.
4. **Same fact, same treatment.** A status that is a tinted rail on the row is not a plain sentence
   on the page. One vocabulary across both tiers, or the reader relearns it.

### #1064 re-measured

Checked against `main` on 2026-09-17: **seven of the twelve are already fixed** — five by their own
issues (#1062, #1065, #1066, #1067, #1068), plus `band/music/[releaseId]` (#1071) and
`staff/groups/[id]`, which gained its count and created date with no issue at all. Five remain:
`staff/reservations/[id]` (series glyph, teaching booker), `staff/suggestions/[id]` (author as a
bare link), `staff/events/[id]` (submitter as a hand-written link beside a band that _is_ a chip),
`staff/inventory/orders/[id]` (no `Late` treatment), `member/groups/[slug]` (role badge gated behind
`canManage`).

Each fix rediscovered the rule locally and none of them wrote it down, which is #1064's own argument
for stating it once.

### #1063 — which identity

Document what won. The documented detail tier is `EntityIdentity size="lg"` + `RelatedList`, and the
single `size="lg"` in the tree renders a _related_ record, so the tier has zero adopters as
documented — while the richest detail page in the repo rejected it on purpose and wrote down why.
Promote that instead: `PageHeader` with a `leading` snippet, a meta row beneath, `InfoCard`
sections, `DefinitionList`/`Fact` grids, `RelatedList` for related records. Drop the `lg` strip.

**One sentence is never a card.** A box with a border, a shadow, a title and a single paragraph
inside is chrome charging rent — it becomes a line in the fact grid or a note under the header. That
is four of #1061's five door-code branches, and it is why that page is three boxes for six facts.

### What the detail rule decides

| Issue   | Surface                        | Outcome                                                                                                                                                  |
| ------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #1061   | `member/reservations/[id]`     | `width` goes `md` → `lg`; one header with the status pill and Cancel, one fact grid, one loud door code. The four one-sentence `InfoCard`s become lines. |
| #1063   | the doc                        | Promote the `PageHeader` + `leading` pattern; drop the `lg` strip from the tier table.                                                                   |
| #1064   | five pages                     | Mechanical once the rule exists — mostly reusing a helper already in the same service file.                                                              |
| #1066 ✓ | `member/volunteer/shifts/[id]` | Already passes; reorder so the checklist leads, since that is what a volunteer opens it mid-shift to do. Check-in gets a number, not a paragraph.        |
| new     | `member/equipment/loans/[id]`  | Required by #1042 — a timeline of what happened and the derivation of the charge. Without it, moving facts off the row deletes them.                     |
| #1046   | `member/suggestions/[id]`      | Exists, 222 lines. Invert it — response first, suggestion beneath. The board's clamps are only safe because this page reads an answer properly.          |

## The staff panel, swept

All 73 `+page.svelte` under `/staff`, read structurally and measured against both rules above. Filed
as #1214 with two sub-issues; the detail-page half was already filed as #1078 and #1079.

**The panel mostly agrees with itself.** Fourteen lists render `FilterBar` + `DataList` + pager +
count and match down to the prop names; ten detail pages use `DefinitionList`/`Fact`. The work is
adoption, not invention — which is why the canvas draws each shape once rather than 73 times.

| Shape               | Count | Where it stands                                              |
| ------------------- | ----: | ------------------------------------------------------------ |
| Standard list       |    14 | The reference. `StaffList` draws it.                         |
| Bare list           |    16 | #1215 and #1216.                                             |
| Fact-grid detail    |    10 | Right shape; still owes the superset rule.                   |
| Stacked-card detail |    15 | #1078 and #1079. `StaffDetail` draws the fix.                |
| Console             |     4 | New rule below. `StaffConsole` draws it.                     |
| Dashboard           |     4 | `StatCard` surfaces, exempt by `ui-patterns.md`. Left alone. |
| Form / wizard       |    10 | Out of scope — a form is not a record list.                  |

### The clamp that disables the tier system (#1216)

The column tiers are container queries on `PageContent`'s `@container`: `col-support` hides below
**32rem**, `col-extra` below **48rem**. `max-w-3xl` **is** 48rem — so a `width="3xl"` list renders
its widest tier set in the narrowest container the app allows, and the tiers only ever fire on a
phone. Six inventory lists do this, `inventory/acquisitions` with seven columns at 768px where the
budget is four. The fix is deleting one prop per page; the lesson is that a fixed `max-w` silently
converts a responsive system into its worst case.

### A list states its total, always (#1215)

Sixteen staff lists render every row with no count and no pager, and they do not fail the same way:
`listVenues` and `listAudiences` have no `limit` at all, while `listExternalActs` stops at
`SEARCH_LIMIT` and says nothing. Two pages that look identical behave completely differently.

> **A list states its true total, always. It paginates when that total can exceed one screen.**

Under that rule `locations`, `venues`, `committees` and probably `duty-lists` need a count only; the
rest need both.

## The console rule

Four staff pages are neither a list nor a detail page: `events/[id]/production` (1,461 lines, nine
`InfoCard`s), `settings` (1,037, eleven), `volunteer/setup` (415) and `volunteer/shifts/[id]` (503).
Treating a console as a long detail page is what produced #1068 — it could not tell you when the
show was without entering edit mode.

> **State first, then the work.** A console opens with what is done and what is not.

1. **Reading never requires editing.** Every fact a section owns is legible without opening its
   form. That is #1068 as a rule instead of a fix.
2. **A section states its own state** — done, empty or blocked — in its heading, so the page can be
   scanned without being read. Nine equal boxes cannot be scanned.
3. **Order by the work, not the schema.** An empty section that is not due yet sits below one that
   is.
4. **The rows inside obey the list rule.** A console's lineup, shift board and ticket table are
   lists; the container exempts nothing. Same finding as the volunteer desk in #1054.

Nothing is filed for this — it is a proposal, not a defect.

## Eight shapes, and the fold

Every non-public page in the app is one of eight shapes. The canvas draws each one three times —
once as a member surface, once as a band surface, once as a staff surface — so that "one shape"
is a claim with evidence rather than an assertion.

| Shape             | What it is                                             | Member          | Band           | Staff                          |
| ----------------- | ------------------------------------------------------ | --------------- | -------------- | ------------------------------ |
| **A · List**      | Filters, a true count, column tiers, a pager           | purchases       | roster         | 1,284 members                  |
| **B · Detail**    | Header, meta row, fact grid, related sections          | an asset        | a release      | a member (the #1063 reference) |
| **C · Desk**      | Sections by job, state answered first                  | —               | band dashboard | flags queue, volunteer desk    |
| **D · Console**   | Reading never requires editing                         | —               | tech rider     | settings, roles & clearances   |
| **E · Card list** | Only where a clause earns it                           | suggestions (1) | releases (2)   | check-in (4)                   |
| **F · Dashboard** | `StatCard`s — exempt from the list rule, not hierarchy | account         | payouts        | reports                        |
| **G · Form**      | One question at a time, and what submit will do        | submit an event | edit band page | equipment intake               |
| **H · Thread**    | A list of conversations, and one conversation          | messages        | band messages  | inbox with a queue             |

Two things the catalogue settled that the per-issue boards could not:

- **The desk and the console are different shapes**, though both are "a page of sections". A desk's
  sections are _queues of other people's records_ and sort by what is asking; a console's are
  _parts of one record_ and sort by the order the work is done in.
- **A dashboard is not exempt from hierarchy**, only from the list rule. A `StatCard` is not a
  record, but the rows inside a breakdown still are.

### The fold

The claim the whole document rests on — a card is a row folded at the container query — is drawn at
390px for three of the shapes:

- **A list sheds columns by tier** and its action goes full width. Six columns become three facts
  on two lines; `Picked up` is dropped, not shrunk, because at 327px the budget is three.
- **A detail page only restacks.** It has no column pressure, so nothing is dropped — which is why
  the superset rule holds at every width.
- **A card list barely changes**, and that is the tell that the card was earned rather than
  defaulted to. When the narrow view is the wide view minus nothing, there were no columns to lose.

## Where this loses

Recorded because it is the part worth arguing with.

- **Tables are worse on a phone.** The fold is the whole answer and the least proven part of it. A
  three-fact budget folded is an assertion until it is measured at 390px.
- **Relative time needs a clock.** "in 2 days" is friendlier and less precise — right for a queue
  worked today, wrong for anything archival.
- **The monogram plate is a guess.** It keeps the row level; a wall of monograms on a thin week may
  read worse than a wall of small cards.
- **Six surfaces now open with a summary strip.** Three of those in one session is three places to
  learn to skip. If a strip is not actionable — a number you would click — it is a second header,
  and #1042's is the only one I am confident about.
- **Keeping the volunteer desk's seven sections is the weakest call on the canvas.** It leaves two
  scan models on one page: vertical across sections, horizontal within one. The test is whether a
  coordinator scrolls past four sections to reach their first action.
- **A count is a query.** Three of these lists need a `count(*)` the service does not run today. If
  it is expensive, the honest fallback is "8 of many" — a worse design than the one drawn.
- **The staff sweep is structural, not page-by-page.** Component counts, widths and query limits are
  exact; calling a page a "list" or a "console" is judgement from those signals, and a handful of
  the 73 could be argued either way.
- **One detail page has to be built, not assumed.** `/member/equipment/loans/[id]` does not exist,
  and #1042's row design moves facts onto it — a fact moved to a page that does not exist is a fact
  deleted. `/member/suggestions/[id]` **does** exist (222 lines); what #1046 needs there is an
  ordering change, response first, not a new route.

## Not in this proposal

The art-directed browse surfaces are exempt from the panel rules by
`ui-patterns.md:508`, and that exemption is respected: clause 2 is how it is stated, not a
change to it. Nothing here converts a `PosterCard`, a `VinylCard` or an `IdCard` to a row.
