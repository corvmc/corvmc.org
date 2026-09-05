# What comparable products already solved, and what we should take

> Prior-art survey behind the `project` entity — five product categories, what each
> contributes, and the counter-evidence. Companion to `docs/specs/project-spec.md`
> (the design) and `docs/architecture/domain-model.md` (where projects sit).
>
> **Status: complete.** Surveyed 2026-09-02.

## Why this exists

The app was being read as three verticals — asset management, project management,
social — over two horizontals, comms and money. Getting there took three corrections,
and the third one opened a hole:

- A **reservation is a loan.** `reservationStatuses`, `loanStatuses` and
  `contractorJobStatuses` are three spellings of one custody machine. The room, the
  amp, and the amp at the repair shop are the same flow over different resources.
- A **show is a project.** `duty_list` stamps work orders onto an event anchored at
  `doors|start|end`; `work_task` is the checklist; `volunteer_signup` is who claimed
  it. `eventKinds` now includes `work_party`, which is a project outright.
- **Ongoing facility work has no event.** So `project` cannot be an extension of
  `event`. It is a root entity, and multi-show projects fall out of that for free.

That container does not exist. The only occurrences of the word `project` across
`src/lib/server/db/schema/` and `src/lib/config.ts` are two unrelated comments — one
about the vitest project, one calling a band "a member's own project." There is no
`budget` column and no grouping of any kind. The gap is already named in the schema,
in `contractor_job.assetId`:

> Null is building work: an electrician has no asset, and pretending otherwise would
> mean inventing an inventory row for the breaker panel.

Before specifying that container, this asks what already solved it.

## What we are building, in category terms

**A CMMS fused with a venue management system.** Both are mature categories with
settled conventions, which is the useful part.

A **Computerized Maintenance Management System** is software for organizations that
own physical things and must keep them working — facilities, fleets, plants, venues.
A distinct category since the 1980s. Four entities carry it:

| Entity           | What it is                                                                                     |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| **Asset**        | A tracked physical thing, with a service history attached to it permanently                    |
| **Work request** | Someone noticed a problem. Informal, unauthorized, anyone may file one                         |
| **Work order**   | The request after triage — scoped, prioritized, assigned, with parts and labour recorded on it |
| **PM schedule**  | A template plus a trigger, generating work orders before anything breaks                       |

Around those sit parts inventory, vendor records, labour hours, and — in the larger
products — the **project** grouping many work orders under one budget.

**Most of one is already built here, unnamed.** `inventory_asset` + `stock_movement`
is the asset and its service history; `asset_flag` is the work request;
`volunteer_shift` is the work order; `purchase_order` is procurement; `contractor_job`
is the vendor. The two missing pieces are the PM schedule and the project.

A CMMS has no concept of a show, which is where the venue systems come in. **The app
sits between the two categories**, and that is why no single surveyed product maps
onto it cleanly.

## On evidence quality

Worth stating up front, because it varies a lot by category.

- **CMMS** vocabulary is standardized across vendors — _work request_, _work order_,
  _project_, _PM schedule_ carry consistent documented semantics. Well-evidenced even
  though no individual vendor publishes a schema.
- **Venue systems** publish feature descriptions only. Fetching Artifax's scheduling
  page for its entity model returned nothing usable. Those inferences come from
  feature surface, not structure — treat them as weaker.
- **ERPNext** is the only system surveyed whose schema is inspectable, and it is the
  strongest single piece of evidence here.

## Products surveyed

| Category                  | Products                                                                                       | Why comparable                                                                                       |
| ------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| CMMS / maintenance        | UpKeep, Tractian, ClickMaint, eWorkOrders, Guide Ti (COGEP), FacilityForce, Oxmaint, MicroMain | Work requests → work orders against assets; projects grouping them                                   |
| Venue / production        | Prism.fm, Artifax, Momentus (formerly Ungerboeck)                                              | Room hire + production schedule + settlement in one system; Artifax targets arts nonprofits directly |
| Shared space / makerspace | **Fabman**, Omnify, Spacebring                                                                 | Closest whole-org analogue — members on plans, equipment, training gates, room + machine booking     |
| Open-source ERP           | **ERPNext / Frappe**                                                                           | Publishes its doctype schema; has Project, Task, Timesheet and Asset Maintenance as real models      |
| Volunteer management      | Bloomerang, Galaxy Digital, Better Impact, WildApricot, Salesforce Nonprofit                   | The labour half                                                                                      |

## Findings

### 1. `asset_flag` → work order is the standard work request → work order pattern

Across CMMS products a **work request** is the informal ask, and it becomes a **work
order** once triaged, prioritized and assigned. Tractian's framing: a request "lacks
the detailed information included in work orders **and authorization to take immediate
action**." That is `asset_flag.status = 'pending'` precisely. N requests collapsing
onto one order — which `asset_flag.workOrderId` already allows — is also standard.

**Take:** the vocabulary. It makes the module readable to anyone with a maintenance
background, and it resolves the collision with `content_flag`, which is moderation and
entirely unrelated — a collision the `asset_flag` comment currently spends a paragraph
disclaiming.

### 2. A CMMS project is exactly the container we need

Projects group work orders "executed by different people and/or teams at different
times", tying each one's labour and parts costs to a single parent so finance sees
"real-time burn vs. the approved project budget." The canonical example given is an
annual plant shutdown — a bounded push of many work orders across a facility, which is
the facility-improvement case verbatim. Nothing exotic is being invented.

### 3. ERPNext: project cost is derived from child records, not stored

The strongest evidence, because it is schema rather than marketing. ERPNext's
`Project` doctype carries `total_costing_amount`, `total_purchase_cost`,
`total_consumed_material_cost` and `gross_margin` — all **aggregated from linked
children**, never independently maintained: `Timesheet` for labour, `Purchase
Invoice`/`Purchase Order` for bought things, `Stock Entry` for materials consumed.

The mapping is close to exact:

| ERPNext          | CorvMC                                              |
| ---------------- | --------------------------------------------------- |
| `Task`           | `volunteer_shift` (the work order) + `work_task`    |
| `Timesheet`      | `volunteer_hour_log`                                |
| `Purchase Order` | `purchase_order`                                    |
| `Stock Entry`    | `stock_movement`                                    |
| —                | `contractor_job` (ERPNext books this as a purchase) |

**Take:** burn is a `sum()` over the four ledgers that already hold the atoms — not a
fifth ledger, not a stored counter. This matches the app's existing habit of deriving
rather than storing, stated in `contractorJobStatuses`' own comment: _"There is no
`overdue`. Late is `scheduled` plus an `expectedBackAt` in the past — derived on read
like `listLateOrders`, because a stored status would need something to come along and
set it."_

Two further details worth stealing: `expected_start_date` is the **baseline for
template-based task scheduling**, which is the project anchor `dutyListAnchors`
(`doors|start|end`) lacks; and `percent_complete_method` is configurable across four
derivations, so "how done is this project" is a choice worth making deliberately
rather than hardcoding.

### 4. Venue systems keep the advance and the settlement on the show

Prism.fm — built by someone who ran venues and produced festivals, so the multi-show
case was in view — puts run of show, ticket scaling, age limit, merch rates and
ticketing URLs on a per-show **Advance** tab, and generates settlement per show from
the original offer.

Artifax is the closest-positioned product to CorvMC: arts, culture and education
venues, covering "room hire, staff and resource scheduling, finances, artistic and
production schedules" in one platform. That it unifies room hire with production
scheduling is the assets-plus-projects fusion proposed here, sold as a category.

**Take:** run-of-show and settlement are per-night, so they do not belong on
`project`. Where they _do_ belong is Consequence A below — the volume asymmetry
changes that answer.

### 5. Recurring facility work needs a template shape we do not have

A CMMS **PM schedule** is a template — task instructions, parts, labour estimate —
plus a **trigger**, and the next occurrence is created _when the current work order is
closed_, not materialized in advance. ERPNext models this as two doctypes: `Asset
Maintenance` (the schedule: periodicity, assignee, type) and `Asset Maintenance Log`
(the instance: status, completion date, actions performed).

CorvMC has two template→instance mechanics and neither fits. `recurring_series`
materializes 2.5 weeks ahead; `duty_list` stamps onto an event on demand. A monthly
deep clean or a quarterly PA check wants generate-on-close, which cannot drift and
cannot pile up unclosed duplicates.

**Take:** a third shape in the template→instance decision rule, alongside real-table
(`duty_list`, because a roster is edited after the fact) and prototype-row (recurring
events, because nobody edits an event after it happens).

### 6. Fabman is the closest whole-org analogue

Fabman runs makerspaces and shared workshops: members on plans, equipment access
control, **member training that gates machine access**, room _and_ machine booking,
usage-based billing, and maintenance — one system. Structurally that is CorvMC with a
laser cutter where the PA is.

The instructive difference: Fabman's training records gate **equipment**. CorvMC has
the same mechanism — `member_certification` + `volunteer_role_certification` — but
points it only at volunteer shifts. Equipment loans are not certification-gated.
Whether they should be is policy rather than technology, but the machinery exists and
the gap is worth naming.

### 7. Volunteers as employees: the category shifts, and there is a lesson

Volunteer-management products add nothing on their own terms — volunteer database,
self-registration, role matching on availability and qualifications, hours logging,
reminders. CorvMC has all of it, with stricter certification gating than most.

**But treating volunteers as employee-shaped moves the comparison to workforce
management, and that category has four things the volunteer products do not:**

- **Position, not task type.** An employee holds a _position_ with a standing job
  description. `volunteer_role` is closer to a task type attached to one shift.
  Committees-as-departments (Consequence B) is what makes position a real concept
  here — "Programming Committee, Booking Lead" is a position; "Door" is a task.
- **Reliability as a tracked attribute.** `/staff/volunteer/people` shows lifetime
  approved hours — _contribution_, not _reliability_. The data exists
  (`volunteer_signup` records no-shows); nothing aggregates it per person. Worth
  building carefully: a visible no-show score on a volunteer is a different social
  object than on an employee.
- **Load balancing and burnout.** Workforce tools spread shifts deliberately.
  Nonprofits lose their best volunteers to the same three people doing everything,
  and nothing here would surface that.
- **A lifecycle beyond active/blocked.** `volunteerProfileStatuses` is
  `['active','blocked']`. Employee models run applicant → onboarding → active →
  inactive → alumni, and "inactive" is the state that makes re-recruitment possible.

**One caution, narrowly.** The volunteer-versus-employee line is about _paying_
volunteers and exercising employer-like control — stipends, or work that displaces
paid staff. It is **not** about assigning an accounting value to donated time, which
is standard nonprofit practice and is treated on its own in Consequence F. Reliability
scores and load balancing sit closer to that line than valuation does, and are the
parts worth thinking about socially before building.

## Consequences for the model

### A. Volume asymmetry revives `production` — as a sparsity split, not a project

The community calendar will carry orders of magnitude more **listings** (band gigs,
member-authored community events) than **productions**.

Per-night was the wrong test for where run-of-show and settlement go; **sparsity** is
the right one. If listings outnumber productions 10:1, then `reservationId`,
`doorsAt`, the three ticketing columns, run-of-show and settlement are NULL on ~90% of
rows — and the gig guide, the hottest query in the app and present on every public
page, scans them all.

So `production` returns as a **1:1 side table on `event`**, justified by sparsity
rather than by being "the project half." Three layers:

| Layer        | What it is                                                                        | Cardinality               |
| ------------ | --------------------------------------------------------------------------------- | ------------------------- |
| `project`    | A body of work with a budget and an owner                                         | 0, 1 or many events       |
| `event`      | The occasion and its public listing                                               | The common case           |
| `production` | A show's back-of-house — the room hold, doors, ticketing, run of show, settlement | Only `source='cmc'` shows |

`event_band`, `event_rsvp`, `ticket`, `content_flag` and `media_attachment` keep
pointing at `event.id`, so no polymorphism is introduced. Which columns migrate off
`event` is a spec-time decision and a real migration of live data — sequence it as its
own phase, and measure the gig guide query before and after so the claim is tested
rather than assumed.

### B. Committees are departments, and `project` carries its owner from day one

Already half-designed, and the schema anticipated it. From `duty_list`'s comment:

> Facility and Programming own their own lists, and a list you need a deploy to change
> is not owned by them.

`docs/specs/committees-and-roles-spec.md` establishes a committee as a `group` row
with `joinPolicy = 'by_application'` — six committees, each with a chair. And
`admin-vs-staff-spec.md` states the guard mechanism outright: **"a committee guard
reads `group_member`, not the role table, and the two are independent."** So a
committee-scoped view needs no role work and is not blocked on the admin/staff split.

**Take: `project.groupId` (nullable, the owning committee) in the first migration.**
Retrofitting ownership onto existing rows is far harder than starting with it, and
committee-scoped project views are what make this usable by the people doing the work
rather than another staff-only queue. This is also the answer to giving committees a
window into their own work without handing them the whole panel — which
`admin-vs-staff-spec.md` names as the failure mode that motivated it.

### C. Projects are suggestion-shaped, and the pipeline closes a real loop

`suggestionStatuses` is `['open','planned','in_progress','done','declined']` — a
project status machine as written. More than that, it is a **pipeline**: a member
suggests, staff commit, work orders get it done, and the result is visible back on the
suggestion.

Today that loop is open. A suggestion reaches `done` because a staffer says so, with
no link to the work that did it. `project.suggestionId` (nullable) closes it, and the
votes become the mandate — which also answers the member-visibility question: a
project is worth showing members _precisely when_ it came from them.

Nullable, not a subtype. A failed breaker panel is a project nobody suggested.

### D. Meter-based triggers are reachable — the meter is the loan ledger

Correcting finding 5's first reading, which dismissed these for lack of instrumented
hardware. The trigger does not need hardware. `inventory_loan` records checkout and
return, so **time out on loan** sums straight out of the ledger; `reservation` gives
room hours the same way; and time since last movement gives **idle**. "Service this
amp after 50 hours out" and "check anything untouched for six months" are both
derivable today, from data already written, with no new column.

State the limit honestly: loan duration is a **proxy for use**, not use. An amp signed
out for a week may have been played twice. Fabman meters actual machine-on time; this
does not. Good enough to schedule an inspection, not good enough to call it runtime
hours.

### E. The deal layer: model it, because the general form is nearly free

In commercial touring a promoter makes an **offer** to an artist's agent: a guarantee
(flat fee), a door deal (percentage), or _versus_ (the greater of the two, usually
against net after expenses), plus production costs, hospitality and rider terms, and
**ticket scaling** — multiple price tiers across the room. The **deal memo** is the
written contract; **settlement** reconciles the night's actual sales and expenses
against it. Prism generates settlement _from the original offer_, because the offer is
the input document.

An earlier reading dismissed all of this on the grounds that CMC is the producer, the
venue and largely the community the acts come from, so there is no arms-length
negotiation. **That reasoned from current operations as though they were fixed, and
three things say otherwise:**

1. **A guarantee is aspirational, not foreign.** If the collective could afford to
   guarantee an act, it would want to — and a model that cannot express one forecloses
   that.
2. **The inverse already happens.** CMC sometimes asks bands to donate their
   performance. That is a deal term, and by Consequence F it is a **contributed
   service** — so it should carry a value for grant and impact reporting rather than
   being absent from the books. There is nowhere today to record that a band played
   for free, let alone what it was worth.
3. **Sponsor and partner venues bring their own structures.** Offering facets of these
   systems to other venues means meeting deals CMC does not itself use.

**And the general form is one shape.** Guarantee-versus-percentage subsumes the rest:

| Deal                       | Guarantee | Percentage | Versus |
| -------------------------- | --------- | ---------- | ------ |
| Donated performance        | 0         | 0          | —      |
| Flat fee                   | X         | 0          | —      |
| Pure split (CMC's 70/30)   | 0         | N          | —      |
| Guarantee against the door | X         | 0          | —      |
| Versus                     | X         | N          | yes    |

So `{ guaranteeCents, percentageBps, versus, againstNet }` expresses every row — four
columns, and settlement becomes one function rather than a branch per deal type. CMC's
70/30 is that shape with the guarantee at zero; a donated set is that shape at zero and
zero, flagged as contributed.

**Where it hangs: `event_band`, not `event`.** A headliner and a local opener on one
bill can have different terms, so the deal belongs to the lineup row — which already
exists, already distinguishes a linked platform band from a bare name, and is already
what settlement would split across.

**Still out of scope,** for reasons that survive the correction: **ticket scaling** is
a pricing surface rather than a settlement input, and conflicts with NOTAFLOF
sliding-scale ticketing; **hospitality and rider terms** are documents, better as an
attachment than as columns; and the **deal memo as a rendered contract** is
document-generation work, separable from the numbers that drive settlement.

**The expense side transfers,** and is where this meets the project layer: even a flat
70/30 needs to know what comes off the top — sound engineer, paid door staff, supplies
— which is exactly the rollup from finding 3, `contractor_job` and `purchase_order`
scoped to the event.

### F. Volunteer hours carry a dollar value, and it is two numbers

Grant writing and impact reporting put a rate on volunteer time as a matter of course,
so the valued hour is not an optional extra on project burn — **it is a number the
collective needs anyway**, and the app is where the hours already live. But two
distinct valuations exist with different rules, and collapsing them produces a figure
wrong for both audiences.

|             | **Impact / grant value**                                                                              | **Recognizable contributed services**                                                    |
| ----------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Covers      | Every approved hour                                                                                   | Only specialized-skill hours                                                             |
| Rate        | Independent Sector — **$36.14/hr** national for 2025, released April 2026; state rates also published | What that skill would actually cost to buy                                               |
| Used for    | Grant proposals, annual and impact reports, board reporting, corporate partners                       | Financial statements, per FASB                                                           |
| Restriction | None                                                                                                  | Only if the volunteer performs a **specialized skill** that would otherwise be purchased |

The second column is the same test the app **already implements for donated goods** —
the acquisitions register carries Form 8283 acknowledgment, gifts-in-kind disclosure
fields and a Form 8282 compliance queue. Contributed _services_ are the sibling case,
and nothing models them.

**The rate is runtime config, not code.** Independent Sector republishes every April,
so any hardcoded figure is wrong within a year and the annual refresh should be a
settings edit. It is the same shape as `'reservation.hourlyRateCents': 1500` — one
line in `DEFAULTS` plus a field on the settings page staff already use for the room
rate. **But not before the site-config read path is fixed** (#550):
`getConfigsByPrefix` issues a KV `list()` and then a sequential `get()` per stored key,
so config is not the free lookup this would otherwise imply.

Default to **Oregon**, whose published figure is `$36.44/hr` in the 2025 report — above
the national average. Note that report covers 2024 data (its national number was
`$34.79`), while the `$36.14` above comes from the April 2026 release covering 2025.
Read Oregon's matching 2026-release value off Independent Sector's state spreadsheet
when setting the default rather than carrying `$36.44` across.

This covers the **impact/grant** column only. The specialized-services column is not
one rate — it is "what that skill would cost," which differs between a donated audio
engineer and a donated bookkeeper, so it belongs on the role or the job rather than in
site config.

What this asks of the schema:

- **`volunteer_role` marks specialized skill**, since that is what splits the two
  columns. A donated audio engineer's hour and a door shift are different accounting
  objects even though they are the same work-order shape.
- **A `contractor_job` can be donated.** The electrician who does not invoice is a
  contributed service at professional rate — the same row that would otherwise carry
  `costCents`. One nullable marker makes the trades case work in both directions.
- **Project burn shows both**, labelled, never summed into one total.

## Counter-evidence

Cited because the findings above would otherwise read as a clean sweep.

**ERPNext does not unify maintenance work with project work.** `Asset Maintenance` /
`Asset Maintenance Log` is a separate hierarchy from `Project` / `Task`. We propose one
work-order table serving both a show's door shift and a broken amp's repair.

Would a separate join table mitigate this — `work_order_link(workOrderId, targetType,
targetId)` instead of nullable `eventId` / `assetId` / `projectId`? It is the right
instinct for a different problem. It buys many-to-many and cheap new target types, at
the cost of FK integrity and a join on the hot queries. But the cardinality is not
there: a work order has _one_ event, _one_ asset, _one_ project — 1:1 per target type.
A join table would generalize a cardinality that does not exist.

More to the point, it addresses the wrong axis. The divergence is not about how the
link is stored, it is about whether the two kinds of work are one table at all. **The
real test is whether they share columns — and they do, completely:** a role, a window
or a deadline, capacity, a checklist, an assignee, a cancellation. Two tables would be
two identical tables. The ERP split reflects pressures CorvMC does not have (assets are
capitalized, projects are billable, and the two must reconcile separately). Keep one
table; this is the decision, not an oversight.

## What not to take

- **CMMS asset hierarchies and parts inventory.** `inventory_item` /
  `inventory_asset` / `stock_movement` already cover this at the collective's scale.
- **Ticket scaling, rider and hospitality terms, and the rendered deal memo** — but
  _not_ the deal itself, which Consequence E argues for keeping.
- **ERPNext's `gross_margin` and billing fields.** A project here has a budget, not a
  customer.
- **Hardware-metered PM triggers.** Superseded by Consequence D, which gets the useful
  half from data already recorded.

## Open questions

- Whether a project's **progress** derives from work-order completion, work-order
  count, or is set by hand. ERPNext offers four methods and picks none.
- Whether **equipment loans should be certification-gated** the way Fabman gates
  machines. Policy, not technology — the mechanism exists.
- Whether **reliability metrics** on a volunteer should be visible, and to whom.

## Sources

- Tractian — [work order vs work request](https://tractian.com/en/blog/work-order-vs-work-request-complete-maintenance-guide) · [PM schedules](https://tractian.com/en/glossary/preventive-maintenance-schedule)
- [Guide Ti (COGEP) — project management in CMMS](https://guideti.com/cmms-solutions/project-management-in-cmms/)
- [FacilityForce — capital improvement](https://www.facilityforce.com/capital-improvement)
- [ClickMaint — calendar- vs meter-based PM work orders](https://www.clickmaint.com/blog/calendar-based-vs.-meter-based-preventive-maintenance-work-orders)
- [UpKeep — CMMS work order management](https://upkeep.com/blog/cmms-work-order-management/)
- [Prism.fm — venue and promoter product](https://prism.fm/why-prism-for-venues-and-promoters/)
- [Artifax — features](https://artifax.com/features/) · [Momentus vs Artifax](https://gomomentus.com/compare/momentus-vs-artifax)
- [Fabman — product](https://fabman.io/product)
- ERPNext — [Project Management (DeepWiki, code-derived)](https://deepwiki.com/frappe/erpnext/10.1-project-management) · [Asset Maintenance docs](https://docs.frappe.io/erpnext/asset-maintenance)
- [Bloomerang — volunteer management software](https://bloomerang.com/blog/volunteer-management-software)
- Independent Sector — [Value of Volunteer Time](https://independentsector.org/research/value-of-volunteer-time/) · [2026 release, $36.14 national](https://independentsector.org/blog/2026-value-of-volunteer-time-release/) · [methodology](https://independentsector.org/research/value-of-volunteer-time-methodology/) · [2025 report PDF, state tables](https://independentsector.org/wp-content/uploads/2025/04/vovt-report-2025.pdf)
