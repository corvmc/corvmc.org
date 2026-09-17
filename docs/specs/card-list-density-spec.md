# Card lists: density and hierarchy

Status: **proposal**, for #1032 and its fifteen open card-list children.
Designs: <https://claude.ai/artifact/A1f6cCEmSBLTb4tMLG5gaH>

The canvas is a UX work-up, not a style proposal: thirteen artboards, each naming the primary and
secondary task for its surface before arguing a layout from them. Three set up the problem (the task
map, the five failure patterns, the rule), eight draw a surface before and after at the same scale,
one holds the card anatomy, and one evaluates the set. This file is the part that belongs in the
repo — the rule itself, and what it decides.

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
- **Two detail pages are assumed to exist** — a loan's and a suggestion's — and neither does.
  #1063 and #1064 would build them, and they are outside this set.

## Not in this proposal

The art-directed browse surfaces are exempt from the panel rules by
`ui-patterns.md:508`, and that exemption is respected: clause 2 is how it is stated, not a
change to it. Nothing here converts a `PosterCard`, a `VinylCard` or an `IdCard` to a row.
