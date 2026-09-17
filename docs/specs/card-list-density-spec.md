# Card lists: density and hierarchy

Status: **proposal**, for #1032 and its fourteen open children.
Designs: <https://claude.ai/artifact/A1f6cCEmSBLTb4tMLG5gaH>

The canvas holds eight artboards: the rule, the card anatomy, four surfaces drawn before and after
at the same scale, the browse grid, and the evaluation. This file is the part that belongs in the
repo — the rule itself, and what it decides.

## The problem this solves

The repo has a rigorous grammar for a table row: four slots, one fact per column, merge before you
hide, a budget of six. It has **no grammar for a card**. Fifteen pages invented one each, and they
have drifted — each drift is a separate child of #1032.

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

| Issue             | Surface             | Outcome                                                                                                                                                                            |
| ----------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #1052             | `/staff/flags`      | → table. Reason is the primary cell; the flagged record is a chip column. Repeat flaggers surface in the sort.                                                                     |
| #1042             | `/member/equipment` | → table. Seven facts become four: category and daily rate merge into the subline, condition-at-checkout moves to the detail page, status becomes the dot plus a relative due date. |
| #1054             | `/staff/volunteer`  | → one queue + three counts. Seven regions render one row shape in four card variants and three flex lists; they are all "something needs me", so the useful sort is urgency.       |
| #1044             | Open shifts         | **keeps cards** (clause 4). Grouped by day, so the date is said once as a heading; start time becomes the leading column.                                                          |
| #1035 #1036 #1047 | Browse grids        | **keep cards** (clause 2). Fixed tile shape with a monogram plate when there is no artwork; columns counted off the container, thresholds re-picked rather than translated.        |

The remaining children are applications of the same four findings: #1043 and #1049 are the
primary-cell rule; #1045 and #1047 the fixed-shape rule; #1048 and #1050 the volunteer desk's
finding elsewhere; #1046 is one-fact-one-place; #1053 is the shifts board's grouping.

## Where this loses

Recorded because it is the part worth arguing with.

- **Tables are worse on a phone.** The fold is the whole answer and the least proven part of it. A
  three-fact budget folded is an assertion until it is measured at 390px.
- **Relative time needs a clock.** "in 2 days" is friendlier and less precise — right for a queue
  worked today, wrong for anything archival.
- **The monogram plate is a guess.** It keeps the row level; a wall of monograms on a thin week may
  read worse than a wall of small cards.
- **One queue hides workload shape.** Merging the volunteer regions costs "lots of hours, no
  claims" at a glance. The three counts are meant to buy that back and may not.

## Not in this proposal

The art-directed browse surfaces are exempt from the panel rules by
`ui-patterns.md:508`, and that exemption is respected: clause 2 is how it is stated, not a
change to it. Nothing here converts a `PosterCard`, a `VinylCard` or an `IdCard` to a row.
