# Productions

A **production** is a show the Collective puts on: booked, advanced, run, settled, and
cleaned up. Today the app models only the public half of that — an `event` row with a
title, times, a poster, and optional ticketing. Everything a producer actually does
between "we should book this band" and "the room is reset" lives in spreadsheets and
group chats: who's playing and in what order, how long each set runs, which touring act
has no CMC account, whose venue it's at, what the band cut came to, and whether the
load-out checklist got finished.

This feature adds that back-of-house layer. A `production` row hangs off exactly one
existing `event`, carrying the lineup, the schedule, the checklists, and the settlement.
It adds a real `venue` table, and it lets a touring act with no account be a first-class
lineup entry — and later claim its own profile without the show history being rewritten.

Everything here is staff-facing and gated behind a `productions` feature flag.

---

> ## Status, 2026-09-02 — read this before building any of it
>
> **Two of this spec's four responsibilities have shipped**, under different names, and
> the text below has not been updated to say so. Building from it unamended would
> re-implement work that already exists.
>
> | Responsibility                   | Now                                                                                   |
> | -------------------------------- | ------------------------------------------------------------------------------------- |
> | Advance checklist                | ✅ A due-dated work order whose tasks are the checklist (#403, #405)                  |
> | Day-of shifts, `production_task` | ✅ `duty_list` → work orders → `work_task`, anchored `doors\|start\|end` (#405, #407) |
> | Run of show (`production_slot`)  | ❌ Still unbuilt. Per-night, and still belongs here                                   |
> | Settlement and expenses          | ⚠️ Still unbuilt, but the 70/30 model below is superseded — see below                 |
>
> **Three amendments to what remains:**
>
> 1. **The container this spec was reaching for is `project`, not `production`.** A
>    facility improvement has no event, and a festival has several — neither fits a
>    1:1 child of one event. See [project-spec.md](project-spec.md). `production`
>    survives as this spec defines it (a 1:1 child record), now justified explicitly by
>    **sparsity**: the community calendar carries far more listings than productions, so
>    run-of-show and settlement columns would be NULL on most rows of the gig guide's
>    hottest query.
> 2. **The fixed 70/30 deal is superseded by a general deal shape.**
>    `{ guaranteeCents, percentageBps, versus, againstNet }` on `event_band` subsumes
>    70/30 as one case, and also expresses a donated performance — which CMC already
>    asks for and cannot currently record. See
>    [project-spec.md § The deal shape](project-spec.md#the-deal-shape).
> 3. **The `venue` table is the first half of serving other venues.** Offering facets of
>    these systems to sponsor or partner venues is a live direction, and the general deal
>    shape above is its prerequisite. Multi-tenancy itself stays out of scope.
>
> Reasoning and prior art:
> [project-management-prior-art.md](../reports/project-management-prior-art.md).

> **The band/group boundary is defined by [groups-spec.md](groups-spec.md), not here.** That spec
> splits today's `band` table into `group` (the managed organization: roster, roles, slug,
> announcements, documents) and `band_profile` (the musical identity: genres, links, tier, EPK).
> An external act is a `band_profile` with no group. Sections below that used to describe external
> acts as member-less `band` rows have been reconciled with it.

---

## Key concepts

**The event is the parent; the production is a child record.** `/staff/events` stays the
single front door for creating a CMC show. "Add production" is an action _on an event_,
not a second way to create one. `production.eventId` is a NOT NULL unique FK — still
strictly one production per event, one event per production — but the production never
creates the event. An earlier draft of this spec had it the other way round, which gave
staff two front doors for the same object and left an awkward backfill question for the
events that already exist. Attaching to an event answers both: any event can gain a
production at any time, and nothing needs migrating.

Public concerns — title, poster, ticket price, gig-guide listing, venue — stay on `event`
and are edited where they always were. Ops concerns — lineup, load-in, payouts,
checklists — live on `production` and never leak to the public schema. Nothing is
duplicated across the two tables.

**The room is held from `draft`, not from `confirmed`.** The event is created with a
`reservation` covering doors→close, exactly as `/staff/events` does today; the production
widens that window to load-in→load-out once those times are known. The earlier design
created the reservation only at `confirmed`, which meant the room stayed bookable by
members for the entire stretch while a show was being booked into it. Holding early and
widening later costs nothing and closes that window.

**A lineup slot always points at a `band_profile` row.** Touring and non-member acts get
profiles too, with no group attached (see below). One reference type means a lineup can mix
member and non-member acts without a polymorphic column, and an act that later joins the
Collective keeps every production it ever played.

This is also why lineups are **not** modeled with `event_group`, the co-billing join
introduced in [groups-spec.md](groups-spec.md). `production_slot` carries set times, set
lengths, ordering, and per-act settlement; `event_group` carries only which member groups a
band-authored event is advertised on. A production uses `production_slot`; a member-authored
event uses `event_group`; nothing uses both.

**Set times are derived, full stop.** A pure helper walks the lineup in order and the
service recomputes on every lineup mutation. There is no override, no lock flag, and no
"recalculate" button — the same treatment as `calculateDailyRate()` /
`calculateLoanCharge()` at the top of `equipment/loan-service.ts`, where the number is
always a function of its inputs. Day-of adjustments happen on a clipboard, not in the
database.

**Stripe is the ledger and settlement only reads it.** Per
[finance-spec.md](shipped/finance-spec.md), settlement creates no Order or Transaction tables and
writes nothing back to Stripe. Ticket revenue is read live from Stripe at settle time and
snapshotted onto the production. Door cash, expenses, and band payouts are _recorded_
amounts — the app is a settlement worksheet and a record of what was handed over, not a
disbursement system.

**Checklists are data, not code.** Advance and close-out are rows in one
`production_task` table separated by a `phase` column, seeded from default templates and
editable per show. The close-out phase is the cleanup stage, and a production cannot
reach `closed` with unfinished close-out tasks.

---

## Prerequisites: two fixes, both landed

This design surfaced two bugs in shipped code. Neither was caused by productions and
neither depended on it, so both were fixed separately in
[#161](https://github.com/DevonCash/corvmc-svelte/pull/161) rather than being carried by
this feature. They are recorded here because the design leans on both, and because the
reasoning explains why parts of the spec below assume behavior that is newer than the rest
of the codebase.

**`event.cancelled` was emitted inside a ticket-holder guard.** In
`src/lib/server/event/event-service.ts`, `cancel()` collects ticket holders, dedupes them
by email, and used to emit the domain event inside `if (holders.length > 0)` — so the emit
was skipped entirely for any show that had sold no tickets. A production listening for
`event.cancelled` to mark its own status `cancelled` and release its slots would have
missed every cancellation of an unticketed show, which is most of them at draft stage. The
emit now fires on every cancellation with an empty `ticketHolders` array; the notification
listener iterates that array and so sends nothing when it is empty, which is why no
listener change was needed. **A production may now rely on `event.cancelled` firing
exactly once per cancellation**, which is what makes the event-as-parent cascade in "How a
production feeds the rest of the app" sound.

**Tickets didn't record their Stripe payment.** `handleTicketCheckout` in
`src/lib/server/ticket/checkout-listener.ts` flipped the purchase's tickets `pending →
valid` and emitted `ticket.purchased`, discarding `session.payment_intent` — unlike
`handleReservationCheckout`, which resolves the payment record id (falling back to
`session.id`) and writes it to `reservation.stripePaymentRecordId`. finance-spec's rule is
that the purchasable stores the Payment Record ID locally as its proof of payment; every
other purchasable did, and tickets were the gap. `ticket.stripePaymentRecordId` now exists
and is populated on both the card path and the credits-covered path. **Settlement therefore
inherits this column rather than adding it** — the schema section below counts it as
existing, and the comp detection in "Reading ticket revenue" depends on it.

---

## Domain model

### Production

The ops record. One per event.

```
production
  id                  uuid pk
  eventId             uuid unique fk → event    — NOT NULL, one-to-one
  status              text                      — see Status lifecycle
  producerUserId      uuid? fk → user           — staff lead
  loadInAt            timestamp?
  soundcheckAt        timestamp?
  firstSetAt          timestamp?                — anchor for computed set times
  curfewAt            timestamp?
  loadOutBy           timestamp?
  billingNotes        text                      — how the lineup is billed on the poster
  hospitalityNotes    text
  internalNotes       text
  bandSplitPercent    int                       — default 70; the band cut of gross
  doorCount           int?                      — settlement snapshot below
  compCount           int?
  ticketRevenueCents  int?
  doorCashCents       int?
  otherRevenueCents   int?
  bandPoolCents       int?
  totalExpenseCents   int?
  totalPayoutCents    int?
  netCents            int?
  settledAt           timestamp?
  settledByUserId     uuid? fk → user
  closedAt            timestamp?
  closedByUserId      uuid? fk → user
  createdByUserId     uuid fk → user
  createdAt           timestamp
  updatedAt           timestamp
```

Settlement totals live directly on `production` because the relationship is 1:1 — a
separate `production_settlement` table would buy nothing. Per-line detail lives in
`production_expense`; per-act payouts live on `production_slot`.

**There is no `production.venueId`.** Venue is a public fact about the show, so it lives
on `event.venueId` and nowhere else. A column on both tables would be two answers to one
question, and the production's copy would be the one nobody remembers to update.

Public-facing times stay on `event`: `event.doorsAt`, `event.startsAt`, `event.endsAt`.
The production's timestamps are the ones the public never sees. `firstSetAt` is
deliberately separate from `event.startsAt` — the listing says "8pm", the first band
actually goes on at 8:20.

### Venue

New table, closing the "Venues — not started" gap in
[feature-catalog.md](../reports/feature-catalog.md).

```
venue
  id            uuid pk
  name          text            — not unique; see below
  slug          text unique
  isPrimary     boolean         — the CMC room; exactly one row should have this
  address1      text?
  city          text?
  state         text?
  postalCode    text?
  capacity      int?
  contactName   text?
  contactEmail  text?
  contactPhone  text?
  loadInNotes   text?
  backline      json?           — BacklineItem[], reusing the type from $lib/types/band-page
  links         json?           — ProfileLink[], same shape as band.links
  notes         text?
  deletedAt     timestamp?      — soft delete, matching band/equipment
  createdAt     timestamp
  updatedAt     timestamp
```

`venue.name` is deliberately **not** unique. A raw uniqueness constraint on a
human-entered name is the same trap being removed from `band.name` below: it turns a
plausible data-entry situation into a 500 and a Sentry report, and there is no reason two
rooms in two towns can't share a name. `slug` carries uniqueness, and
`ensureUniqueSlug()` already handles collisions.

`event.venueId` is added as a nullable set-null FK **alongside** the existing
`event.location` free-text column. `location` stays exactly as it is — band-created
off-site gigs keep typing a venue name, and the gig guide's venue line keeps working
unchanged. `venueId` is the structured upgrade, used by productions and available to band
events later.

**Only shows at the primary venue hold space.** Whether a reservation exists is already
decided at event creation — `create()` in `event-service.ts` takes an optional
`reservation` param and only creates one when given it. For a production at the primary
venue the answer is always yes; for an off-site production it is always no, which is the
point of tracking the venue.

### External acts are band profiles with no group

A touring act needs a name, a bio, genres, links, a photo, and a contact, and no roster at
all. Under the band/group split that is exactly a **`band_profile` with `groupId` null** —
a staff-kept record of an act, held for the next time they come through.

> **An unclaimed act is a band profile with no group.** One condition, one source of truth.
> It has no slug, so it is not publicly addressable; it has no roster, so there is no
> membership to interpret.

Two earlier drafts of this section are now superseded, and it is worth saying why, because
each was solving a real problem the split removes:

- The **first** draft added `band.claimStatus` (`claimed` / `unclaimed` / `claim_pending`)
  and relaxed `band.ownerId` to nullable — a fourth copy of a fact already recorded three
  other ways.
- The **second** made external acts member-less `band` rows. That collapsed the four copies
  into one, but it put unclaimed acts into the same table as public bands, which forced the
  [Visibility audit](#visibility-audit) below: every "is this band public?" filter had to
  learn to exclude rows with no members.

Putting them in `band_profile` collapses that too. Public addressability now comes from
having a group at all, because that is where the slug lives — so there is no filter to
apply and none to forget.

The objection the second draft raised against a separate table — "a painful merge the day
the act joins" — does not apply, because nothing merges. Claiming creates a group, moves
name/description/avatar onto it, and links the existing profile; every production the act
ever played is already attached to that profile and stays attached. See
[Claiming an external act](groups-spec.md#claiming-an-external-act).

**`band.ownerId` is still dropped**, for the reasons below; ownership is now a
`group_member` row with `role: 'owner'`, enforced by a partial unique index on
`(groupId) WHERE role = 'owner'`. The call sites listed below are unchanged in substance —
substitute `group_member` for `bandMember` throughout.

The evidence for dropping it:

**Authorization never reads it.** `requireGroupRole()` in
`src/lib/server/group/group-context.ts` resolves the group and then calls `getUserRole()`,
which reads `group_member` alone.
There is no path from an access decision to `band.ownerId`. Every remaining use is
display or bookkeeping, and every one of them is derivable from `bandMember`.

**The atomicity objection doesn't apply.** The natural worry is that "who owns this band"
becomes two writes on a platform with no interactive transactions. But
`transferOwnership()` in `src/lib/server/band/band-service.ts` already performs three
statements in a single `db.batch([...])`: demote the current owner's `bandMember` row to
`admin`, promote the new owner's row to `owner`, and update `band.ownerId`. Dropping the
column deletes the third statement from a batch that already exists and already spans the
two `bandMember` writes. The atomicity guarantee is unchanged; there is simply less of it
to guarantee.

The call sites that change, all mechanical:

- The three owner display joins in `band-service.ts` —
  `.innerJoin(user, eq(user.id, band.ownerId))` in `listAll()`'s data query (~line 528),
  `listAll()`'s count query (~line 536), and `getByIdWithDetails()` (~line 564) — join
  through `bandMember` instead: `innerJoin(bandMember, and(eq(bandMember.bandId, band.id), eq(bandMember.role, 'owner')))`
  then `innerJoin(user, eq(user.id, bandMember.userId))`. These must become **left** joins
  on the way, or unclaimed acts silently vanish from `/staff/bands` and 404 on their own
  detail page. `ownerName`, `ownerEmail`, `ownerPronouns`, and `ownerRole` all become
  nullable.
- `deleteBand()` (~line 143) and `deactivate()` (~line 593) pass `row.ownerId` into
  `cancelReservation(id, userId)`, which requires a string. They should pass the staff
  member performing the action, which is the more correct attribution anyway.
- The `purgeUser()` owned-band guard in `src/lib/server/user/user-service.ts` (~line 165)
  counts `band` rows where `ownerId = userId`; it counts `bandMember` rows with
  `role: 'owner'` for that user instead.
- The contact-email fallback in `src/lib/remote/band-site.remote.ts` selects `ownerId`
  (~line 145) and looks the owner's email up by it (~line 170). Same substitution.
- `BandLayoutResponse` in `src/lib/server/db/schema/api.ts` (~line 52) picks `ownerId`
  into the band payload; the field is dropped, and band-panel consumers use `userRole`,
  which is already in that response and already comes from `bandMember`.
- `src/lib/remote/bands.remote.ts` — `createBandApi` takes an `ownerId` form field and
  passes it to `create()` (~lines 225, 229), which is fine as a _parameter_ (it becomes
  the initial `bandMember` row) but should be optional so staff can stub an external act
  with no owner. `transferOwnership` reads `band.ownerId` off `getByIdWithDetails()` to
  supply the actor (~line 301) and instead resolves the current owner from `bandMember`.
- `scripts/seed-dev.ts` sets `ownerId` on three band inserts (~lines 1071, 1146, 1165) and
  uses `b.ownerId` as an event's `createdByUserId` (~line 1217). The seed already inserts
  the matching `bandMember` row in each case, so this is deletion plus one lookup.
- `scripts/migrate-from-postgres.ts` maps the legacy `owner_id` (~lines 548, 575); it
  emits the `bandMember` owner row instead.

**Incidental win.** The live schema has `owner_id` declared `NOT NULL` with
`ON DELETE SET NULL` — see the `CREATE TABLE band` block in
`migrations/20260521230931_open_the_phantom/migration.sql`, where the column is
`owner_id text NOT NULL` and the FK is
`FOREIGN KEY (owner_id) REFERENCES user(id) ON DELETE SET NULL`. Those two clauses cannot
both be satisfied: deleting a user who owns a band would try to write NULL into a NOT NULL
column and fail at the constraint. `purgeUser()` guards this in application code, which is
why nobody has hit it. (The drizzle definition in `src/lib/server/db/schema/band.ts` says
`onDelete: 'restrict'`, so schema and migration also disagree about the intent.) Dropping
the column retires the whole question.

**Dropping `UNIQUE` on `band.name` at the same time.** Today `name` is
`text NOT NULL UNIQUE` — an inline column constraint in the same `CREATE TABLE band`
block. A global unique on band names was defensible when every band was a local member
band. It is wrong once external and touring acts are first-class: two genuinely different
acts share a name often enough that the constraint would leave staff simply unable to
enter the second one. An earlier draft proposed catching the violation as a typed
`BandNameTakenError` and offering a "did you mean" search; that turns a hard failure into
a polite hard failure. Drop the constraint instead. `ensureUniqueSlug()` already
guarantees the slug is distinct, which is the only uniqueness the app actually depends on,
and `BandNameTakenError` is not needed anywhere.

Dedupe moves into the UI, where it belongs: the inline-create flow searches existing bands
by name **first** and shows matches, picking one reuses that row, and "create anyway"
makes a second. That handles dedupe by intent, which is the only kind that works when two
different bands really are called Mirage.

**One migration, not two.** Both changes are to `band`, and both need a full table rebuild
— an inline `UNIQUE` in `CREATE TABLE` is not a droppable index, and SQLite cannot drop a
column in place while a constraint mentions it. A rebuild is dangerous on D1, because the
generated `DROP TABLE` cascade-deletes the rebuilt table's children, but that is a solved,
general problem rather than something this feature has to solve: `pnpm db:generate`
rewrites the rebuild automatically. The mechanism and what to check are in
[table rebuilds on D1](../development/conventions.md#table-rebuilds-on-d1); don't
duplicate the reasoning here.

What matters for this migration specifically:

- **Recount the descendants against the split.** `band_member` and `group_invite` leave
  the band entirely — they become `group_member` and `group_invite`, children of `group`.
  `band_genre`, `band_media`, and `band_page_config` re-key to `band_profile`. `event`
  re-points from `band` to `group`, pulling `ticket` and `event_rsvp` with it as before.
  The rewrite walks that transitively and orders the work deepest-first; confirm the
  generated set matches this list rather than assuming it.
- **Review the generated SQL** rather than skimming it. It will rebuild all eight of those
  tables around the `band` rebuild, which is correct and looks alarming.
- **Land it on its own**, ahead of the productions tables, so the one risky migration in
  this feature can be applied and verified in isolation.
- **Verify against local D1** before it goes near production: `pnpm db:reset`,
  then confirm row counts in `group_member`, `group_invite`, `band_genre`, `band_media`,
  `band_page_config`, `ticket`, and `event_rsvp`, plus non-null `event.group_id` values.

**Claiming** reuses the invite machinery and gets simpler as a result. Staff send a
`group_invite` to the act's contact email with `role: 'owner'` — the role column is already
typed as the full role tuple (`['owner', 'admin', 'member']`), so no schema change. Claiming
is the two-part operation described in
[groups-spec.md](groups-spec.md#claiming-an-external-act): a `group` is created for the
profile, and the invitee's `group_member` row is inserted with the invited role when they
sign up. There is no `claimStatus` to flip and no `ownerId` to backfill.

Note the ordering this implies: **the group must exist before the invite can be sent**,
since `group_invite.groupId` is a NOT NULL FK. Staff creating an act inline for a lineup
produce a profile with no group; sending an owner invite is what promotes it, and that step
is where the act's name, description, and avatar move from the profile onto the group. The
only thing left for the act to do is choose its visibility, which is a normal group-settings
edit.

The earlier draft's warning that `resolvePendingInvites()` leaves a split-brain no longer
describes a problem — the identity move happens once, at group creation, and the membership
insert is the whole of the remaining operation.

`transferOwnership()` needs one adjustment: it currently demotes the actor's owner row and
takes the actor id from `band.ownerId` at the call site. With no owner row at all the
demote simply matches zero rows, which is already the correct behaviour — but its
precondition that the new owner be an active `bandMember` should stay, and the caller in
`bands.remote.ts` must source the current owner from `bandMember`.

### Production slot (run of show)

One act, one set, one position in the running order.

```
production_slot
  id                 uuid pk
  productionId       uuid fk → production (cascade)
  bandProfileId      uuid? fk → band_profile (set null)
  sortOrder          real             — fractional; lower plays first, no unique constraint
  billing            text             — headliner | support | opener | dj | host
  setLengthMinutes   int
  changeoverMinutes  int              — default 10
  scheduledStartAt   timestamp?       — derived output, never hand-edited
  soundcheckAt       timestamp?       — manually set, independent of the set-time walk
  status             text             — invited | confirmed | declined | cancelled
                                      —   | performed | no_show
  guaranteeCents     int?             — rare; a flat fee agreed in advance
  payoutCents        int?             — what was actually handed over
  payoutMethod       text?            — cash | check | venmo | none
  paidAt             timestamp?
  techNotes          text?
  backlineNeeds      text?
  hospitalityNotes   text?
  contactName        text?            — per-show override of the act's stored contact
  contactEmail       text?
  contactPhone       text?
  createdAt          timestamp
  updatedAt          timestamp
```

`bandProfileId` is nullable and set-null rather than cascade so a deleted act leaves the
slot — and its payout record — intact for historical settlements. Note that deleting a
_group_ does not delete its band profile: the profile survives with `groupId` set to null and
its identity columns repopulated, so a disbanded member band reverts to a staff-kept record
and its slots keep a name.

**There is no `doorSplitPercent`.** The split is a property of the deal for the whole
show, not of each act, and it lives on `production.bandSplitPercent`. See "Settlement".

**Staff may set it per show**, defaulting to 70. A locked value with a config key was the
alternative; it was rejected because unusual deals are real and the app should record the
deal rather than force staff to work around it. The protection against a split quietly
settling at the wrong number is **visibility, not immutability**: the value appears in the
band-facing terms summary (see [Permissions](#permissions)), so the act sees the deal it was
offered rather than only the payout that came out the other end.

Tech requirements are entered per show, but a member band with a premium page already has
this on file: `BandEpk` in `src/lib/types/band-page.ts` carries `technicalRiderKey`,
`stagePlotKey`, and `backline`, and `band_media` has `'rider'` and `'stage_plot'` types.
The advance UI surfaces those when they exist so the producer isn't re-collecting them.

### Production task

> **Superseded (2026-09-02).** This shipped as `work_task` hanging off a work order,
> via `duty_list` — see the status banner at the top. There is no `production_task`
> table and there should not be one: a checklist belongs to the work order somebody
> is accountable for, not to the production as a whole.

Advance and close-out checklists, one table.

```
production_task
  id                uuid pk
  productionId      uuid fk → production (cascade)
  phase             text        — advance | day_of | closeout
  label             text
  sortOrder         int
  notes             text?
  done              boolean     — default false
  doneAt            timestamp?
  doneByUserId      uuid? fk → user
  assignedToUserId  uuid? fk → user
  createdAt         timestamp
  updatedAt         timestamp
```

`updatedAt` matters here more than on most tables: checkboxes get toggled constantly, and
without it the only mutation the row records is the one that set `doneAt`. Un-checking a
task would leave no trace at all.

Default templates live in `src/lib/config.ts` next to the existing equipment and inbox
tuples, and are copied into rows when a production is created so they can be edited per
show. Starting set:

- **advance** — confirm lineup and set times, collect tech riders and stage plots,
  confirm backline, send load-in details, confirm door/sound staffing, poster and social
  announcement, ticket link live.
- **day_of** — the pre-show walkthrough, and a real phase rather than a slice of advance.
  It is the list somebody works through the afternoon of the show, and most of it is about
  the building rather than the lineup: set house gear, check concessions stock, clean the
  bathrooms, float counted, doors staffed, sound check complete, hospitality set, merch
  table set.

  Merging it into `advance` was considered and rejected. Advance is booking work done days
  or weeks ahead by whoever is producing; `day_of` is venue work done hours ahead by
  whoever is on shift, and the two are often different people with different questions
  ("is the lineup confirmed?" versus "is the room ready?"). Collapsing them would put a
  stale rider request next to an unswept floor on one list.

- **closeout** — door count reconciled, bands paid, load-out complete, room reset, trash
  and recycling out, gear returned to storage, incidents logged, lock-up.

### Production expense

```
production_expense
  id            uuid pk
  productionId  uuid fk → production (cascade)
  label         text
  category      text        — sound | staffing | hospitality | marketing | rental | other
  amountCents   int
  paidTo        text?
  paidAt        timestamp?
  notes         text?
  createdAt     timestamp
  updatedAt     timestamp
```

---

## Status lifecycle

```
draft ──▶ offered ──▶ confirmed ──▶ completed ──▶ settled ──▶ closed
  │          │            │
  └──────────┴────────────┴──────▶ cancelled
```

| Transition                        | Trigger                                                       | Side effects                                                                                                                              |
| --------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| → `draft`                         | Add a production to an existing event                         | Copies task templates; widens the event's reservation to load-in→load-out once those times are set                                        |
| `draft` → `offered`               | Offers sent                                                   | Slots move to `invited`; no public change                                                                                                 |
| `offered` → `confirmed`           | Lineup locked                                                 | Unlocks event publish; no reservation work — the room is already held                                                                     |
| `confirmed` → `completed`         | Show happened (or the auto-complete cron passes the end time) | Slots **in `confirmed` status** move to `performed`; unlocks settlement                                                                   |
| `completed` → `settled`           | Staff settle                                                  | Reads ticket revenue, computes the band pool, snapshots the totals. Money fields stay editable; later changes go to the audit log         |
| `settled` → `closed`              | Close-out done                                                | Requires every `closeout` task `done`; archives the production                                                                            |
| any pre-`completed` → `cancelled` | Staff cancel                                                  | Cancels the event via `event-service.cancel()` (which notifies ticket holders and releases the reservation); marks live slots `cancelled` |

The `confirmed → completed` sweep must scope its slot update to `status = 'confirmed'`. A
blanket "set all slots to `performed`" would resurrect acts that declined the offer or
were cut from the bill, and the settlement worksheet would then invite a payout row for a
band that never showed up.

Publishing the event requires `confirmed` or later — you cannot announce a show whose
lineup isn't locked. Unpublishing is always allowed.

Transitions use the house pattern: an atomic conditional
`UPDATE ... SET status = ? WHERE id = ? AND status IN (...)` with a row-count check,
exactly as `updateStatus()` in `reservation-service.ts` does, because D1 has no
interactive transactions. Invalid transitions throw `InvalidProductionTransitionError`,
mirroring `InvalidLoanTransitionError`.

---

## Booking and advance

Staff create the show at `/staff/events` as they do today — title, date, doors, times,
and, at the primary venue, a reservation covering doors→close. Then "Add production" on
that event opens the back of house, copying the task templates. From there:

1. **Set the ops window.** `loadInAt` and `loadOutBy` widen the room hold. This goes
   through `event-service.update({ rebook })`, never through
   `reservation-service.staffCreate()` directly — `event.reservationId` is owned by
   `event-service` and the production has no business writing it.
2. **Build the lineup.** Add slots by picking a member band from a search, or by creating
   an external band inline for a touring act — name, contact, and optionally bio, genres,
   and links, with a name search shown first so the second show reuses the first show's
   row. `billing` and `sortOrder` set the running order.
3. **Send offers.** Terms per slot: a guarantee, if there is one. Moving the production
   to `offered` sets every slot to `invited`. Member bands get an in-app notification;
   external acts are contacted out-of-band (the staff inbox is the natural home for that
   thread, but the spec does not wire it — see Deferred).
4. **Confirm.** Slots move to `confirmed` or `declined` as replies come in. Confirming the
   production locks the lineup.
5. **Advance.** Work the `advance` checklist: collect riders, confirm backline, set
   soundcheck times, finalize set lengths. Any slot pointing at a premium member band
   shows that band's EPK rider, stage plot, and backline inline.

### Widening the reservation window

`checkRebookNeeded()` in `event-service.ts` works correctly under this design **without
modification**, and it is worth saying so explicitly rather than leaving it implied. It
returns `needed: true` only when the new event times fall _outside_ the current
reservation window (`newStartsAt < res.startsAt || newEndsAt > res.endsAt`). The
production's window is always a superset of the public window — load-in is before doors,
load-out is after close — so once the reservation has been widened, no ordinary edit to
`event.startsAt` / `event.endsAt` can escape it, and the function correctly reports no
rebook needed. Editing the public times of a show whose room is held load-in→load-out is a
no-op as far as the reservation is concerned, which is the right answer.

**Design note: `rebook` is the wrong shape for widening a window.** `update()`'s `rebook`
branch cancels the existing reservation via
`cancelReservation(..., { staffOverride: true })` and creates a fresh one with
`staffCreate()`. That means a new row, a new id written back to `event.reservationId`, and
a lost `lock_code` — the door code that `lock/lock-service.ts` provisions on the morning
of the show against `reservation.lockCode`, which it only assigns to reservations where
that column is still null. Churning all of that because load-in moved thirty minutes
earlier is disproportionate.

Worse, the re-created reservation's status is
`existing.status === 'draft' ? 'scheduled' : 'confirmed'`. A production holds the room from
`draft`, so a draft event's rebooked reservation lands in `scheduled` — which is exactly
what `cancelUnconfirmedReservations()` sweeps: it cancels every `scheduled` reservation
whose `startsAt` has passed, with no exclusion for `bookerType: 'event'`, on the
`*/15 * * * *` trigger.

**And the downgrade is permanent.** `publish()` writes only `event.status` and
`publishedAt`; it never revisits the reservation. A window widened while the event was
still a draft therefore stays `scheduled` no matter what the event does afterwards —
announce the show a week later, sell tickets to it, and the reservation is still swept the
moment load-in passes. Because the sweep delegates to `cancel()`, it also emits
`reservation.cancelled`, which cascades waitlist promotion: the room can be handed to a
member while the show is loading in. This is not an edge case to note and move past; it is
the reason the narrow adjustment below is required rather than merely tidier.

The recommendation is a narrow addition to `reservation-service`:

```
adjustWindow(reservationId, startsAt, endsAt, opts?: { overrideConflicts?: boolean })
```

which conflict-checks the new window excluding the reservation itself (`hasConflict()`
already takes an exclusion id) and updates `starts_at` / `ends_at` in place. Same row,
same status, same lock code. The production calls it through `event-service`, which keeps
`event.reservationId` correct by not needing to change it at all.

---

## Run of show

Set times are derived. Given `firstSetAt` and the slots in `sortOrder`:

```
cursor = firstSetAt
for slot in slots ordered by sortOrder:
    slot.scheduledStartAt = cursor
    cursor = cursor + slot.setLengthMinutes + slot.changeoverMinutes
```

`computeSetTimes()` is a pure exported function in the production module — no DB access,
directly unit-testable, the same treatment as the equipment pricing helpers. The service
runs it and writes the results on **every** lineup mutation: add a slot, remove a slot,
reorder, change a set length or changeover. There is no override field, no lock flag, and
no "recalculate" button.

This is a deliberate narrowing. The earlier design stored the computed time and let staff
hand-edit one slot, on the theory that a single late set shouldn't shift everything after
it. In practice that produces a column that is sometimes derived and sometimes not, with
no way to tell which — and the moment anyone edits a set length the whole lineup silently
disagrees with itself. Real day-of adjustments happen in the room, on a clipboard, at a
granularity the database was never going to keep up with. A schedule that is always
exactly a function of the lineup is more useful than one that is usually a function of the
lineup.

`soundcheckAt` stays a per-slot manually-set field. It is not part of the walk —
soundcheck order is frequently the reverse of set order, and it happens hours earlier.

Validation is computed on read and surfaced as warnings rather than hard errors, because
real shows run late:

- the last set's end plus its changeover exceeding `curfewAt`;
- `firstSetAt` earlier than `event.doorsAt`;
- a slot with `setLengthMinutes` of 0 or over 240;
- `soundcheckAt` after `firstSetAt`.

### Why `sortOrder` is fractional

An earlier draft made `sortOrder` an integer with `unique (productionId, sortOrder)`, and
proposed handling reorders by renumbering the whole lineup in one pass from a supplied
array of slot ids.

**That does not work on SQLite.** Unique indexes are enforced per-row as the `UPDATE`
walks the table, not deferred to the end of the statement — SQLite has no
`DEFERRABLE INITIALLY DEFERRED` for unique constraints. Swapping two slots therefore trips
the constraint mid-statement no matter how the writes are grouped, and `db.batch()` does
not help: batching controls atomicity, not constraint timing. The temporary-offset dance
(`sortOrder + 1000`, then back down) does work, but it is extra round trips and a
half-written state on every drag.

So `sortOrder` is a `real` with no unique constraint, and insertion is fractional: to
place a slot between two neighbours, average their `sortOrder` values. Inserting an act
into the middle of a running order is one write. Reordering is one write. Nothing is
renumbered, and there is no constraint to trip. Ties, if two clients ever produce one,
break on `createdAt` — a stable order, and cosmetically wrong at worst.

Documenting the rejected approach here is the point: `unique (productionId, sortOrder)`
looks obviously correct, and without this note someone will add it back.

---

## Settlement

Available once the production is `completed`. The worksheet:

```
grossRevenueCents  = ticketRevenueCents + doorCashCents + otherRevenueCents
bandPoolCents      = round(grossRevenueCents * bandSplitPercent / 100)
totalExpenseCents  = sum(production_expense.amountCents)
totalPayoutCents   = sum(production_slot.payoutCents)
netCents           = grossRevenueCents - bandPoolCents - totalExpenseCents
```

### The 70/30 deal

> **Superseded (2026-09-02).** 70/30 is one case of a general deal shape,
> `{ guaranteeCents, percentageBps, versus, againstNet }` on `event_band` — which also
> expresses a guarantee, a flat fee, and a **donated performance**, the last being
> something CMC already asks bands for and cannot record anywhere today. The split
> below stays correct as the default policy; it is no longer the only expressible one.
> See [project-spec.md § The deal shape](project-spec.md#the-deal-shape).

The Collective's actual arrangement is **70% of gross to the bands, with no expenses taken
off the top**, and the lead band on the bill divides the band cut among the acts. That is
what `bandSplitPercent` (default 70) and `bandPoolCents` model, and it is why there is no
per-slot split percentage: the Collective does not negotiate a split with each act, it
hands one number to one band.

An earlier draft had `pool = gross - expenses` and
`suggested = max(guarantee, pool * doorSplitPercent / 100)` per slot. Both are wrong for
this room. Expenses are **recorded but do not feed the pool** — the bands' 70% is 70% of
gross, and the Collective's 30% is what absorbs sound, staffing, and hospitality. That is
why `netCents` subtracts expenses from what's left after the band pool, not from the pool
itself.

`guaranteeCents` survives on the slot for the rare case of a flat fee agreed in advance,
and `payoutCents` / `payoutMethod` / `paidAt` record what actually changed hands. In the
common case exactly one slot's payout row is filled: the lead band's. The worksheet
displays `bandPoolCents` against `sum(slot.payoutCents)` side by side, so a mismatch is
visible without anyone having to do the subtraction.

**There is no lead band, and payouts are per-slot.** An earlier reading assumed one act
takes the cut and divides it in the parking lot. That happens, but it is a special case of
the general one: `payoutCents` lives on `production_slot`, so a four-band bill with no
headliner is four rows summing to `bandPoolCents`, and a show where one act collects for
everyone is one row equal to it. Both are the same worksheet — the only rule is that the
rows sum to the pool, which is exactly the side-by-side check above.

That means the schema needs no change, but the workflow does: settlement asks staff to
allocate the pool across slots rather than assuming a single recipient, and
`payoutMethod` / `paidAt` are per slot too, since one act may take cash on the night and
another a Venmo transfer the next morning. A slot may legitimately have `payoutCents: 0` —
an opener playing for the door split of nothing, or a band that declined payment — which is
different from `null`, meaning not yet settled.

### Reading ticket revenue

`ticketRevenueCents` is **read, not entered** — but not from where an earlier draft
claimed. That draft said it could be summed from `payment_cache` rows for the event's
tickets. It cannot, for two independent reasons:

- `paymentCache` in `src/lib/server/db/schema/finance.ts` has exactly one domain FK:
  `reservationId`. There is no event, purchase, or ticket link, so there is no way to ask
  it for a given show's revenue. Its `userId` is also `NOT NULL` referencing `user`, while
  ticket buyers are frequently guests with no account.
- **Ticket checkouts never write a `payment_cache` row at all.** The cache is populated in
  `finance/payment-service.ts` on the credits-cover-everything path;
  `handleTicketCheckout` only flips tickets `pending → valid`. The table would have been
  empty for every ticket ever sold.

The replacement reads Stripe directly at settle time: search PaymentIntents on
`metadata['event_id']`, sum `amount_received`, subtract refunds. This works because
`payment-service.ts` sets `payment_intent_data: { metadata: sessionMetadata }` for
`mode: 'payment'` checkouts (~line 264), so the ticket metadata lands on the PaymentIntent
as well as the Session. That distinction is load-bearing: Stripe cannot search Checkout
Sessions by metadata, but it can search PaymentIntents.

**One metadata key must be added.** Fee coverage is pushed as a _separate line item_
(`payment-service.ts` ~line 233 — a `feeProductId` line at `feeCents`), so the
PaymentIntent carries only a combined total and there is no way to tell tickets from fees
after the fact. Fee coverage is a pass-through to Stripe: it is not ticket revenue and
must not be split with the bands. So `src/lib/remote/events.remote.ts` adds
`ticket_subtotal_cents` to the ticket checkout metadata alongside the existing `type`,
`purchase_id`, `event_id`, and `ticket_quantity` (~line 900).

**Payments predating that key need reconstruction.** Only four combinations are possible,
and all four are computable:

| Price paid                   | Fees not covered       | Fees covered                                          |
| ---------------------------- | ---------------------- | ----------------------------------------------------- |
| Full `event.ticketPrice`     | `price × qty`          | `calculateTotalWithFeeCoverage(price × qty)`          |
| Sustaining-member half price | `round(price/2) × qty` | `calculateTotalWithFeeCoverage(round(price/2) × qty)` |

using `event.ticketPrice`, the `ticket_quantity` metadata, and
`calculateTotalWithFeeCoverage()` from `src/lib/finance/fees.ts` — the same helper the
checkout used. The sustaining-member price is `Math.round(unitPrice / 2)`, applied before
the line item is built. Match `amount_received` against those four exactly; flag anything
that doesn't match for manual review rather than guessing which it was. There is no coupon
to complicate the arithmetic: `purchaseTickets` passes no `eligibleCredits` to
`checkout()`, so the credit-discount coupon branch never fires for tickets.

**Do not add a local `ticket.pricePaidCents`.** Storing the amount on the ticket row is
the obvious shortcut and it reintroduces precisely the local ledger that
[finance-spec.md](shipped/finance-spec.md) removed. Stripe is the ledger; a second copy is a
second thing to reconcile.

**`ticket.stripePaymentRecordId` already exists**, added by the prerequisite fix above
rather than by this feature. It gives each ticket the same proof of payment every other
purchasable has, and it is what makes the Stripe search cross-checkable against local rows:
a PaymentIntent the search returns should have a matching ticket, and a ticket without one
should be a comp or a free RSVP. Settlement can flag either mismatch instead of silently
trusting one side.

### The snapshot

`production.ticketRevenueCents` remains on the table, but as a **settlement snapshot**: one
write at settle time, alongside `settledAt` and `settledByUserId`, recording what was
settled and on what figures. That is an audit record, not a ledger.

**The snapshot is the durable figure — Stripe is not re-read to reconstruct it.** A
settlement from two years ago reads its own snapshot, and edits since then are in the audit
log. Re-reading Stripe is always an explicit staff action against a live show, never an
implicit recompute of an old one. See [How far back Stripe can be
read](#how-far-back-stripe-can-be-read) for why that matters.

**Settlement must fail cleanly.** If the Stripe search errors, rate-limits, or pages
incompletely, the service must **not** write a partial snapshot — a settlement that
silently under-reports revenue pays the bands too little and nobody finds out. Model an
explicit "revenue could not be read" outcome: the transition to `settled` is refused, the
worksheet shows the failure, and staff can retry or enter the figure manually as
`otherRevenueCents` with a note.

Comps (`compCount`) come from `ticket` rows with no `stripePaymentRecordId`, once that
column exists.

### How far back Stripe can be read

An earlier draft worried that Stripe's search would age out and leave an old settlement
unreconstructable. Checking [Stripe's search
documentation](https://docs.stripe.com/search) shows the premise is wrong in one direction
and understated in another.

**There is no documented lookback limit.** Search has no date horizon and no historical
cutoff, so a bounded date window is not needed for that reason. The listed limitations are
about freshness and consistency, not age.

**But three real hazards are documented, and two of them are worse than staleness:**

| Limitation                                                                                                                                  | Why it matters at settle time                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| _"In rare cases, paginating through a result set can reorder some records, causing them to be missing or duplicated on a page."_            | This is a **correctness bug for a sum**. A duplicated PaymentIntent overstates revenue; a missing one understates it. Neither is visible in the total. |
| _"The Search API filters using a cached version of the PaymentIntent `status`, but returns data based on the latest version."_              | Filtering on `status:"succeeded"` can miss a payment that has since succeeded, or return one that hasn't.                                              |
| _"Under normal operating conditions, data is searchable in under 1 minute."_ Stripe explicitly says not to use search for read-after-write. | Settling minutes after the last door sale can miss it. Rate limit is 20 read ops/sec across all search endpoints.                                      |

So the design rule is not a date window — it is **don't depend on search for a number that
has to be right**:

1. **Sum from local rows, not from the search.** Every ticket now carries
   `stripePaymentRecordId` (see [Prerequisites](#prerequisites-two-fixes-both-landed)).
   Settlement walks the event's tickets, takes the **distinct** payment ids, and retrieves
   those PaymentIntents **by id**. Retrieval by id has none of search's caveats: no
   indexing lag, no pagination reordering, no status cache. Tickets in one purchase share a
   PaymentIntent, so the call count is purchases, not tickets.
2. **Search is the reconciliation, not the source.** Run it as a cross-check — a
   PaymentIntent the search returns with no matching ticket, or a ticket whose payment the
   retrieval can't find, is surfaced as a discrepancy for staff. This is the mismatch check
   already described above, now with the two sides the right way round.
3. **Search is also the backfill** for ticket purchases predating `stripePaymentRecordId`,
   where no local id exists. That set is finite and shrinks to nothing.
4. **Then snapshot**, and never recompute an old settlement implicitly.

The clean-failure rule stands and gets easier to honor: if retrieval fails or the
cross-check disagrees, refuse the transition to `settled` rather than writing a partial
snapshot.

### Door cash, and why Stripe never hears about it

`doorCashCents` is the counted drawer minus the float. `doorCount` is a staff-entered
headcount. These are the only manually entered revenue numbers in the system, and they
stay manual.

**Reporting the door take to Stripe was considered and rejected.** Stripe's Payment
Records API, which this app already uses via `reportPayment()` / `reportRefund()`, records
_incoming payments and refunds to the payer_. There is no expense object and no debit
object. The only mechanism Stripe offers for splitting revenue is Connect — every band a
connected account, plus an actual disbursement — which is far out of scope and doesn't
describe the transaction anyway: the Collective hands cash to a lead band who divides it
in the parking lot.

So reporting door income to Stripe would record the revenue with no way to record the
offsetting payout, inflating apparent revenue by exactly the band cut — the largest single
number in the whole settlement. finance-spec calls Stripe "the single view of all
revenue", and that is the right reading: **revenue**, not net income. Cash the Collective
takes in and immediately hands back out is not revenue it kept.

This restores the earlier spec's **No Stripe writes** boundary, now with a reason attached.
Settlement is strictly read-only against Stripe. Ticket refunds continue to go through the
existing event-cancellation path in `event-service.cancel()`.

### Getting the numbers out

`production.netCents` is useless sitting in a staff table. Settlement adds a **CSV export**
over settled productions — date, title, gross revenue, band pool, total expenses, net, and
payout method — so the debit side reaches whoever does the Collective's books. Without it
the app records the band cut and then loses it, which is worse than not recording it.

### Settlement stays editable, with an audit trail

Settling writes the snapshot and stamps `settledAt` / `settledByUserId`. **The money fields
stay editable afterwards**; every change is recorded rather than prevented.

An earlier draft froze them and required an explicit reopen that cleared the snapshot. That
is the right design for an organization with a finance team and a close process. For a
collective where the person who settled the show is the person who finds the error, a lock
mostly produces a ritual — reopen, fix, re-settle — that records less than simply logging
the edit would, because the intermediate states are gone by the end of it. A correction two
days later is normal here, not an exception to be gated.

So settlement edits are appended to the [staff audit log](audit-log-spec.md): actor,
timestamp, field, before, after. That gives the thing the freeze was actually protecting —
an answer to "who changed the band pool, and from what" — without the ceremony. The
production keeps its original `settledAt` / `settledByUserId`; the log carries everything
since.

Two consequences worth stating:

- **The snapshot is never silently recomputed.** Editing a money field changes that field
  and nothing else. Re-reading Stripe is an explicit action, because an automatic recompute
  would overwrite a deliberate manual correction with a machine's answer.
- **`closed` still means closed.** Once a production is `closed`, editing money reopens
  nothing and changes no status, but it is logged like any other edit. If that turns out to
  be too loose, the narrower rule is to require `closed → settled` first — but start
  permissive, since the audit log makes looseness recoverable and a lock does not make
  errors less likely.

---

## Close-out

The cleanup stage. Working the `closeout` checklist is the entire gate: the
`settled → closed` transition rejects while any `closeout` task is `done: false`, naming
the outstanding ones in the error. Incident notes go in `internalNotes` (a link to the
Incident & Safety Log idea if that ever lands). Closing stamps `closedAt` /
`closedByUserId` and drops the production out of the default staff list, which shows
active productions unless the closed filter is on.

---

## How a production feeds the rest of the app

- **`event`** — the parent. Created and owned by `/staff/events`; the production edits it
  through `event-service.update()` rather than writing `event` rows itself. Publish is
  gated on `confirmed`. Cancel routes through `event-service.cancel()` so ticket holders
  are notified by the existing listener and the reservation is released. The production
  reacts to the `event.cancelled` domain event, which the prerequisite fix made reliable
  for unticketed shows.
- **`reservation`** — created with the event (`bookerType: 'event'`, the existing
  polymorphic hook in `reservation.ts`, no enum change needed) covering doors→close, and
  widened to load-in→load-out by the production. Owned by `event-service` throughout; the
  production never calls `reservation-service.staffCreate()`. Conflict checking is the
  existing code, so a production cannot widen into an occupied room without an explicit
  override.
- **`ticket`** — unchanged apart from the checkout metadata, which gains
  `ticket_subtotal_cents`. Purchase, check-in, and refunds keep their current paths, and
  `stripePaymentRecordId` is already populated. Settlement only reads.
- **`band`** — external acts become claimable directory bands the moment someone accepts
  an owner invite, at which point their entire production history is already attached.
  Member bands see their booked shows on their band dashboard.
- **`venue`** — reusable across productions and, later, band events. Backline and load-in
  notes carry into the advance checklist.
- **Event bus** — `production.confirmed`, `production.slot_invited`,
  `production.cancelled`, `production.completed`, `production.settled` payloads added to
  `events/event-bus.ts`, with listeners registered in `events/register-listeners.ts`. The
  production also **listens** for `event.cancelled` so a show killed from the events side
  takes its production with it. All side effects stay idempotent, per the house rule.
- **Public event page** — once the event is published and the production is `confirmed`,
  `/events/[id]` can render the run of show: act names in order with set times, showing
  only slots in `confirmed` or `performed` status.

### The gig-guide attribution rule

**A production never writes an external act into `event.groupId`.** That column — renamed
from `event.bandId` by [groups-spec.md](groups-spec.md#events), where it marks who manages
an event rather than who is billed on it — stays for member-authored events
(`source: 'band'` or `'group'`); CMC lineups live entirely in `production_slot`.

Under the split this is **structural rather than a convention**: an external act is a band
profile with no group, so there is no group id to write. The rule can no longer be violated
by forgetting it. Co-billing on member events uses `event_group`, which productions do not
touch.

The earlier reasoning — that `listPublicCalendarEvents()` and `listPublicUpcomingEvents()`
left-join the band and emit a slug the public event page renders as a link, which would 404
for a hidden external act — is now moot for external acts specifically, since they have no
slug to emit. It still applies to **hidden member bands**, which do have slugs; see the
pre-existing hole in the audit below.

**The published run of show links out, never in.** Per
[groups-spec.md](groups-spec.md#an-external-act-has-no-page-anywhere), an external act has
no hosted page at all — not even an unlisted one — so a slot renders as:

- a link to `/directory/bands/[slug]` when the act is a member band and publicly visible;
- a link to the act's **own** URL, from `band_profile.links`, when it is unclaimed and has
  given one;
- plain text otherwise.

There is no case where an unclaimed act's name resolves to something CMC hosts, which is
what makes this safe by construction rather than by remembering to check visibility.

---

## Visibility audit

**Most of this audit dissolves under the band/group split.** It existed because external
acts lived in the same table as public bands, so every "is this band public?" filter had to
learn to exclude member-less rows. Now an external act is a `band_profile` with no group and
therefore no slug, so it is structurally unaddressable — there is no gate to add and none to
forget.

What remains is the set of **pre-existing holes this audit surfaced**, which are real
regardless of the split and are worth fixing while in the area:

| Location                                                   | Current gate                                                         | Status under the split                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `directory/directory-service.ts` — `bandWhereConditions()` | `deletedAt IS NULL` + `directoryVisibility`                          | **Resolved.** Listing joins `group`, so a profile with no group cannot appear. Single choke point for `listBands()` and `listPublicBands()`, which the sitemap also uses. The visibility column moved to `directory_entry.visibility` in phase 3a, not to `group` as this row once said. |
| `remote/directory.remote.ts` — `loadBandProfile()`         | slug + `deletedAt IS NULL`, then `isBandProfileHidden()`             | **Resolved.** The route key is a group slug, and a group-less profile has none, so `/directory/bands/[slug]` cannot resolve to a stub.                                                                                                                                                   |
| `remote/band-site.remote.ts` — `getBandSiteData()`         | `deletedAt IS NULL` + `tier === 'premium'` **only**                  | **Still open.** No visibility check at all, so a hidden band with premium tier renders a full public microsite. Add the visibility check alongside the tier check.                                                                                                                       |
| `event-service.ts` — public calendar queries               | `event.status = 'published'` + source flag; no band visibility check | **Still open.** A hidden member band's published event leaks its name and a 404ing profile link. Fixing it means gating the emitted slug on `directory_entry.visibility`.                                                                                                                |

The guard the earlier draft proposed — an `EXISTS` against `band_member` for an active owner
— is no longer needed anywhere. "Has a group" is a nullable column on the row already being
selected, and in the two resolved cases above it is not even an explicit condition, just a
consequence of joining `group` to get the slug.

Belt and braces is also no longer required. The earlier draft noted that
`directoryVisibility` defaults to `'public'` and `create()` never sets it, so the
external-create path had to remember to pass `'hidden'`. A group-less profile has no public
surface to be visible _on_, so forgetting is no longer possible — the default is harmless.
Visibility becomes meaningful only once a group exists, which is exactly when someone is
there to choose it.

One more cleanup while in the area: `requireStaffOrOwner()` in `authorization.ts` has
zero callers. It is safe today, but it compares `userId === ownerId` after guarding only
`userId`, which becomes a trap the moment anyone passes an optional owner. Delete it, or
guard `ownerId` too.

---

## Module boundaries

### Inside the production domain

`src/lib/server/production/`:

- `production-service.ts` — create, update, status transitions, queries
- `slot-service.ts` — lineup CRUD, fractional reorder, per-slot status
- `set-times.ts` — pure `computeSetTimes()` and its validation warnings
- `settlement-service.ts` — Stripe revenue read, totals, snapshot, audited edits, CSV export
- `task-service.ts` — checklist CRUD and template seeding
- `errors.ts` additions — `ProductionNotFoundError`, `InvalidProductionTransitionError`,
  `CloseoutIncompleteError`, `RevenueUnavailableError`, extending the `DomainError` base

`src/lib/server/venue/venue-service.ts` — venue CRUD, kept separate because venues
outlive any one production.

### Integration points

- `event/event-service.ts` — `update()`, `publish()`, `cancel()`, `checkRebookNeeded()`,
  all reused, not reimplemented. The production reaches the reservation only through here.
- `reservation/reservation-service.ts` — a new `adjustWindow()`, called via
  `event-service`; never called directly by the production
- `band/band-service.ts` — `create()` extended so an external act can be created as a
  profile with no group
- `group/group-service.ts` — `claimBandProfile()`, which creates the group and moves the
  act's identity onto it
- `group/invite-service.ts` — `createInvite()` with `role: 'owner'` for claims
- `ticket/ticket-service.ts` — read-only, for counts and comps
- `finance/payment-service.ts` and the Stripe client — a read-only PaymentIntent search at
  settle time. Note that `finance/payment-cache-service.ts` is **not** an integration
  point; see Settlement for why.
- `events/event-bus.ts` — new `production.*` payloads, plus an `event.cancelled` listener

### What doesn't touch productions

Membership and credits, equipment loans, email marketing, and the support inbox. A
production books a room but does not spend free hours; a band borrowing an amp for a show
still goes through the normal loan flow.

---

## Schema

Five new tables — `production`, `production_slot`, `production_task`,
`production_expense`, `venue` — plus column changes on three existing ones:

```
band_profile (changes)
  ownerId       DROPPED
  name          UNIQUE dropped (nullable — see groups-spec.md)

group_member (addition)
  partial unique index on (groupId) where role = 'owner'

event (additions)
  venueId       uuid? references venue(id) on delete set null
  index on (venueId)
```

`ticket.stripePaymentRecordId` is not listed above because it already exists — see
Prerequisites. This feature reads it; it does not add it.

Indexes on the new tables:

- `production` — unique on `eventId`; index on `(status, createdAt)`
- `production_slot` — index on `(productionId, sortOrder)`; index on `bandProfileId`
- `production_task` — index on `(productionId, phase)`
- `production_expense` — index on `productionId`
- `venue` — unique on `slug`; index on `slug`

Checks: `production_slot.setLengthMinutes > 0`, `changeoverMinutes >= 0`,
`production.bandSplitPercent between 0 and 100`, `production_expense.amountCents >= 0`.

Enum tuples and the task templates go in `src/lib/config.ts` alongside the equipment and
inbox tuples; zod form schemas sit next to their tables, following the house convention.

Per CLAUDE.md, migrations are generated with `pnpm db:generate`, not written here.
Everything except the `band` changes is additive — `CREATE TABLE` plus
`ALTER TABLE ADD COLUMN`. Dropping `ownerId` and the inline `UNIQUE` on `name` forces a
full `band` rebuild, which `pnpm db:generate` makes D1-safe automatically; see "Bands,
extended to cover external acts" above and
[table rebuilds on D1](../development/conventions.md#table-rebuilds-on-d1). Both changes
land in that one rebuild, applied and verified before the productions tables.

---

## Staff UI

Everything follows [ui-patterns.md](../development/ui-patterns.md): `PageHeader` outside
`PageContent`, `Form`/`FormField`/`SubmitButton` for every form with no raw inputs,
`Action` for row actions, `DataTable` with a `Filter.*` toolbar, and create flows in a
modal on the list page rather than a `/new` route.

- **`/staff/events/[id]`** — gains an "Add production" action when the `productions` flag
  is on and the event has none. This is the only way a production comes into existence.
- **`/staff/productions`** — `DataTable` of productions with date, title, venue, status,
  lineup summary, and settlement state. Filters for status, venue, and date range, plus
  the settlement CSV export.
- **`/staff/productions/[id]`** — `PageHeader` with the status badge and the transition
  action, then a `TabBar`:
  - **Overview** — a summary of the parent event's public fields with a link back to
    `/staff/events/[id]` for editing them, plus producer, ops timestamps, and internal
    notes.
  - **Run of show** — ordered slot list with inline add, drag reorder, and per-slot edit
    in an `Action` form modal. Set times are displayed, never edited.
  - **Advance** — the `advance` and `day_of` checklists, with rider/stage-plot links
    pulled from each member band's EPK.
  - **Settlement** — the worksheet, expense table, per-slot payout rows, the band pool
    against the sum of payouts, and the settle action.
  - **Close-out** — the `closeout` checklist and the close action.
- **`/staff/venues`** and **`/staff/venues/[id]`** — venue CRUD, same shape as
  `/staff/inventory`.

Remote functions go in `src/lib/remote/productions.remote.ts` and
`src/lib/remote/venues.remote.ts` — `query()` for reads, `form()`/`command()` for writes,
thin over the services.

> **Doc drift worth fixing:** CLAUDE.md and ui-patterns.md both describe colocated
> `data.remote.ts` files. No route in the app uses that — remote functions were
> centralized into `src/lib/remote/*.remote.ts`, and only one `+page.server.ts` remains in
> the whole codebase. This spec follows the code.

`StatusBadge`'s class map currently covers `draft`, `confirmed`, `completed`, `cancelled`,
and `pending`. It needs `offered`, `settled`, `closed`, `invited`, `declined`, and
`performed` added.

---

## Public surface

No new public routes. `/events/[id]` gains an optional lineup section — act names in
running order with set times — rendered when the event is published, the production is
`confirmed` or later, and at least one slot is `confirmed`. Act names link to
`/directory/bands/[slug]` for publicly visible member bands, to the act's own URL for
unclaimed acts that have given one, and render as plain text otherwise — see
[The gig-guide attribution rule](#the-gig-guide-attribution-rule).

---

## Notifications

New entries in the `NOTIFICATION_TYPES` registry in `db/schema/notification.ts`, all
defaulting to in-app plus email for staff:

| Key                           | Trigger                                              | Recipient                         |
| ----------------------------- | ---------------------------------------------------- | --------------------------------- |
| `production_slot_invited`     | A member band is added to a lineup and offers go out | Band admins                       |
| `production_confirmed`        | Production reaches `confirmed`                       | Band admins of confirmed slots    |
| `production_advance_due`      | 7 days before the show with open `advance` tasks     | Producer                          |
| `production_settlement_ready` | Production reaches `completed`                       | Producer and staff                |
| `production_cancelled`        | Production cancelled                                 | Band admins of non-declined slots |

Four of these fire from domain events. `production_advance_due` is the exception: it is a
time-based sweep with no triggering action, so it needs a cron job — which the earlier
draft listed the notification without. Add `/api/cron/production-advance-due` to the daily
`0 16 * * *` group in `src/lib/server/cron/schedule.ts`, after the reservation reminders.
A once-a-day check is the right cadence for a seven-days-out warning, and the daily group
is already where every other "remind somebody about a future date" job lives. (`schedule.ts`
has three groups — `*/5`, `*/15`, and daily. `/api/cron/auto-complete` sits in the `*/15`
group; there is no hourly trigger, and a seven-day lookahead would not want one.) The job
must be idempotent per production per day, like every other job in that map.

External acts have no user account, so they receive nothing in-app. Emailing them from
their `directoryContact` is deferred.

---

## Permissions

Staff-only for everything that edits a production — every mutating remote function calls
`requireStaff()`, and every staff route calls `requireFeature('productions')`.

**One read-only band-facing surface: the terms summary.** A booked act should be able to
see the deal it agreed to without emailing a producer, so a member band whose group holds a
`production_slot` sees, in its own panel:

| Shown                                                                              | Not shown                                            |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Date, venue, set time and length, billing position                                 | Other acts' guarantees or payouts                    |
| Load-in, soundcheck, curfew                                                        | Expenses, door cash, net, or any whole-show total    |
| `bandSplitPercent` — the deal on offer                                             | `bandPoolCents` before it is settled                 |
| Its **own** `guaranteeCents`, `payoutCents`, `payoutMethod`, `paidAt` once settled | Internal notes, checklists, anything on `production` |

This is what makes a per-show `bandSplitPercent` safe to allow: the number is visible to the
party it affects, before the show rather than after. A split that looks wrong gets
questioned by the band, which is a better check than any warning banner on a staff
worksheet.

It is a read surface only — a band cannot accept, decline, or edit a slot here. Slot
invitations and responses remain out of scope for this phase, and unclaimed touring acts see
nothing at all, since they have no panel; their terms travel by email as they do today.

`'productions'` is added to the `FeatureFlag` union and `ALL_FLAGS` in
`src/lib/server/feature-flags.ts`, defaulting off like every other flag.

---

## What changes

- Five new tables; `event.venueId` added; `band.ownerId` and the `UNIQUE` on `band.name`
  both dropped in a single table rebuild, landed as its own migration.
- A partial unique index on `group_member (groupId) WHERE role = 'owner'` becomes the sole
  definition of ownership.
- `band-service.ts`'s three owner `innerJoin`s become left joins through `bandMember`;
  `deleteBand`/`deactivate` attribute reservation cancellations to the acting staff
  member; `transferOwnership()` drops its third batch statement and resolves the current
  owner from `bandMember`.
- `purgeUser()`, `BandLayoutResponse`, `band-site.remote.ts`, `bands.remote.ts`,
  `seed-dev.ts`, and `migrate-from-postgres.ts` stop referencing `ownerId`.
- The ticket checkout metadata in `events.remote.ts` gains `ticket_subtotal_cents`.
- `reservation-service` gains `adjustWindow()` so widening a window doesn't re-issue the
  reservation or its lock code.
- `directory-service.bandWhereConditions()`, `loadBandProfile()`, and `getBandSiteData()`
  gain owner-membership and visibility guards.
- `StatusBadge` learns six new statuses.
- New `productions` feature flag; new staff nav entries for Productions and Venues; a new
  daily cron job for the advance-due warning.

## What doesn't change

- The `event` table's public shape and every existing event query. Events are still
  created at `/staff/events`.
- Ticket purchase, check-in, and refunds — beyond recording the payment intent that should
  already have been recorded.
- The reservation lifecycle, conflict checking, and the recurring generation job.
- Band membership, roles, invitations, and premium microsites. Claiming an act is an
  ordinary owner invite.
- Stripe integration — no new checkout paths, no payouts, no new webhook handlers, and no
  writes of any kind from settlement.
- `event.location`, which remains the free-text fallback for band events.

## Deferred

- **A real box office.** Cash ticket sales recorded as `ticket` rows at the door would
  make `doorCashCents` and `doorCount` derived rather than entered, and would unify both
  sales channels behind one query. It needs a device, a workflow, and a
  float-reconciliation story, so it is not this phase — but the schema above is
  deliberately compatible with it.
- **An accounting integration** for a true P&L. The CSV export is the stopgap; a real
  ledger integration is where net income actually belongs.
- **Multi-night runs and festivals.** The 1:1 production↔event rule makes a two-night
  booking two productions. Relaxing to 1:N is a schema change, not a rewrite — drop the
  unique on `eventId`.
- **Public booking inquiries.** The IDEAS.md "Booking Request Pipeline" front door: a
  public form that lands as a `draft` event with a production attached. Staff-created
  productions come first.
- **Recurring productions.** Weekly open mics could expand through the existing
  `recurring_series` machinery, but the lineup makes each occurrence genuinely different.
- **Stage-plot drawing.** Uploading a rider image is in scope; a canvas plot builder is
  not.
- **Emailing external acts** and threading those replies into the staff inbox.
- **Automated payouts.** Recording what was paid is in scope; disbursing through Stripe
  is not — see the door-cash reasoning above for why Connect is the only mechanism Stripe
  offers and why it doesn't fit.
- **Volunteer and staffing assignment** per production. The volunteering module now has
  `volunteer_shift` (optionally attached to an `event`), so the primitive exists —
  per-production staffing waits only on Productions itself.
- **ASCAP/BMI setlist reporting**, which would need per-song data below the slot level.

## Decisions that were open

1. **A claimed act keeps its production history public.** Claiming a profile and setting
   `directory_entry.visibility` to `'public'` retroactively exposes every past production the
   act played, and that is the intent — it is a gig history, and a gig history with holes
   in it is worth less than none. No per-production visibility flag, and no prompt at claim
   time.
2. **No `createdBy` on `band_profile`.** Staff create touring-act records, so "who stubbed
   this?" has a narrow enough answer set that a dedicated column is not worth carrying.
   When it does need answering, it belongs in the [staff audit log](audit-log-spec.md)
   alongside every other staff action, not as a one-off column on one table. This also
   keeps the `band_profile` rebuild smaller.
3. **`venue.isPrimary` stays a column.** A KV config key naming the primary venue id would
   be stricter, but reading it costs a second request on a path that has already loaded the
   venue row. The column allows more than one primary venue if the Collective ever runs a
   second room, which is the likelier future than needing the constraint.
4. **`day_of` is a real phase.** It is the pre-show walkthrough — set house gear, check
   concessions stock, clean the bathrooms, float, doors, soundcheck — and it belongs to
   whoever is on shift rather than whoever produced the show. See the checklist templates
   above for why merging it into `advance` was rejected.
5. **Settlement stays editable, with an audit trail**, rather than freezing on `settled`.
   See [Settlement stays editable](#settlement-stays-editable-with-an-audit-trail).
6. **Stripe search has no lookback limit — but it is the wrong tool for the sum anyway.**
   Checking the documentation showed the original worry was misdirected: there is no date
   horizon, but pagination can reorder records into duplicates or omissions, which is a
   correctness bug for a total. Settlement sums from local `stripePaymentRecordId` values
   retrieved by id, uses search only for cross-checking and for pre-column backfill, and
   never implicitly recomputes an old settlement. See
   [How far back Stripe can be read](#how-far-back-stripe-can-be-read).
7. **`bandSplitPercent` is per-show and staff-editable**, defaulting to 70, with the value
   surfaced in the band-facing terms summary. The protection against a wrong split is
   visibility to the affected party, not immutability.
8. **The band pool is allocated across slots.** There is no lead band in the model:
   `payoutCents` is per `production_slot`, and the only rule is that the rows sum to
   `bandPoolCents`. One act collecting for everyone is a single row, not a special case.

## Open questions

None — all decisions have been made.
