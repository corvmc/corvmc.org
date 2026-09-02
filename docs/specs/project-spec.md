# Projects

## Purpose

Work that spans more than one work order has no container. A facility improvement —
repaint the live room, rewire the panel — is a body of work with a budget, an owner
and a dozen work orders, and there is nowhere to say so. The gap is already named in
the schema, in `contractor_job.assetId`:

> Null is building work: an electrician has no asset, and pretending otherwise would
> mean inventing an inventory row for the breaker panel.

Building work today is a set of orphan rows with nothing tying them together. Nothing
fills this: the only occurrences of `project` across `src/lib/server/db/schema/` and
`src/lib/config.ts` are two unrelated comments, and there is no `budget` column or
grouping of any kind.

The reasoning behind every decision here — and the prior art it came from — is
[project-management-prior-art.md](../reports/project-management-prior-art.md). This
document states the design; that one says why.

## What a project is

**A body of work with a budget and an owner.** Not an event, and not a subtype of one.
Events point at projects rather than the reverse, which is what lets one shape serve
three cases:

| Shape                  | Project | Events |
| ---------------------- | ------- | ------ |
| Facility improvement   | 1       | 0      |
| A produced show        | 1       | 1      |
| A festival or a season | 1       | many   |

The multi-show case is the consequence worth having: a festival is one budget, one
work backlog and five nights, and there is no way to say that today.

### What a project is not

- **Not the container work orders belong to.** `volunteer_shift.eventId` is nullable
  and set-null, alongside `assetId` — a work order hangs off an event, an asset, a
  project, or nothing. It gains `projectId` as one more optional anchor, and keeps the
  others. A work order can be _in_ the renovation project and _at_ Saturday's doors.
- **Not `production`.** See [Layering](#layering).
- **Not member-facing by default.** Every product surveyed is staff-facing.
  Consequence C below is the exception that earns member visibility.

## Layering

Three layers, and conflating any two of them was a wrong turn taken and reversed
during design.

| Layer        | What it is                                                                        | Cardinality               |
| ------------ | --------------------------------------------------------------------------------- | ------------------------- |
| `project`    | A body of work with a budget and an owner                                         | 0, 1 or many events       |
| `event`      | The occasion and its public listing                                               | The common case           |
| `production` | A show's back-of-house — the room hold, doors, ticketing, run of show, settlement | Only `source='cmc'` shows |

`event` stays the listing table because the community calendar will carry orders of
magnitude more listings than productions. `production` is a **1:1 side table justified
by sparsity**: run-of-show and settlement columns would be NULL on ~90% of rows, and
the gig guide — the hottest query in the app, present on every public page — scans
them all.

`event_band`, `event_rsvp`, `ticket`, `content_flag` and `media_attachment` keep
pointing at `event.id`. No polymorphism is introduced.

## Schema

### `project`

| Column            | Notes                                                                         |
| ----------------- | ----------------------------------------------------------------------------- |
| `id`              | uuid, as every other table                                                    |
| `name`            | not null                                                                      |
| `description`     | nullable                                                                      |
| `status`          | reuses `suggestionStatuses` — see [Consequence C](#c-the-suggestion-pipeline) |
| `groupId`         | **nullable, the owning committee.** In the first migration — see below        |
| `suggestionId`    | **nullable, the suggestion this answers.** In the first migration — see below |
| `budgetCents`     | nullable. The ceiling; burn is never stored beside it                         |
| `startsAt`        | nullable. The baseline for template-anchored work orders                      |
| `endsAt`          | nullable. Ongoing work has no end                                             |
| `createdByUserId` | set-null, as elsewhere                                                        |

### Nullable `projectId`, added to

- `volunteer_shift` — work orders
- `contractor_job` — the electrician, finally attached to something
- `purchase_order` and `acquisition` — what the project spent
- `event` — many-to-one; a band gig has none

All additive. No live membership is migrated.

### Two columns that must ship in the first migration

Retrofitting either onto existing rows is far harder than starting with them.

- **`project.groupId`** — the owning committee. Committee-scoped views are what make
  projects usable by the people doing the work rather than another staff-only queue.
- **`project.suggestionId`** — closes the loop described below.

## Committee ownership

The schema anticipated this before there was anywhere to put it. From `duty_list`:

> Facility and Programming own their own lists, and a list you need a deploy to change
> is not owned by them.

[committees-and-roles-spec.md](committees-and-roles-spec.md) establishes a committee as
a `group` row with `joinPolicy = 'by_application'` — six committees, each with a chair.
[admin-vs-staff-spec.md](admin-vs-staff-spec.md) states the guard mechanism outright:

> A committee guard reads `group_member`, not the role table, and the two are
> independent.

So a committee-scoped project view **needs no role work and is not blocked on the
admin/staff split.** It is also the answer to giving committees a window into their own
work without handing them the whole panel — the failure mode `admin-vs-staff-spec.md`
was written about.

## C. The suggestion pipeline

`suggestionStatuses` is `['open','planned','in_progress','done','declined']` — a
project status machine as written, and reused rather than duplicated.

More than a vocabulary match, it is a pipeline: **a member suggests, staff commit, work
orders get it done, and the result is visible back on the suggestion.** Today that loop
is open — a suggestion reaches `done` because a staffer says so, with no link to the
work that did it. `project.suggestionId` closes it, and the votes become the mandate.

That also answers member visibility: **a project is worth showing members precisely
when it came from them.**

Nullable, not a subtype. A failed breaker panel is a project nobody suggested.

## Budget and burn

**Burn is derived, never stored.** It is a `sum()` over ledgers that already hold the
atoms:

| Source               | Contributes         |
| -------------------- | ------------------- |
| `volunteer_hour_log` | Labour              |
| `purchase_order`     | Parts and materials |
| `stock_movement`     | Consumption         |
| `contractor_job`     | Vendor cost         |

This follows the app's stated habit, from `contractorJobStatuses`:

> There is no `overdue`. Late is `scheduled` plus an `expectedBackAt` in the past —
> derived on read like `listLateOrders`, because a stored status would need something
> to come along and set it.

### Volunteer hours are two numbers, never one

|             | Impact / grant value                                      | Recognizable contributed services                       |
| ----------- | --------------------------------------------------------- | ------------------------------------------------------- |
| Covers      | Every approved hour                                       | Only specialized-skill hours                            |
| Rate        | `volunteer.hourValueCents` in site config, Oregon default | What that skill would cost to buy                       |
| Used for    | Grants, impact reports, board reporting                   | Financial statements, per FASB                          |
| Restriction | None                                                      | Only a specialized skill that would otherwise be bought |

The second column is the test the acquisitions register already applies to donated
_goods_ (Form 8283, gifts-in-kind disclosure, the Form 8282 queue). Contributed
services are the sibling case.

This asks two things of adjacent tables:

- **`volunteer_role` marks specialized skill.** A donated audio engineer's hour and a
  door shift are different accounting objects despite being the same work-order shape.
- **`contractor_job` can be donated.** The electrician who does not invoice is a
  contributed service at professional rate — the same row that would otherwise carry
  `costCents`.

**Project burn shows both, labelled, and never sums them.**

> **Prerequisite.** `volunteer.hourValueCents` must not be added before the
> site-config read path is fixed — see `CHORES.md`. `getConfigsByPrefix` issues a KV
> `list()` then a sequential `get()` per stored key, so a config read is not free.

## The deal shape

Settlement is not a fixed 70/30. The general form costs four columns and subsumes every
case, including two CMC already has:

| Deal                       | Guarantee | Percentage | Versus |
| -------------------------- | --------- | ---------- | ------ |
| Donated performance        | 0         | 0          | —      |
| Flat fee                   | X         | 0          | —      |
| Pure split (CMC's 70/30)   | 0         | N          | —      |
| Guarantee against the door | X         | 0          | —      |
| Versus                     | X         | N          | yes    |

`{ guaranteeCents, percentageBps, versus, againstNet }` **on `event_band`, not
`event`** — a headliner and a local opener on one bill can have different terms, and
the lineup row is already what settlement splits across.

A donated set is that shape at zero and zero, flagged as contributed, which is the only
way the app can currently record that a band played for free or what it was worth.

Out of scope: ticket scaling (a pricing surface, and it conflicts with NOTAFLOF
sliding-scale ticketing), rider and hospitality terms (documents, better attached), and
the rendered deal memo (document generation, separable from the numbers).

## Recurring work: a third template shape

`duty_list_item` anchors work orders at `doors|start|end`. A project-anchored template
("week one: demo, week two: paint") wants an offset from `project.startsAt` — **one
more `dutyListAnchors` value, not a new model**, since `duty_list_item` already carries
both a window and a `dueOffsetMinutes` deadline.

Separately, recurring facility work needs a shape the app does not have. The decision
rule, now three-way:

| Shape                 | When                                                       | Example                                |
| --------------------- | ---------------------------------------------------------- | -------------------------------------- |
| Real table            | Instances are edited after the fact                        | `duty_list` — rosters change           |
| Prototype row         | Instances are not edited after the fact                    | Recurring events                       |
| **Generate-on-close** | The next occurrence should not exist until this one closes | Monthly deep clean, quarterly PA check |

Generate-on-close cannot drift and cannot pile up unclosed duplicates, which a
window-materializer like `recurring_series` can.

## Vocabulary

Adopted from CMMS, where these terms have forty years of settled meaning:

| Term             | Here                                               |
| ---------------- | -------------------------------------------------- |
| **Work request** | `asset_flag` — someone noticed, not yet authorized |
| **Work order**   | `volunteer_shift` — triaged, scoped, assigned      |
| **Project**      | This document                                      |
| **PM schedule**  | Generate-on-close recurring work, above            |

Renaming the tables to match is separate work, sequenced before any `projectId`
migration so the two do not share a lineage. `duty_list` keeps its name — real venue
and theatre vocabulary, and better here than CMMS's "PM schedule."

## Open questions

- Whether **progress** derives from work-order completion, work-order count, or is set
  by hand. ERPNext offers four methods and picks none; pick one deliberately.
- Whether a project needs a **status machine of its own** or `suggestionStatuses` is
  genuinely sufficient once real projects exist.
- Whether **equipment loans should be certification-gated** the way makerspace software
  gates machines. Policy, not technology — `member_certification` already exists.

## Out of scope

- **Multi-tenancy.** Serving other venues is a real direction, and the general deal
  shape above is a prerequisite for it. Designing tenancy now is premature; the `venue`
  table in [production-workflow-spec.md](production-workflow-spec.md) is the other half
  and comes first.
- **Time tracking beyond `volunteer_hour_log`.** No clock-in.
- **Billing.** A project has a budget, not a customer.
