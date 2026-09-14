# Committees and roles

## Purpose

The Collective has adopted a committee structure — six committees, each with a chair, sitting
between a board that approves the frame and a volunteer pool that works the shifts. It is
written down in an internal proposal that describes duties: who keeps the roster of acts, who
answers the inbox, who holds the keys, who counts the till.

The app knows none of it. There is no committee anywhere in the staff panel, no way to say
"this is Booking's problem", and no page a new Communications member can open to see what
their committee is responsible for. What the app has instead is a set of capabilities that
happen to cover a lot of those duties — volunteering, inventory, marketing, the inbox,
reservations — organized by _feature_, because that is how they were built, one at a time.

Those two organizations are orthogonal, and nobody has laid one over the other. So a chair
asking "can the website do this for us?" has to read eleven specs to find out, and the answer
for any given duty is one of four different things: it already works, it half works, it is
designed and unbuilt, or nothing has ever considered it.

This document is that overlay. It restates each committee's duties as stories about what a
person needs the website to do, and marks each one with what actually serves it today. It is
not a build plan — several of these stories are years apart in priority, and a few should
never be built at all. It is the map that makes prioritizing them possible.

The source is the internal **CMC Committees and Roles** proposal, Part 4 (the six committees
and the chair role) and sections 5.3–5.11 (the event and program roles). That document defines
duties and does not define policy; this one defines neither, and only says what software would
have to exist.

---

## Re-checked 2026-09-13

The markers below were set on 5 September. **Eighteen are now wrong, all in the good
direction**, and each is corrected in place with a ⏫ rather than by rewriting the story — the
original reading is what makes the correction legible. Five of the eighteen are partial, marked
**Split**: the half that shipped and the half still owed were one marker and are now two.

Two corrections are structural rather than per-story, and both change what this document asks
for next:

- **[The authority problem](#the-authority-problem) is no longer the problem it describes.**
  `capabilities`, `Capability` and six named positions are in `src/lib/config.ts`, guards call
  `requireCapability`, and the staff nav filters rows by it. "Programming may edit events but
  not payments" is now expressible. What is still missing is the committee-scoped guard this
  document asks for on top of that — see the ⏫ in that section.
- **Every ⏫ in [Chairs](#chairs) is a groups phase that landed.** `groups-spec.md` now reports
  all eleven phases shipped, so `by_application`, announcements and documents are built, and
  the four chair stories that were blocked on them are served.

Not re-checked: the ~40 🆕 stories with no linked spec. A 🆕 here means "nothing covered this on
5 September", which for an unstarted feature is still true, but it was not re-verified.

---

## What a committee is in this app

**A committee is a `group` with `joinPolicy = 'by_application'`. The committee volunteer roles
retire.**

The word means two unrelated things in the codebase today, with no key between them:

- `groupKinds = ['band', 'club', 'committee']` — [src/lib/config.ts](../../src/lib/config.ts).
  A committee is a `group` row with a roster (`group_member`) and — once phases 7 and 8 of
  [groups-spec.md](shipped/groups-spec.md) land — announcements and shared documents. Staff-created
  only, which is what makes free room time safe to grant by kind. The roster is live today;
  everything hanging off it is designed and unbuilt.
- `volunteerRoleGroups = ['at-shows', 'away-from-shows', 'committee']` — same file. A
  presentational bucket on the `/contribute` role picker, holding rows like "Booking
  Committee" from [scripts/seed-volunteer-roles.ts](../../scripts/seed-volunteer-roles.ts).
  Nothing branches on it, and the volunteering spec is explicit that a `volunteer_role` grants
  nothing at all.

An earlier draft of this section kept both and made the volunteer role a recruiting funnel into
the group. That is one join table and one chair-facing queue to build, and it leaves two rows
named "Booking Committee" in unrelated tables forever — a trap somebody eventually falls
into.

> ⏫ **Done 2026-09-14.** The `committee` bucket is gone from `volunteerRoleGroups`, the six
> roles that shadowed the committees are **archived rather than deleted** — four hour logs point
> at two of them, and retiring a role does not un-happen the work done under it — and their 26
> interest rows became 9 committee applications. The six committees exist as headless `group`
> rows. `/contribute` now sends people to apply rather than to a shift signup.
>
> One correction to the paragraph below: the funnel was not deleted so much as **replaced**, and
> not by `by_application` — see the reversal of decision 9.

**`by_application` deletes the funnel instead of building it.** A committee group publishes
itself, a member applies from its own page, and a chair approves — `group_member.status` moves
`requested → active` and the roster is the only record. Interest and membership stop being two
objects.

This is not a new idea imported here; [groups-spec.md](shipped/groups-spec.md) already names the
motivating case in almost these words — the policy exists for "the program that wants everyone
to be able to _find_ it but not everyone to be in it — **a committee with a seat count**, a
workshop with a skill floor." The committee structure is what that sentence was written for.

What it costs, all of it already on the groups roadmap:

- **`by_application` is designed and unbuilt.** It needs the `'requested'` value on
  `group_member.status` and the club page that renders an Apply button — phase 5.
- **Two roster reads are status-blind** and must change in the same PR as the enum value.
  `listForUser` and `getMembers` in `band-service.ts` do not filter on status at all, so a
  `'requested'` row falls into neither the pending nor the active bucket and **disappears**,
  which is a fail-quiet a reviewer cannot see. `groups-spec.md` flags this as a known defect;
  it becomes load-bearing the moment committees use applications.
- **Retirement has a paper trail.** The `committee` value in `volunteerRoleGroups`, its label,
  the seeded committee roles, and the "Committees" bullet in
  [manual/public/ways-to-contribute.md](../manual/public/ways-to-contribute.md) all go
  together. Existing `volunteer_role_interest` rows against those roles are the first
  applications and should be migrated, not dropped — they are people who already put their hand
  up.

---

## The authority problem

**Committee membership grants nothing, and cannot be made to grant anything today.** Every
story below that involves acting on organization-wide data collapses into "be staff", and the
document says so rather than pretending otherwise.

The state of authorization, as of this writing:

- `requireStaff()` is `hasAnyRole(userId, ['admin', 'staff'])`
  ([src/lib/server/authorization.ts](../../src/lib/server/authorization.ts)). Holding `admin`
  conveys nothing `staff` does not — see [admin-vs-staff-spec.md](admin-vs-staff-spec.md),
  which opens on exactly this.
- The `permissions`, `model_has_permissions` and `role_has_permissions` tables are inert,
  carried over from a deleted Postgres ETL and read by no application code. The schema file
  says not to build on them.
- The seeded `volunteer` auth role is checked nowhere.
- `group_member.role` (`owner | admin | member`) is real, but only read inside a group's own
  pages. `group_member.position` — free text, "Treasurer", "Bass" — is read by nothing.

So "Booking may edit events but not payments" is not a permission this app can express.
Anyone handed the panel to do committee work today gets the whole panel, including account
purges and credit adjustments. That is a policy the Collective has not chosen; it is a
consequence of there being one door.

> ⏫ **2026-09-13: the four bullets above are all out of date, and so is this paragraph.**
> `capabilities` maps each resource to its actions and `Capability` is the `"user.purge"` string
> a guard names; `positionLabels` declares six positions with per-resource grants, and
> `adminOnlyCapabilities` names what belongs to nobody's job description — `credit.adjust`
> among them. `requireCapability` is the guard, and `staffNavSections` gates every row on one,
> so a treasurer is no longer offered Volunteering. The inert `permissions` tables are still
> inert, and `group_member.position` is still read by nothing — which
> [decision 10](#decisions-that-were-open) says is correct.
>
> **What this section asks for beyond that is unchanged and unbuilt**: a
> `requireCommitteeRole('programming')` reading `group_member` for a `kind = 'committee'`
> group, resolving the committee from the thing being acted on and composing with staff. The
> capability layer is the vocabulary that guard would speak; it is not the guard.

**This document does not solve it, and the structure it describes requires it solved.**
Committee members are to be **empowered to act within their own domain** — that is the settled
intent, not an assumption this document made for convenience.

An earlier draft of this section called [admin-vs-staff-spec.md](admin-vs-staff-spec.md) a hard
prerequisite. **That was wrong**, and the correction matters: a committee guard reads
`group_member`, not the role table, so the two are independent. The true relationship is more
useful — committees _relieve_ the pressure that motivated that spec, because they stop panel
access being the thing you hand someone for a mundane reason, which was its stated failure
mode. That spec has since been rewritten around the same insight this one reached: roles are
org positions, and guards should name capabilities rather than roles.

One requirement this document adds to that spec, not in it today:

**Committee-scoped authority.** A guard shaped like `requireCommitteeRole('programming')`,
reading `group_member` for a `kind = 'committee'` group. Every ✅ and 🔧 story below currently
means "staff can do this"; committee scoping is what turns them into "the right people can do
this". Two properties it needs that `requireStaff()` does not have: it resolves a committee
from the thing being acted on rather than from a route param, and it must compose with staff —
staff can always act, because somebody has to be able to cover.

**A chair is a group `admin`, not an `owner`.** The chair is first among equals: they run the
meeting, keep the notes moving, and report — they do not wield authority the rest of the
committee lacks, and the board appoints and removes them. `owner` carries transfer and delete,
neither of which belongs to that role, and `groups-spec.md` already makes deleting a committee
staff-only for the same reason.

Two things follow, both deliberate:

- **A chair and their deputy are indistinguishable in the data**, because under first-among-
  equals there is nothing to distinguish. "Who chairs Booking" is answered by
  `group_member.position`, which is a label, not a permission.
- **A committee is normally unowned**, and that is legal rather than a gap.
  [groups-spec.md](shipped/groups-spec.md) says so directly — "a group with no owner is legal", a normal
  transient state for a program between leaders — and the unique index caps a group at one owner
  without requiring one. The column that would have forced the question, `group.ownerId`, is
  dropped by that spec anyway. Admins keep working while the seat is empty; the owner-exclusive
  actions are transferring ownership and deleting the group, and for a committee both belong to
  staff already.

---

## Admin CRUD is not a workflow

**The committees are meant to become the app's organizing principle, not a permission overlay on
the one it has.**

The staff panel is filed by entity: Users, Bands, Reservations, Events, Inventory, Payments,
Credits. That is the shape of the database, and it was the right shape to build first — every
row has to be reachable before anything can be made pleasant. It is not the shape of anybody's
job. No committee's work is "the event table"; Booking's work runs across `event`,
`production_slot`, `directory_entry`, `reservation` and `work_order`, and there is no page
in the panel called booking.

So "what is a committee's domain?" is not first a question about which tables it may write. It
is a question about **what surface its work is done on**, and the permission boundary follows
that surface rather than the other way round. A committee-scoped guard over CRUD pages would
just be the same admin panel with parts greyed out.

**This changes how the markers below should be read.** ✅ means the data exists and there is a
surface that reaches it. It does not mean the surface is shaped like the work. The difference is
visible in two stories that are both marked served:

- Assigning an engineer to a show **is** a workflow. The Volunteer Shifts card sits on the event,
  knows the event, and prefills the times from doors — you are staffing a show, not creating a
  `work_order` row.
- Acquiring equipment another committee asked for is **CRUD**. The inventory catalog holds
  everything needed and there is no requisition in it: no request, no requester, no decision, no
  "this is what Production asked for in March".

Read that way, most of the 🆕 list is not missing tables. It is missing workflows over tables
that already exist — which is a far better position to be in than it looks from the count, and
is the reason this document is worth having at all.

---

## How to read the stories

Each story is what a person needs, followed by one line naming what serves it.

**Status legend:** ✅ Served today · 🔧 Partly served · 📋 Designed, not built (spec linked) ·
🆕 Nothing covers this

🔧 and 🆕 are not a backlog. Several are deliberate non-goals — a poster route is a paper map
and a spreadsheet, and putting it in the app would be worse than leaving it alone. The marker
says what exists, not what should — and per
[Admin CRUD is not a workflow](#admin-crud-is-not-a-workflow), a ✅ can still be an unpleasant
way to do the job.

---

## Stories

### Booking

Decides what the Collective spends its resources on, and plans it.

**As Booking**, I want a roster of acts carrying contact details, what they've played, and
what they drew, so booking the next bill starts from what happened rather than from memory.
🔧 `directory_entry` is the member-facing listing; [production-workflow-spec.md](production-workflow-spec.md)
adds a profile for a touring act with no account, and gig history falls out of past slots.
Draw is not recorded anywhere, and neither is scouting — acts noticed locally or regionally, and
the relationships with bookers in nearby towns that turn up new ones.

**As Booking**, I want to record that an act was asked and never answered, or said no and
why, so the same act is not chased three times in a season.
🆕 Nothing models an offer that did not become a show. `Booking Request Pipeline` in
[the `enhancement` issues](https://github.com/corvmc/corvmc.org/issues?q=is%3Aissue+label%3Aenhancement) is the inbound half; this is the outbound half.

**As Booking**, I want submissions from acts to arrive somewhere I can work through rather
than in a personal inbox.
🔧 `/staff/inbox` receives the contact form and threads replies. It is a general inbox with no
booking state on a thread.

**As Booking**, I want to build a bill — acts in billing order, set lengths, a run of show
— and have set times follow from it.
~~📋~~ ⏫ **✅ since.** `production_slot` carries `sortOrder`, `setLengthMinutes` and
`changeoverMinutes`; `run-of-show-service.ts` and six remotes edit the bill, and
`run-of-show.ts` computes each start from the walk rather than storing it — the no-override
rule as designed. The console is `/staff/events/[id]/production`.

**As Booking**, I want each act's terms recorded — guarantee, door split, or a donated
night — and visible to the act before the show.
~~📋~~ ⏫ **Split.** ✅ Recorded: `production_slot` carries `guaranteeCents`, `percentageBps`,
`versus`, `againstNet` and `contributed` — the donated night is that last flag — and
`setRunOfShowTerms` writes them. 🆕 **Visible to the act is not built**: nothing under
`src/routes/band/` reads any of it, so the terms summary in the band's own panel is still
owed. What we offer in return for a donated night remains unmodeled.

**As Booking**, I want to advance a show — set times, backline, hospitality, load-in — off
a checklist rather than a group chat.
📋 `production_task`, seeded from templates per phase (`advance`, `day_of`, `close_out`), and
a production cannot close with unfinished close-out tasks.

**As Booking**, I want to cancel a show and put a replacement in its place without losing
the listing.
✅ A cancelled event stays on the gig guide marked cancelled rather than vanishing. 📋 Swapping
one act for another within a bill is a slot edit.

**As Booking**, I want to appoint an event lead to a specific event and have them receive
the roster, the terms, and the format's rules.
🆕 There is no event-lead concept. `event.createdByUserId` is the nearest column and means
something else. See [Event and program roles](#event-and-program-roles).

**As Booking**, I want to receive a proposal for a club, class, jam or workshop and decide
whether it runs.
🔧 The `suggestion` board takes member ideas and gives staff a response and a status, but it is
a public upvote board, not an application with terms.

**As Booking**, I want to appoint a program lead for a recurring program, replace them when
someone steps back, and end a program that has stopped meeting.
🔧 A program is a `group` with `kind = 'club'` and its lead is the owner row; staff can
reassign a club's leader without the outgoing leader's participation, and `deactivate()` ends a
program while keeping its documents and roster as the record. ~~Blocked on `/staff/groups`,
which is where a club comes into existence and is not built yet.~~ ⏫ **✅ since:**
`/staff/groups` and its `CreateGroupAction` are built, and appoint the leader in the same step.

**As Booking**, I want a program's standing slot held on the practice calendar and its
details published on the site.
✅ `recurring_series` holds a repeating reservation; the listing is `/staff/events`.

**As Booking**, I want a booking cutoff that the calendar actually enforces.
🆕 No deadline concept on an event or a series.

**As Booking**, I want to record how an act was to work with after the show, against the
act.
🆕 Nothing carries a post-show note back to the roster.

---

### Production

Coordinates the equipment and people that make an event happen, and grows the pool who can do
it.

**As Production**, I want an engineer assigned to every event, and to see which upcoming events
have nobody on them.
✅ `work_order` attaches to an `event`; `/staff/events/[id]/production` carries a Volunteer
Shifts card showing needed-vs-claimed with the event locked in and times prefilled from doors,
and `/staff/volunteer/roles` badges unfilled shift counts per role.

**As Production**, I want only people cleared on the desk to be able to claim a desk shift, and
to see who is cleared for what.
✅ Certifications gate claiming, checked as of the shift's date rather than today, and a member
who cannot claim sees the missing clearance by name. `/staff/volunteer/certifications` and
`/staff/volunteer/clearances`. Held certifications are append-only, so "was their card current
on the night they worked?" stays answerable.

**As Production**, I want to teach a volunteer on a live shift by putting a trainee alongside
the engineer.
🔧 A shift with capacity 2 holds both bodies. Nothing distinguishes the trainee from the
supervisor, so neither the roster nor the certification record knows a training happened.

**As Production**, I want stage plots and input lists from the acts before load-in, and to flag
what the room cannot do.
~~📋~~ ⏫ **✅ since** for both halves: `/band/[slug]/rider` collects the rider and
`production_slot` carries `techNotes` and `backlineNeeds`, edited from the run-of-show panel.
🆕 Matching a rider against the equipment catalog is explicitly out of that spec — it is `Tech Rider Management` in
[the `enhancement` issues](https://github.com/corvmc/corvmc.org/issues?q=is%3Aissue+label%3Aenhancement).

**As Production**, I want the show-day tech schedule — soundcheck, doors, changeovers — to come
from the lineup rather than a separate document.
⏫ **Split.** ✅ Derived set times are built (`run-of-show.ts`), alongside per-slot
`soundcheckAt` and the production's own `loadInAt` / `soundcheckAt` / `curfewAt`. 📋 The
`day_of` task phase is not: **there is no `production_task` table**, and the phase exists
precisely because the pre-show walkthrough belongs to whoever is on shift rather than whoever
booked the show.

**As Production**, I want to lend a band a piece of backline for the night and know it came
back.
✅ `inventory_loan` — checkout, due date, condition at both ends, overdue chasing.
`/staff/inventory/loans`.

**As Production**, I want to say what gear we need to buy and why, and report gear that is
broken or about to fail.
✅ `/staff/inventory/restock` and `/staff/inventory/spend`, `acquisition` and `stock_movement`,
with condition tracked per `inventory_asset`.

**As Production**, I want the offsite event kit to be a thing I can check in and out as a unit.
🔧 `inventory_location` can name the kit; there is no kit-as-a-unit checkout.

**As Production**, I want to run a recording session — capture, file custody, backups, a signed
release before we use anything, and a handoff to whoever mixes it.
🆕 Nothing covers session management; `media` stores finished files and is not that. 🔧 The
release is the tractable part: a per-person standing release attaches to the member through
`media_attachment` with `attachableType: 'user'`. A release for _this recording_ is per-work
rather than per-person, and a session is not an entity yet, so it has nothing to hang on.

---

### Development

Money, rooms, and partners.

**As Development**, I want to decide how each event makes money and set its pricing.
✅ Ticketing lives on the event, with member discounts and guest checkout. ~~📋~~ ⏫ **🔧
since:** `settlement-service.ts` reads a settlement and `production_expense` records what the
show cost, but **nothing settles** — no payout columns on a slot, no door cash, no close-out.
See #1133.

**As Development**, I want to run the membership program and see who has lapsed, failed, or
not renewed.
✅ Stripe is the ledger, `payment_cache` the local read model, `/staff/payments` the surface,
and a cron syncs subscription status.

**As Development**, I want to confirm monthly that signups on the site and active subscriptions
agree.
🔧 The sync cron keeps them from drifting silently; there is no reconciliation view that shows
a human the two counts side by side.

**As Development**, I want to report membership numbers — active, new, cancelled, failed to
renew — to the board at every meeting.
~~🆕~~ ⏫ **✅ since.** `/staff/reports` takes any date range, so "every meeting" and "every
year" are the same page — earned, spent, in-kind and pass-through by category off
`financial_entry`, plus donated time, events, room use and membership, with a CSV. Built as
phase 4 of [reporting-spec.md](shipped/reporting-spec.md), which is now fully shipped. 🔧 The
membership-specific cut — active, new, cancelled, failed to renew — is not a line on it.

**As Development**, I want to record an in-kind donation and stay compliant on the paperwork.
✅ For gear: `acquisition` records the donor, and the Form 8283 / 8282 machinery on
`/staff/inventory/compliance` fires a disposal warning only where a form was actually signed.
~~🆕~~ ⏫ **🔧 since.** `financial_entry.kind = 'in_kind'` is the home. `in-kind-listener.ts`
writes contributed services from approved specialized volunteer hours, and
`in-kind-acquisition.ts` writes donated goods from an acquisition — which covers non-gear
supplies, since an acquisition line need not be an asset. Both surface on `/staff/reports`.
🆕 There is still no form for an in-kind gift that is neither an acquisition nor volunteer
time.

**As Development**, I want donor records, an annual appeal, and year-end statements.
🔧 `audience` and `campaign` can send the appeal. 🆕 A donor is not an entity; cultivation
history, appeal tracking and year-end statements have nothing behind them.

**As Development**, I want to track grant applications and their reporting deadlines, and
maintain business sponsorships.
🆕 `Grant & Fundraising Tracker` and `Sponsor Management` in [the `enhancement` issues](https://github.com/corvmc/corvmc.org/issues?q=is%3Aissue+label%3Aenhancement), both
unbuilt.

**As Development**, I want a record per venue of the terms we negotiated and the checklist we
walk every time.
⏫ **Split.** ✅ The `venue` table shipped with `/staff/venues`, carrying capacity, contacts
and `loadInNotes`. 🆕 The negotiated _terms_ and the walk-every-time checklist did not;
`production_task` templates are still the shape the checklist would take, and that table does
not exist.

**As Development**, I want each room's access answers — step-free entry, accessible restroom,
seating — recorded once and published on every listing for that room.
🆕 Neither the field nor the path to the listing exists. This is one duty split across two
committees, and it is the clearest case in this document of a small column with a real
consequence.

**As Development**, I want to recruit market vendors, run the application and its deadline, set
table fees, and know who has paid.
🆕 Nothing models a market vendor. `contractor` is deliberately not it — that is somebody the
collective pays to do work, and this is somebody who pays for a table. Same word, opposite
direction of money, and a different lifecycle.

**As Development**, I want permits, licenses and insurance to tell me before they expire.
🆕 No renewal calendar. The nearest built thing is certification expiry, which is derived from
dates rather than stored as a status — the same treatment would work here.

---

### Communications

Publishes what the organization is doing, and answers what comes back.

**As Communications**, I want incoming messages to arrive in one place and be routable to
whoever owns the answer.
✅ `/staff/inbox` — threads, participants, per-channel config, replies by email.

**As Communications**, I want to publish a response-time expectation and know whether we are
meeting it.
🆕 Nothing measures time-to-first-response on a thread.

**As Communications**, I want event listings and site content to stay current, and cancellations
and closures announced.
✅ `/staff/events`, `closure`, help authoring, and the notification system. A cancelled event
stays listed and marked.

**As Communications**, I want a takedown request handled and recorded.
🔧 `content_flag` and the moderation queue take reports against member content. A request to
pull down something _we_ published has no path through them.

**As Communications**, I want email lists with a segment per recurring program, and I want the
program lead to be able to send to their own segment without coming through me.
🔧 `subscriber`, `audience` and `campaign` are built and `/staff/marketing` runs them. The
delegation is the authority problem: there is no way to hand one person send rights over one
audience.

**As Communications**, I want every send to carry an unsubscribe link and a physical address.
✅ `marketing/unsubscribe.ts` and `campaign-service.ts` handle the link; the shared Postmark
layout (`postmark/templates/_layouts/corvmc-transactional/`) carries the mailing address.

**As Communications**, I want a newsletter on a cadence, and to know who owes a contribution.
✅ Campaigns send it. 🆕 Contributor solicitation and tracking is not modeled.

**As Communications**, I want a shot list for each event, the files handed in the same week, and
an archive I can find things in later.
🔧 The Documentation volunteer role exists and `media` / `media_attachment` plus
[media-spec.md](shipped/media-spec.md) hold the files. 🆕 The shot list, the same-week handoff, and the
index of recordings do not.

**As Communications**, I want a release on file for the people who appear in our photos and
video.
🔧 `media_attachment` already attaches a file to a subject polymorphically and
`attachableTypes` already includes `'user'`, so a standing release from a member is a file on
the person — the shape settled for releases generally. 🆕 An audience member who appears in a
photo and has no account has nothing to attach to, which is the harder half of this duty.

**As Communications**, I want the flyer cutoff enforced, so an event with no art from Art and
Merch runs on the template flyer and the standard schedule.
🆕 No deadline, and no template fallback. `Automatic Poster Compositing` in
[the `enhancement` issues](https://github.com/corvmc/corvmc.org/issues?q=is%3Aissue+label%3Aenhancement) is the fallback half.

**As Communications**, I want a social posting calendar, press contacts, and a season-over-season
read on what promotion actually worked.
🆕 None of the three exist, and a posting calendar in particular may be better left to the tool
the committee already uses.

**As Communications**, I want poster routes maintained — where posting is allowed, how often it
needs refreshing, which locations have gone dead.
🆕 Deliberately flagged: this is a paper map and a spreadsheet, and the street team already has
a volunteer role and shift board. Listed for completeness, not as a recommendation.

**As Communications**, I want the street team's flyering kits and the tabling kit to be things
somebody is accountable for.
🔧 Street Team and Tabling are seeded volunteer roles and schedule as ordinary shifts. The kits
are physical stock the inventory module could hold and does not.

**As Communications**, I want to apply the visual identity from one canonical set of files.
🆕 There is no asset library for the logo, its variants, and the templates everyone else works
from.

---

### Art and merchandise

Involves local artists in how the Collective looks, and keeps its merchandise.

**As Art and Merch**, I want a roster of local artists and a record of what each has made for
us.
🆕 Artists are not a modeled population. `Poster Art Repository` in
[the `enhancement` issues](https://github.com/corvmc/corvmc.org/issues?q=is%3Aissue+label%3Aenhancement) imagines the library; the roster and the relationship are not in it.

**As Art and Merch**, I want to commission the poster for an event — send the info packet, agree
image rights in writing before work starts, get the file back before the publication deadline,
and record what the artist is owed and how they are credited.
🆕 The whole pipeline. `event.posterKey` is the finished file and nothing models how it got
there. This is the single largest uncovered workflow in the document.

**As Art and Merch**, I want to design and source CMC merchandise, approve samples, and reorder
what sells.
🆕 `Merch Consignment` in [the `enhancement` issues](https://github.com/corvmc/corvmc.org/issues?q=is%3Aissue+label%3Aenhancement) is band merch sold at the venue, which is
a different thing from the Collective's own stock.

**As Art and Merch**, I want to decide what a dead instrument becomes and hand the build to a
work party.
🔧 Inventory triages a donation and tracks condition and disposal, so "this is beyond repair"
is recordable. 🆕 What it becomes, and the handoff to the people who build it, is not.

**As Art and Merch**, I want changes to the logo or wordmark to go to the board, while a one-off
treatment for a single event does not.
🆕 No approval workflow, and no asset library for the change to be made against.

---

### Facility

The building, and everything in it.

**As Facility**, I want the practice space calendar run for me — bookings, conflicts, held
dates, and closures.
✅ Reservations, `closure`, and `recurring_series`. This is the most completely served set of
duties in the document.

**As Facility**, I want reservation door codes issued, rotated on a schedule, and revoked when
the booking ends.
🔧 The lock integration and its cron exist. Rotation policy and a record of who currently holds
a code are not modeled.

**As Facility**, I want a register of key, lock and alarm-code holders.
🆕 Nothing. Distinct from the reservation lock, and the higher-consequence half.

**As Facility**, I want repairs and maintenance tracked from report to resolution, and a
cleaning schedule somebody is assigned to.
🔧 `Venue Maintenance Requests` in [the `enhancement` issues](https://github.com/corvmc/corvmc.org/issues?q=is%3Aissue+label%3Aenhancement), half built. Work parties exist as a
volunteer role and can be scheduled as shifts, so the unpaid labor half is served and the queue
half is not. **Outside contractors are now recorded** — `contractor` and `contractor_job` at
`/staff/contractors` answer who services the building and when they were last in, for both a unit
sent out to a tech and work on the building itself. See
[contractor-work-spec.md](shipped/contractor-work-spec.md).

**As Facility**, I want equipment other committees ask for acquired, consumables restocked
before they run out, and storage organized.
✅ The inventory module — `acquisition`, `stock_movement`, restock reorder points surfaced on
the staff dashboard, `inventory_location` for storage.

**As Facility**, I want the lending library run: checkout, return, due dates, condition at both
ends, overdue chasing, and rules about who may borrow.
✅ `inventory_loan`, `/staff/inventory/loans`, `/member/equipment/loans`. Charges are derived
from the loan rather than stored.

**As Facility**, I want a donated instrument triaged on arrival into library, repair queue, or
disassembly.
✅ The acquisition and asset condition path covers the triage. 🔧 A repair sent to a _paid_ tech is
now modeled end to end (`contractor_job`, with the unit leaving and re-entering service through
the stock ledger). The queue as a queue — reported, triaged, assigned to a volunteer, closed — is
the work-order half and is not.

**As Facility**, I want fire extinguishers, exits, first aid, posted capacity and emergency
procedures maintained and current.
🆕 `Incident & Safety Log` in [the `enhancement` issues](https://github.com/corvmc/corvmc.org/issues?q=is%3Aissue+label%3Aenhancement) covers logging what happened; nothing
covers the standing compliance checklist. `/staff/inventory/compliance` is IRS donation
paperwork, not building compliance, despite the name.

**As Facility**, I want a building wish list — repairs, purchases, and grant-fundable projects —
that survives between meetings.
🔧 The `suggestion` board collects member-facing ideas with votes and a staff response. A
capital project list is a different object with a cost and a funding path.

---

### Chairs

Every committee has one chair, appointed by the board.

**As a chair**, I want my committee's roster, and to know which named position each member
holds.
✅ `group_member` is the roster and `position` is free text on it. That it is read by nothing is
**correct rather than a gap**: committee titles and positions are the chair's to invent, rename
and retire, and any code that read them would be code that constrains them. An earlier draft of
this document called making `position` meaningful the highest-leverage change available; that
was wrong, and the label is doing exactly the job it should.

**As a chair**, I want members to be able to apply to my committee, and to approve or decline
them myself.
~~📋~~ ⏫ **✅ since** — all eleven groups phases shipped. `'requested'` is a
`groupMemberStatuses` value, a `by_application` group shows an Apply button beside its join
instructions, and the applications sit apart from the roster on the club page. Approving is
a `group_member.status` flip from `'requested'` to `'active'`, the same flip that accepts an
invitation. This replaces the interest-to-roster funnel an earlier draft proposed; see
[What a committee is in this app](#what-a-committee-is-in-this-app) for what retires with it.
The written application and the interview happen **on paper, off the app** — so the request row
needs no body, and `by_application` as designed is exactly sufficient. There is no seat cap: the
gate is the conversation, not the count.

**As a chair**, I want to invite someone onto the committee and hand the seat off cleanly when
they leave.
🔧 Group invitations are built for bands and generalize; an invited member is a `group_member`
row with `status = 'pending'` that appears on the invitee's dashboard. ~~Blocked on
`/staff/groups`.~~ ⏫ **✅ since:** `/staff/groups` is built, and a leader invites from the club
page by account or by email address. Handing the seat off is `transferGroupOwner` — though a
chair is an `admin`, so for a committee there is usually no seat to hand.

**As a chair**, I want the committee's minutes and its working documents in one place that
outlives whoever took them.
~~📋~~ ⏫ **✅ since:** group documents are built — the private bucket behind an authorized
download route, with a per-group quota meter. Designed with
committee minutes as the named use case, and deliberately a file store rather than a document
tool: no in-app authoring, no versioning, no structured agenda format. A dissolved committee
keeps its documents, because they are the record of it. The same store would hold the
committee's checklists, templates and rosters — but nothing prompts anyone to keep those
current, which the proposal makes a standing duty of the chair.

**As a chair**, I want to post to my committee without email.
~~📋~~ ⏫ **✅ since:** announcements fan out in-app and by email to unmuted members, latched
against the at-least-once bus and chunked for D1's bound-parameter cap. The per-member mute
(`group_member.notifyAnnouncements`) is read now, so its schema comment saying nothing reads it
is itself stale.

**As a chair**, I want to report my committee's numbers and status to the board on a schedule,
and to flag when we cannot cover our work with the people we have.
~~📋~~ ⏫ **🔧 since.** The rollup is built — `/staff/reports`, calling each module's existing
report service exactly as [reporting-spec.md](shipped/reporting-spec.md) proposed, so the board
reads one document over any date range. What it is **not** is committee-scoped: it is one
organization-wide page behind `finance.read`, not a chair's view of their own committee's
numbers. That scoping is the `requireCommitteeRole` guard, not a second report. `/staff/volunteer/report` is both the precedent for the shape (a date
range, tables, no charts, not cached) and one of the services the rollup would call.

Noticing that a duty has gone unstaffed is **deliberately not a feature**. It would need
positions to be machine-readable, which decision 10 rules out, and the judgement is the chair's
to make and say out loud in the report — a system that flagged it would be inferring from
activity what a person already knows.

**As a chair**, I want to know the amount my committee can commit without coming back to the
board, and to work inside it.
🆕 No budget, no spending limit, no approval threshold anywhere in the app.

**As a chair**, I want a named backup who can run a meeting in my absence.
🔧 The deputy is a second `group_member.role = 'admin'`, and is deliberately indistinguishable
from the chair in the data — under first among equals there is nothing to distinguish. Which
one chairs is `position`, a label rather than a permission.

---

## Event and program roles

Appointed per event or per program rather than sitting on a committee. Some require training,
which is what certifications record.

### Event lead

Responsible for one event from confirmation through load-out.

**As an event lead**, I want the event handed to me with its lineup, its terms, its crew, its
money plan, and its room, and I want to see at a glance whether every role is filled before the
day.
🆕 The concept does not exist. Every _component_ is built or designed — the shift board knows
crew, the productions spec knows terms and run of show, reservations know the room — and there
is no person the app can hand them to as a set. Introducing an event lead is mostly a matter of
naming an owner on an event and giving them a page that already-built queries can fill.

**As an event lead**, I want to cast an ensemble or assemble a lineup for a participatory
format, working from Booking's roster and terms.
🆕 Special and participatory formats are not modeled at all.

**As an event lead**, I want to decide an event is cancelled or postponed and have that reach
Communications, the acts, and the venue.
🔧 Cancelling an event is built and notifies; who may do it is `requireStaff()`.

### Program lead

Responsible for one recurring program, session to session.

**As a program lead**, I want to run my program's sessions, welcome newcomers, and keep the
roster.
~~🔧~~ ⏫ **✅ since:** `/staff/groups` creates the club and appoints its lead, and
`/member/groups/[slug]` is the lead's six-tab page — roster, sessions, announcements,
documents, applications and, for a committee, its projects.

**As a program lead**, I want to tell my own attendees about a cancellation or a change,
directly.
~~📋~~ ⏫ **✅ since** for the roster half: announcements are built and reach unmuted members
in-app and by email. 🆕 Reaching the program's _email segment_ — attendees who never joined the roster — is the delegation gap under
Communications, and is the larger half for a drop-in program.

**As a program lead**, I want the published details and the standing slot to change together
when my program moves.
🔧 Both `recurring_series` and the listing exist; keeping them in step is manual.

**As a program lead**, I want to report attendance to Booking.
🆕 Nothing records attendance at a session.

### Host

Runs the event on the day.

**As a host**, I want to confirm every other mandatory role is filled before doors.
✅ The Volunteer Shifts card on `/staff/events/[id]/production` shows needed-vs-claimed per
role. 🔧 It is a staff page, and the host is a volunteer — there is no host-facing view of it.

**As a host**, I want to count the till with Merch before doors and again at the end, with both
of us signing, and to settle with the bands off an agreed ticket count.
⏫ **Split.** 🔧 `settlement-service.ts` reads a settlement and `production_expense` records
what the show cost. 🆕 Door cash has no column, a slot has no payout field, and nothing
settles — see #1133. Two-person sign-off was never in the spec either.

**As a host**, I want to record afterward what worked and what didn't.
✅ Post-shift feedback — a rating, a separate "were you set up to succeed?", and a comment —
already exists per signup and rolls up anonymously per role.

### Tech

**As tech**, I want the stage plot and input list the act supplied, and to flag room limitations
before the event.
~~📋~~ ⏫ **✅ since:** `/band/[slug]/rider` and `production_slot.techNotes`.
_Claiming a desk shift is already gated on clearance — see Production._

### Door

**As door**, I want to take entry, count heads against capacity, and handle a ticketed guest
list.
✅ `/staff/events/[id]/check-in` scans tickets. 🆕 A live head count against posted capacity is
not part of it.

**As door**, I want the safety policy — first aid, exits, who to call — where I can reach it on
shift.
🆕 Help articles could carry it; nothing puts it in front of somebody working a door shift.

### Merch

**As merch**, I want to run venue merch and concessions, handle a band's merch when asked, and
tally comped drinks.
🆕 No point of sale. Ticketing is online-only; a real box office and a till are deferred in the
productions spec, which notes the schema is deliberately compatible with one.
_Till counting and the ticket-count sign-off are under Host._

### Vendor host

**As a vendor host**, I want the vendor list, the table map and who has paid, so I can check
vendors in, handle no-shows and reassignments, and report back on who to invite again.
🆕 Nothing models a vendor, a table, or a market day. Pairs with Development's vendor duties as
one uncovered feature, not two.

---

## What this does not cover

**Board roles (Part 3).** President, vice president, secretary, treasurer, youth safety, and
complaints. The board approves the frame and receives reports; the reports it receives are
stories above, under each committee and under Chairs. Board _governance_ — agendas, minutes of
board meetings, the record of decisions, elections — is a different document and arguably not
software at all. `Member Voting / Proposals` in [the `enhancement` issues](https://github.com/corvmc/corvmc.org/issues?q=is%3Aissue+label%3Aenhancement) is the piece of it
that might be.

**The Technology Coordinator (5.1) and Volunteer Coordinator (5.2).** Both are cross-committee
roles rather than committee work. The Technology Coordinator's duties are about the app rather
than expressed through it, and belong in
[architecture/operations-manual.md](../architecture/operations-manual.md). The Volunteer
Coordinator's are already the volunteering module, end to end — recruiting, onboarding,
scheduling, retention, and a report to the board — and rewriting them as new stories would
restate a shipped feature.

**The unskilled shift roles (5.15–5.19).** Load-in and load-out, setup and teardown, work
parties, documentation, archive sorting. Each is a `volunteer_role` with shifts, and the shift
board serves all of them identically. They need nothing the module does not already do. Where a
duty of theirs needs something new — the shot list for documentation, the build direction for
work parties — it appears above under the committee that owns it.

**Anything about policy.** Conduct rules, ban procedures, prices, pay rates, terms, and youth
safety requirements are the bylaws' business. Where a story touches one — a minor's volunteer
profile, a member's standing — the app already implements the policy and this document does not
restate it.

---

## Decisions that were open

All five questions this document opened have been answered. They are recorded here rather than
edited away, because each one closes off an alternative that will otherwise be re-proposed.

1. **A chair is a group `admin`.** Not an `owner`, and not a fourth role value. The chair is
   first among equals — they run the meeting and report, they do not hold authority the rest of
   the committee lacks. This accepts that a chair and a deputy look identical in the data, which
   is correct rather than a compromise. See [The authority problem](#the-authority-problem) for
   what follows, including why a committee is normally left unowned.

2. **A committee is a `by_application` group, and the committee volunteer roles retire.** The
   alternative — keeping both and building a funnel from interest to roster — is more code and
   leaves the name meaning two things permanently. `groups-spec.md` already named a committee as
   the motivating case for the policy. See
   [What a committee is in this app](#what-a-committee-is-in-this-app).

   **There is no seat count. Joining is a short application, an interview, and the chair's
   approval — and the first two are on paper.** So `by_application` needs nothing added: the
   in-app request is the front door and the queue, `joinInstructions` is the prompt that points
   at the paper process, and approval stays the bare `'requested' → 'active'` flip it was
   designed as. A first draft of this decision called for somewhere to store application answers
   and a status for the interview; both were solving a problem the Collective does not have.

3. **Releases are polymorphic file attachments, and that covers all of it.**
   `media_attachment` already attaches a file to a subject by type and id, deliberately without a
   foreign key on the parent — which is exactly what makes new subject types cheap. A standing
   release from a member is `attachableType: 'user'` today. A per-work release — a band
   consenting to _this_ recording, an artist licensing _this_ poster — is the same mechanism
   pointed at the work once the work is an entity, and needs a value added to `attachableTypes`
   rather than a table. The non-member photo subject resolves the same way: `contact` exists in
   [groups-spec.md](shipped/groups-spec.md) precisely to hold people who are not members, and a release
   attaches to a `contact` like anything else. No release table, in any of the three cases.

4. **Two cadences, one strategy.** There is a monthly committee report to the board and an
   annual report, and both compose the same way: per
   [reporting-spec.md](shipped/reporting-spec.md) the packet calls each module's existing report
   service rather than writing its own queries. The monthly is the smaller artifact — this
   committee, since the last meeting — and the annual is the rollup across all of them. Not six
   standing report pages either way.

   ⏫ **2026-09-13:** the strategy shipped and the decision held — `/staff/reports` calls the
   module services and takes any range, so the two cadences are one page. The **per-committee**
   cut is what is left, and it is a scoping question rather than a reporting one.

5. **Committee members act within their own domain.** This was the question the rest depended
   on, and the answer is the one that costs the most: committee-scoped authority is real work.
   It is not blocked on `admin-vs-staff-spec.md` — that dependency was claimed here and is
   withdrawn — though the two are now designed together. The cheaper reading — that committees
   meet, decide, and ask staff to execute — would have made most of this document a
   documents-and-announcements problem the groups module already solves. It is not the model
   being adopted.

6. **The committees are the organizing principle, not a permission overlay.** What the app has
   today is admin CRUD filed by entity; what these duties need is dedicated workflow affordances
   filed by domain. This is why question 1 of the second round — "what is a committee's domain?"
   — resolved into a design direction rather than a lookup table: the domain is the surface the
   work is done on, and the permission boundary follows it. See
   [Admin CRUD is not a workflow](#admin-crud-is-not-a-workflow), which is the through-line of
   this whole document and the reason the 🆕 count overstates the distance.

7. **The staff panel stays, as an administrative tool.** Workflow surfaces are added beside it,
   not in place of it. This is the additive reading of decision 6 and the cheaper one: the
   entity-filed panel remains the place you go when the workflow did not anticipate you, which
   every workflow eventually fails to do. Nothing below marked ✅ or 🔧 is at risk of being taken
   away; it stops being the _only_ way to do the work rather than stopping being a way.

8. **Booking and Production get the first surfaces**, because that is where the surface
   would ease the most relevant work. Conveniently, most of it is already designed:
   [production-workflow-spec.md](production-workflow-spec.md) is the back-of-house layer for a
   show end to end — lineup, advance, run of show, settlement, close-out — and reads in
   retrospect like the first committee workflow surface written before the framing existed. What
   it does not cover is Booking's front half: the roster of acts, and the offer that has not
   become a show yet. Those are its two deferrals — "Public booking inquiries" and emailing
   external acts — and they are the gap between Productions as specced and Booking as a
   domain.

9. **The application is paper.** See decision 2 — this is what keeps `by_application` a bare
   status flip and keeps a schema change out of the committee work entirely.

   > ⏫ **Reversed 2026-09-14.** The paper form asks two questions — _"Describe any relevant
   > experience"_ and _"What would you like your music community to look like?"_ — and the app
   > had nowhere to put the answers. `committee_application` now does.
   >
   > It is **not** `by_application`, and the reason is specific: `declineApplication()` deletes
   > the `group_member` row, which `instructor-service.ts` names as correct _"because a group
   > application carries no content"_. Adding answers to that row would falsify a statement
   > another module depends on and destroy what somebody wrote on decline; `unique(groupId,
userId)` would also leave a declined applicant unable to ever apply again. Committees stay
   > `invite_only`, membership stays the outcome, and accepting invites.
   >
   > What survives from this decision is its actual content: the **conversation is still the
   > gate**, there is still no seat cap, and the interview still happens off the app.
   > `contacted` is a status because the form promises a chair will call.

10. **Committee titles and positions are at the chair's discretion, and nothing reads them.**
    `group_member.position` stays free text with no consumer. A committee names its own roles,
    renames them, and drops them without asking the app's permission, and code that read the
    field would be code that constrained that. The corollary is that nothing can automatically
    notice an unstaffed duty — which is fine, because the chair already knows and reporting it
    is their job.

---

## Open questions

None. Every question this document opened across three rounds has been answered, and the
answers are recorded above.

What is left is not a question but a sequence. Committee-scoped authority does not need
[admin-vs-staff-spec.md](admin-vs-staff-spec.md) settled first — they are independent — but the
two now share a design: guards name capabilities, and a committee guard resolves the committee
from the resource. The application flow needs phase 5 of
[groups-spec.md](shipped/groups-spec.md), and carries the status-blind roster reads with it. The first
workflow surface is Booking and Production, most of which is
[production-workflow-spec.md](production-workflow-spec.md) already — so the honest next step is
to build that spec and find out whether a domain surface is what it turns out to be.
