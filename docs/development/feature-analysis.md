# Working out what to build

The [feature checklist](conventions.md#the-feature-checklist) starts at Design and says the
deliverable is a spec. This is how you get to a spec worth building from — the pass that happens
before it, and the one that decides whether the next month is spent on the right thing.

It is not a process to follow in order. It is a set of moves that repeatedly turned out to matter,
each with the case that earned it.

## Verify the premise before designing anything

Roughly **one backlog issue in six is stale or wrong**. Check the claim against `main` before
designing a response to it, and treat dissolving one with evidence as a real outcome.

**#575** was closed as "already built" because `/local-resources` exists. The route is a marketing
page whose only heading is "Suggest a Resource"; there is no table, no listing, no curation. Two
open issues had been resting on that directory for months.

The same move works on your own claims. Half an hour after asserting that a band cannot see its own
deal, a search turned up `listBandSlotTerms` rendering it in words on the band's own page. **Grep
for the DTO, not just the column names.**

## Describe the workflow before reading the code — and keep the layers apart

Write how the thing _should_ work as a sequence of **handoffs**: who hands what to whom, and what
each one gates. Only then annotate with what the code does about each link.

Keep those two layers visibly separate. A document whose headings are the ideal and whose bodies are
the implementation reads, to anyone but its author, as a description of what exists.

Reading the production pipeline this way rather than by console tab produced the finding the tab
order hid: **six of nine links wait on someone outside staff**, and only one of those handoffs
works.

## Look for one mechanism behind several features

When three issues describe the same shape, the shape is the feature.

Tech riders, EPKs and commissioned poster art were three unrelated-looking gaps. They are one:
_ask an outside party for an artifact, against a date, and know whether it arrived._ Build it once
and three waits become trackable; build the poster alone and the chasing stays in someone's inbox.

A tell: **issues that reference nothing.** Four poster issues cross-referenced neither each other
nor anything else, which is what an unowned stage looks like in a tracker.

## Date the drift

`git log` and `migrations/` turn a design argument into a timeline, and the timeline usually changes
the fix.

`bookerType: 'event_listing'` looked like a modelling mistake worth restructuring around. The
migrations put `ALTER TABLE 'event' RENAME TO 'event_listing'` **one hour before**
`CREATE TABLE production`. It was four days of drift from a mechanical rename, not a decision — so
the fix is re-pointing one enum value, not redesigning three tables.

## Let the codebase refute you

Three successive restructurings of the listing/reservation/production relationship each died to a
different case **already in the seed**: community gigs, group sessions holding the room with no
production, and a CMC show off-site with no room held at all. `scripts/seed/` is where the edge
cases live, and its comments say why they are there.

If a proposal survives the seed, it is probably right. If you cannot find the case that would kill
it, you have not looked at the seed.

## Read doc comments as statements of intent

This codebase explains itself, and much of what it says is now false. Half of one session's findings
came from comments describing intent the code had drifted from:

| Comment                                                             | What it turned out to mean                        |
| ------------------------------------------------------------------- | ------------------------------------------------- |
| _"Basis points of the acts' pool. 7000 is the house's opening 70%"_ | Two readings, differing by the whole of CMC's cut |
| _"the room is held for the session"_                                | An advertisement books rooms                      |
| _"Cache locally — best-effort; Stripe is the source of truth"_      | No card revenue in the cache at all               |
| _"do not 'finish' the button set"_                                  | Two statuses nothing could reach                  |

A comment that argues for a rule is also the best evidence that the rule was once true.

## Compute, do not reason, about money

Run the real function on real inputs. Reasoning about a split gets the shape right and the numbers
wrong, and the numbers are what an act is paid.

Calling `computeTicketSplit` directly showed acts receiving **$6.59 on a $10 ticket instead of
$7.00** — they had been quietly funding 70% of the card fee on every sale. No amount of reading the
code produced that; one call did.

## A spec says what gets built

The output of all this is a spec, and a spec is a build document. Rejected alternatives, the
arguments that settled them, and the evidence that dissolved a premise all belong in git history,
issue comments, or a `reports/` note — not in the thing someone reads to know what to write.

The test: **can a reader tell what to build from it?** A spec that opens with what it is _not_
relitigating has the emphasis backwards. Rules are stated as rules, with a clause of _why_ only
where a reader would otherwise undo them.

## File what you find, and keep filing

A problem found while doing something else is [filed, not
fixed](conventions.md) — but the analysis matters as much as the discipline. A pass over one feature
routinely finds four things wrong with its neighbours, and those findings are worth more than the
feature if they are written down while the context is still in your head.

Several findings each get [a parent issue and one sub-issue apiece](conventions.md), not one long
body.

## What this looks like in practice

One session, working the production pipeline: 13 issues filed, 6 closed, 4 specs written or
corrected, and 3 defects found in shipped code that had been paying acts less than they were owed.
None of it came from reading the tracker top to bottom.
