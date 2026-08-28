# Committees and roles

## Purpose

The Collective has adopted a committee structure — six committees, each with a chair, sitting
between a board that approves the frame and a volunteer pool that works the shifts. It is
written down in an internal proposal that describes duties: who keeps the roster of acts, who
answers the inbox, who holds the keys, who counts the till.

The app knows none of it. There is no committee anywhere in the staff panel, no way to say
"this is Programming's problem", and no page a new Communications member can open to see what
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

## What a committee is in this app

**A committee is a `group`. The volunteer role of the same name is its recruiting poster.**

The word already means two unrelated things in the codebase, and nothing links them:

- `groupKinds = ['band', 'club', 'committee']` — [src/lib/config.ts](../../src/lib/config.ts).
  A committee is a `group` row with a roster (`group_member`) and — once phases 7 and 8 of
  [groups-spec.md](groups-spec.md) land — announcements and shared documents. Staff-created
  only, which is what makes free room time safe to grant by kind. The roster is live today;
  everything hanging off it is designed and unbuilt.
- `volunteerRoleGroups = ['at-shows', 'away-from-shows', 'committee']` — same file. A
  presentational bucket on the `/contribute` role picker, holding rows like "Programming
  Committee" from [scripts/seed-volunteer-roles.ts](../../scripts/seed-volunteer-roles.ts).
  Nothing branches on it; the volunteering spec is explicit that a `volunteer_role` grants
  nothing at all.

There is no foreign key between them, and a Programming Committee would today be two unrelated
rows with the same name. The split is worth keeping, because the two do different jobs: the
volunteer role is how somebody who has never been to a meeting says "I'd help with that", and
the group is the committee they join afterwards. Interest is public and cheap; membership is
appointed.

**What is missing is the step between them.** A `volunteer_role_interest` row in the
`committee` bucket is a lead, and there is nowhere for a chair to see their leads or act on
one. That is a story below, under Chairs, and it is the smallest change in this document with
the largest effect on whether committees fill.

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

So "Programming may edit events but not payments" is not a permission this app can express.
Anyone handed the panel to do committee work today gets the whole panel, including account
purges and credit adjustments. That is a policy the Collective has not chosen; it is a
consequence of there being one door.

**This document does not solve it.** `admin-vs-staff-spec.md` is the prerequisite, and the
committee structure is the strongest argument yet for its Option B — a rotating set of
committee volunteers is precisely the population that should not inherit account deletion.
Two further requirements this document adds to that spec, neither of them in it today:

- **Committee-scoped authority.** A guard shaped like `requireCommitteeRole('programming')`,
  reading `group_member` for a `kind = 'committee'` group. Every ✅ and 🔧 story below is
  currently "staff can do this"; committee scoping is what would make them "the right people
  can do this".
- **A chair is not a group owner.** `group_member.role = 'owner'` carries transfer and delete;
  a chair is appointed and removed by the board and should hold neither. Either `admin` is the
  chair's row and staff hold `owner`, or chair becomes a fourth value. Open question below.

---

## How to read the stories

Each story is what a person needs, followed by one line naming what serves it.

**Status legend:** ✅ Served today · 🔧 Partly served · 📋 Designed, not built (spec linked) ·
🆕 Nothing covers this

🔧 and 🆕 are not a backlog. Several are deliberate non-goals — a poster route is a paper map
and a spreadsheet, and putting it in the app would be worse than leaving it alone. The marker
says what exists, not what should.

---

## Stories

### Programming

Decides what the Collective spends its resources on, and plans it.

**As Programming**, I want a roster of acts carrying contact details, what they've played, and
what they drew, so booking the next bill starts from what happened rather than from memory.
🔧 `directory_entry` is the member-facing listing; [production-workflow-spec.md](production-workflow-spec.md)
adds a profile for a touring act with no account, and gig history falls out of past slots.
Draw is not recorded anywhere, and neither is scouting — acts noticed locally or regionally, and
the relationships with bookers in nearby towns that turn up new ones.

**As Programming**, I want to record that an act was asked and never answered, or said no and
why, so the same act is not chased three times in a season.
🆕 Nothing models an offer that did not become a show. `Booking Request Pipeline` in
[IDEAS.md](../../IDEAS.md) is the inbound half; this is the outbound half.

**As Programming**, I want submissions from acts to arrive somewhere I can work through rather
than in a personal inbox.
🔧 `/staff/inbox` receives the contact form and threads replies. It is a general inbox with no
booking state on a thread.

**As Programming**, I want to build a bill — acts in billing order, set lengths, a run of show
— and have set times follow from it.
📋 `production_slot` in [production-workflow-spec.md](production-workflow-spec.md). Set times
are derived from the lineup on every mutation, with no override.

**As Programming**, I want each act's terms recorded — guarantee, door split, or a donated
night — and visible to the act before the show.
📋 Same spec: per-slot `guaranteeCents` and a per-show `bandSplitPercent`, with a read-only
terms summary in the band's own panel. What we offer in return for a donated night is not
modeled.

**As Programming**, I want to advance a show — set times, backline, hospitality, load-in — off
a checklist rather than a group chat.
📋 `production_task`, seeded from templates per phase (`advance`, `day_of`, `close_out`), and
a production cannot close with unfinished close-out tasks.

**As Programming**, I want to cancel a show and put a replacement in its place without losing
the listing.
✅ A cancelled event stays on the gig guide marked cancelled rather than vanishing. 📋 Swapping
one act for another within a bill is a slot edit.

**As Programming**, I want to appoint an event lead to a specific event and have them receive
the roster, the terms, and the format's rules.
🆕 There is no event-lead concept. `event.createdByUserId` is the nearest column and means
something else. See [Event and program roles](#event-and-program-roles).

**As Programming**, I want to receive a proposal for a club, class, jam or workshop and decide
whether it runs.
🔧 The `suggestion` board takes member ideas and gives staff a response and a status, but it is
a public upvote board, not an application with terms.

**As Programming**, I want to appoint a program lead for a recurring program, replace them when
someone steps back, and end a program that has stopped meeting.
🔧 A program is a `group` with `kind = 'club'` and its lead is the owner row; staff can
reassign a club's leader without the outgoing leader's participation, and `deactivate()` ends a
program while keeping its documents and roster as the record. Blocked on `/staff/groups`, which
is where a club comes into existence and is not built yet.

**As Programming**, I want a program's standing slot held on the practice calendar and its
details published on the site.
✅ `recurring_series` holds a repeating reservation; the listing is `/staff/events`.

**As Programming**, I want a booking cutoff that the calendar actually enforces.
🆕 No deadline concept on an event or a series.

**As Programming**, I want to record how an act was to work with after the show, against the
act.
🆕 Nothing carries a post-show note back to the roster.

---

### Production

Coordinates the equipment and people that make an event happen, and grows the pool who can do
it.

**As Production**, I want an engineer assigned to every event, and to see which upcoming events
have nobody on them.
✅ `volunteer_shift` attaches to an `event`; `/staff/events/[id]/production` carries a Volunteer
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
📋 Rider and stage-plot upload plus per-slot `techNotes` / `backlineNeeds` in
[production-workflow-spec.md](production-workflow-spec.md). 🆕 Matching a rider against the
equipment catalog is explicitly out of that spec — it is `Tech Rider Management` in
[IDEAS.md](../../IDEAS.md).

**As Production**, I want the show-day tech schedule — soundcheck, doors, changeovers — to come
from the lineup rather than a separate document.
📋 Derived set times plus the `day_of` task phase, which exists precisely because the pre-show
walkthrough belongs to whoever is on shift rather than whoever booked the show.

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
🆕 Nothing covers this. `media` stores finished files; it is not session management, and there
is no release-form record anywhere in the app.

---

### Development

Money, rooms, and partners.

**As Development**, I want to decide how each event makes money and set its pricing.
✅ Ticketing lives on the event, with member discounts and guest checkout. 📋 Settlement — door
cash, expenses, band payouts — is the productions spec.

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
🆕 The numbers exist; the packet does not. [reporting-spec.md](reporting-spec.md) sequences a
rollup that calls each module's existing report service, and `Annual Report Generator` in
[IDEAS.md](../../IDEAS.md) is the same thing at annual cadence.

**As Development**, I want to record an in-kind donation and stay compliant on the paperwork.
✅ For gear: `acquisition` records the donor, and the Form 8283 / 8282 machinery on
`/staff/inventory/compliance` fires a disposal warning only where a form was actually signed.
🆕 In-kind that is not gear has nowhere to go.

**As Development**, I want donor records, an annual appeal, and year-end statements.
🔧 `audience` and `campaign` can send the appeal. 🆕 A donor is not an entity; cultivation
history, appeal tracking and year-end statements have nothing behind them.

**As Development**, I want to track grant applications and their reporting deadlines, and
maintain business sponsorships.
🆕 `Grant & Fundraising Tracker` and `Sponsor Management` in [IDEAS.md](../../IDEAS.md), both
unbuilt.

**As Development**, I want a record per venue of the terms we negotiated and the checklist we
walk every time.
📋 A real `venue` table arrives with [production-workflow-spec.md](production-workflow-spec.md);
`production_task` templates are the shape a venue checklist would take.

**As Development**, I want each room's access answers — step-free entry, accessible restroom,
seating — recorded once and published on every listing for that room.
🆕 Neither the field nor the path to the listing exists. This is one duty split across two
committees, and it is the clearest case in this document of a small column with a real
consequence.

**As Development**, I want to recruit market vendors, run the application and its deadline, set
table fees, and know who has paid.
🆕 Nothing models a vendor.

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
[media-spec.md](media-spec.md) hold the files. 🆕 The shot list, the same-week handoff, and the
index of recordings do not.

**As Communications**, I want a release on file for the people who appear in our photos and
video.
🆕 No release record anywhere in the app. This is the same gap Production has for session
releases and should be solved once.

**As Communications**, I want the flyer cutoff enforced, so an event with no art from Art and
Merch runs on the template flyer and the standard schedule.
🆕 No deadline, and no template fallback. `Automatic Poster Compositing` in
[IDEAS.md](../../IDEAS.md) is the fallback half.

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
[IDEAS.md](../../IDEAS.md) imagines the library; the roster and the relationship are not in it.

**As Art and Merch**, I want to commission the poster for an event — send the info packet, agree
image rights in writing before work starts, get the file back before the publication deadline,
and record what the artist is owed and how they are credited.
🆕 The whole pipeline. `event.posterKey` is the finished file and nothing models how it got
there. This is the single largest uncovered workflow in the document.

**As Art and Merch**, I want to design and source CMC merchandise, approve samples, and reorder
what sells.
🆕 `Merch Consignment` in [IDEAS.md](../../IDEAS.md) is band merch sold at the venue, which is
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
🆕 `Venue Maintenance Requests` in [IDEAS.md](../../IDEAS.md), unbuilt. Work parties exist as a
volunteer role and can be scheduled as shifts, so the labor half is served and the queue half
is not. Outside contractors are the same gap seen from the other side: nothing records who
services the building or when they were last in.

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
✅ The acquisition and asset condition path covers the triage. 🔧 The repair queue as a queue —
assigned to an instrument tech, worked, closed — is not modeled.

**As Facility**, I want fire extinguishers, exits, first aid, posted capacity and emergency
procedures maintained and current.
🆕 `Incident & Safety Log` in [IDEAS.md](../../IDEAS.md) covers logging what happened; nothing
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
🔧 `group_member` is the roster. `position` is free text and read by nothing, so a committee
that has divided its duties into named positions cannot record that anywhere the rest of the
app can see. **This is the smallest change in the document with the widest effect** — it turns
the roster from a list of names into a division of labor.

**As a chair**, I want to see who has expressed interest in my committee, so I can recruit from
people who already put their hand up.
🆕 `volunteer_role_interest` rows in the `committee` bucket are exactly these leads, and there
is no chair-facing view of them and no path from a lead to a roster row. See
[What a committee is in this app](#what-a-committee-is-in-this-app).

**As a chair**, I want to invite someone onto the committee and hand the seat off cleanly when
they leave.
🔧 Group invitations are built for bands and generalize; an invited member is a `group_member`
row with `status = 'pending'` that appears on the invitee's dashboard. Blocked on
`/staff/groups`.

**As a chair**, I want the committee's minutes and its working documents in one place that
outlives whoever took them.
📋 Group documents — phase 8 of [groups-spec.md](groups-spec.md), unbuilt. Designed with
committee minutes as the named use case, and deliberately a file store rather than a document
tool: no in-app authoring, no versioning, no structured agenda format. A dissolved committee
keeps its documents, because they are the record of it. The same store would hold the
committee's checklists, templates and rosters — but nothing prompts anyone to keep those
current, which the proposal makes a standing duty of the chair.

**As a chair**, I want to post to my committee without email.
📋 Group announcements — phase 7 of [groups-spec.md](groups-spec.md), unbuilt. The per-member
mute (`group_member.notifyAnnouncements`) already exists and its schema comment says outright
that nothing reads it until phase 7 lands.

**As a chair**, I want to report my committee's numbers and status to the board on a schedule,
and to flag when we cannot cover our work with the people we have.
🆕 No committee report, no cadence, and nothing that would notice an unstaffed duty. Volunteering
has the closest precedent: `/staff/volunteer/report` produces exactly this shape of packet over
a date range, with unfilled shift counts already surfaced per role.

**As a chair**, I want to know the amount my committee can commit without coming back to the
board, and to work inside it.
🆕 No budget, no spending limit, no approval threshold anywhere in the app.

**As a chair**, I want a named backup who can run a meeting in my absence.
🔧 `group_member.role = 'admin'` is the shape of a deputy. Nothing says that is what it means.

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
format, working from Programming's roster and terms.
🆕 Special and participatory formats are not modeled at all.

**As an event lead**, I want to decide an event is cancelled or postponed and have that reach
Communications, the acts, and the venue.
🔧 Cancelling an event is built and notifies; who may do it is `requireStaff()`.

### Program lead

Responsible for one recurring program, session to session.

**As a program lead**, I want to run my program's sessions, welcome newcomers, and keep the
roster.
🔧 A club `group` with the lead as owner. Blocked on `/staff/groups` and the club page, which
arrive later in [groups-spec.md](groups-spec.md).

**As a program lead**, I want to tell my own attendees about a cancellation or a change,
directly.
📋 Group announcements would reach the roster, once phase 7 lands. 🆕 Reaching the program's
_email segment_ — attendees who never joined the roster — is the delegation gap under
Communications, and is the larger half for a drop-in program.

**As a program lead**, I want the published details and the standing slot to change together
when my program moves.
🔧 Both `recurring_series` and the listing exist; keeping them in step is manual.

**As a program lead**, I want to report attendance to Programming.
🆕 Nothing records attendance at a session.

### Host

Runs the event on the day.

**As a host**, I want to confirm every other mandatory role is filled before doors.
✅ The Volunteer Shifts card on `/staff/events/[id]/production` shows needed-vs-claimed per
role. 🔧 It is a staff page, and the host is a volunteer — there is no host-facing view of it.

**As a host**, I want to count the till with Merch before doors and again at the end, with both
of us signing, and to settle with the bands off an agreed ticket count.
📋 Settlement in [production-workflow-spec.md](production-workflow-spec.md) — door cash,
expenses, per-slot payouts, an editable settlement with an audit trail, deliberately a
worksheet rather than a disbursement system. 🆕 Two-person sign-off is not in it.

**As a host**, I want to record afterward what worked and what didn't.
✅ Post-shift feedback — a rating, a separate "were you set up to succeed?", and a comment —
already exists per signup and rolls up anonymously per role.

### Tech

**As tech**, I want the stage plot and input list the act supplied, and to flag room limitations
before the event.
📋 Rider upload and per-slot tech notes.
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
software at all. `Member Voting / Proposals` in [IDEAS.md](../../IDEAS.md) is the piece of it
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

## Open questions

1. **Is a chair a group `owner`, a group `admin`, or a fourth role?** Owner carries transfer
   and delete, neither of which a board-appointed chair should hold; the groups spec already
   makes deleting a club or committee staff-only for this exact reason. Admin is the honest fit
   but then a chair and their deputy are indistinguishable. A fourth value costs a vocabulary
   change and reaches every group, including bands, which have no chairs.

2. **Does the committee `volunteer_role` survive?** If a chair can see interest and act on it,
   the role is doing real work as a funnel. If not, two rows named "Programming Committee" in
   unrelated tables is a trap somebody will fall into. Deciding to keep it should come with the
   funnel; deciding to drop it means the `committee` bucket in `volunteerRoleGroups` goes with
   it.

3. **Where do releases live?** Photo and video subject releases (Communications), recording
   session releases (Production), and image-rights agreements with poster artists (Art and
   Merch) are three committees asking for one thing: a signed permission attached to a person
   and a work. Three separate implementations is the likely outcome if nobody names it once.

4. **Is a committee report a feature or a query?** `/staff/volunteer/report` sets the precedent
   — a date range, four tables, no charts, not cached. If each committee's board report is that
   shape, six of them are six report pages. If they are meant to compose into one board packet,
   that is [reporting-spec.md](reporting-spec.md)'s rollup and should wait for it.

5. **What does a committee actually get to do that a member cannot?** This document assumes the
   answer is "act on the organization's data within its own domain", which is what
   committee-scoped authority would mean. If the answer is instead "meet, decide, and ask staff
   to execute", then almost every 🆕 above is a documents-and-announcements problem the groups
   module already solves, and the authority work is unnecessary. **This question should be
   answered before anything here is built.**
