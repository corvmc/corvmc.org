# Volunteering

The Corvallis Music Collective runs on volunteer labor, and nothing in the app
records it. A prospective volunteer today picks "Volunteer Opportunities" from
the public contact form and lands in the staff inbox; from there it is email and
memory. There is no answer to "who volunteered last quarter and for how long,"
which is exactly the number the board and grant applications ask for.

This module gives that labor a home. Staff define **volunteer roles** — job
types with descriptions, like Sound Engineer or Front Desk. Members read those
descriptions, then **log hours** against a role. Staff work a queue of pending
logs, approving or rejecting each one, and a report rolls the approved hours up
by member, by role, and by month over any date range.

Phase 1 is roles and hour logging: retrospective, member-initiated,
staff-approved. Phase 2 (volunteer opportunities and shifts, member sign-up,
per-event staffing) and certifications (who is cleared for what, and when that
lapses) were designed here as future work and **both shipped in #235** — six
further tables, `/staff/volunteer/{shifts,certifications,clearances}` and
`/member/volunteer/{start,feedback}`. Everything below is live; the phase
headings are kept because they still describe how the schema was built up, not
what is missing.

Approved volunteer hours are a record, not a currency. They do not grant
practice-room credits and they never touch the finance ledger.

The module ships behind a `volunteering` feature flag, default off. Per #171 the
flag gates the **member** surface only — the staff panel always shows
volunteering, so staff can define roles and work the queue before it is switched
on for everyone, and keep administering it if it is switched back off.

---

## Key concepts

**A volunteer role is a job description, not a permission.** `role` is already
taken in this codebase: `src/lib/server/db/schema/authorization.ts` defines the
auth roles (`admin`, `staff`, `member`, …) that `requireStaff()` and
`primaryRoleFor()` read. A `volunteer_role` row grants nothing. It is a name, a
markdown description of what the job involves, and a display order. The two
never interact.

**Roles are a table, not an enum or a config string.** Staff need to add "Merch
table" without a migration, and the job descriptions are the substance of the
member-facing page — a string list could not carry them. It also gives Phase 2
shifts something to reference, which is the main reason the table exists in
Phase 1 rather than later.

**Retired roles are archived, never deleted out from under history.** Deleting a
role that has hour logs would silently rewrite past reports. The role FK is
`ON DELETE RESTRICT`, and a delete attempt on a role with logs is refused with a
pointer to archive instead. Archiving hides a role from the member submit form
and nowhere else — it stays in staff filters and in every report, because the
work happened.

**Approval is what makes a number reportable.** Every report query filters to
`status = 'approved'`. That is the entire purpose of the review step: a member
can claim anything, and the report has to be defensible to a funder.

**Hours are stored as integer minutes.** No floats, matching the cents-as-integer
posture elsewhere in the app. The UI accepts quarter-hours and renders
`formatVolunteerHours()`; the database stores 90, not 1.5.

**Approved hours grant nothing.** There is a test asserting that approving an
hour log writes no `credit_transaction` row. Sweat-equity-for-practice-time is a
plausible future feature and a deliberate non-goal today; the test exists so the
decision is not quietly reversed.

---

## Domain model

### Volunteer role

A job type members can volunteer for. Staff-managed.

```
volunteer_role
  id             uuid pk
  name           text unique        — "Sound Engineer"
  description    text?              — the job description, markdown
  group          text               — at-shows | away-from-shows | committee
  displayOrder   integer            — sort order in pickers and reports
  isActive       boolean            — false = archived; hidden from the submit form only
  createdAt      timestamp
  updatedAt      timestamp
```

`group` is presentation only: it buckets the roles under three headings on the
member picker and the staff interest filter. Nothing branches on it, so a role
in the wrong group is a cosmetic bug rather than a broken workflow.

### Volunteer profile

What we know about somebody as a _volunteer_, as opposed to as a member. It
exists for one question — "are you 18 or older?" — whose answer has to be on file
before anybody claims a shift, because the collective owes minors a different
process.

```
volunteer_profile
  id                uuid pk
  userId            uuid fk → user  (cascade, unique — one per member)
  firstName         text
  lastName          text
  isAdult           boolean
  status            'active' | 'blocked'   default 'active'
  availability      text null
  approvedByUserId  uuid fk → user null (set null)
  approvedAt        timestamp null
  createdAt, updatedAt
```

**Two statuses, not three.** There is exactly one reason to be `blocked` today —
an under-18 self-signup — and it always means "a person has to look at this", so
`blocked` doubles as the staff review queue.

**`isAdult` is a separate fact from `status`, deliberately.** Approving a minor
moves `status` and leaves `isAdult` alone, because staff still need to know they
are working with a minor afterwards. A three-state status would have erased that
at the exact moment it started mattering.

**First and last name live here, not on `user`.** `user.name` is the display name
the member chose, and the directory, staff tables and emails all render it. A
sign-in sheet and a waiver want the parts separately, and rewriting `name` to get
them would change how that member appears everywhere else.

**Pronouns and phone are not duplicated here.** Both already exist on `user`,
`/member/account` edits them, and a second copy would be stale by the next time
anybody looked — so onboarding writes back to those columns. Use `user.phone`,
not `directoryContact.phone`: the latter is opt-in _display_ data with its own
visibility toggle, and reusing it would conflate "publish this" with "reach me".

`availability` is a free-text note ("weekday evenings, some weekends"). It hangs
off the profile rather than the interest join table because it describes the
person, not the role.

### Role interest

A member's standing "I'd help with this" — the gap between someone reading
`/contribute` and someone logging hours. It says who to contact when a role
needs filling; it is not a commitment to a date, which is what a Phase 2 shift
claim would be.

```
volunteer_role_interest
  id                uuid pk
  userId            uuid fk → user            (cascade — the member is the subject)
  volunteerRoleId   uuid fk → volunteer_role  (cascade — unlike a log, no history to keep)
  createdAt         timestamp
  unique (userId, volunteerRoleId)
```

The member owns the set outright and staff never edit it, so the only mutation
is "replace my set with this one". There is no status column: the row exists or
it doesn't. Interests are member-only by design — an earlier draft took
anonymous public sign-ups, which needed Turnstile, a parallel identity keyed by
email, and its own unsubscribe tokens; requiring a (free) account deletes all
three problems.

### Hour log

One member's claim of time worked in one role on one day.

```
volunteer_hour_log
  id                uuid pk
  userId            uuid fk → user            cascade
  volunteerRoleId   uuid fk → volunteer_role  restrict
  shiftId           uuid? fk → volunteer_shift set null   — added in Phase 2
  workedOn          timestamp                 — calendar date, anchored at noon club time
  minutes           integer                   — 1..720, check-constrained 1..1440
  description       text                      — what the member actually did
  status            text                      — pending | approved | rejected
  reviewedByUserId  uuid? fk → user           set null
  reviewedAt        timestamp?
  reviewNotes       text?                     — required on reject
  createdAt         timestamp
  updatedAt         timestamp
```

**`workedOn` is anchored at noon club time**, built with
`buildDateInTz(dateStr, '12:00', DEFAULT_TIMEZONE)`. It is conceptually a
calendar date, but this codebase has no text-date columns, so it is a timestamp
like every other date.

Noon rather than midnight because the report buckets months with
`strftime('%Y-%m', worked_on, 'unixepoch')`, which reads the instant in UTC. Noon
local lands mid-day in UTC at any offset from −11 to +11, so the UTC month always
matches the local date. Midnight local would in fact work for the Americas
(00:00 PT is 07:00 UTC, same day) — but it breaks the moment the anchor is a
UTC-ahead zone, where midnight local is the _previous_ UTC day and every
1st-of-the-month log buckets into the prior month. Noon costs nothing and removes
the class of bug. `hour-log-service.spec.ts` pins it.

**`shiftId` shipped as a bare text column and became a real foreign key in
Phase 2.** Phase 1 must not create an empty `volunteer_shift` table just to
satisfy a constraint, so it did not; Phase 2 added the FK
(`onDelete: 'set null'`), which forced the SQLite table rebuild this paragraph
anticipated. `volunteer_hour_log` has no FK children, so the D1 cascade hazard
documented in `docs/development/conventions.md` did not apply and
`pnpm db:generate`'s rebuild script handled it unattended — the prediction is
recorded here because it held.

---

## Status lifecycle

```
              ┌────────► approved
              │
   pending ───┤
     │        │
     │        └────────► rejected
     ▼
  (deleted)
```

- **pending** — submitted, awaiting staff review. The only status the member can
  edit or withdraw, and the only one staff can act on.
- **approved** — counted in every report. Terminal.
- **rejected** — carries `reviewNotes` explaining why, so the member can correct
  and resubmit. Excluded from all reports. Terminal.

**Withdrawal is a hard delete**, not a fourth status. A member may delete their
own `pending` log; nothing downstream references an hour log, so there is no
audit trail to preserve, and a `withdrawn` status would be a value no report ever
selects. Once reviewed, a log is immutable to the member.

Re-review is not supported: approve and reject both require `status = 'pending'`
and throw `HourLogAlreadyReviewedError` otherwise. Staff who approve by mistake
ask the member to resubmit.

---

## Submission and review

### Member submits

1. Member opens `/member/volunteer` and reads the active roles and their job
   descriptions.
2. Member opens the Log Hours modal, picks a role, a date, a duration in
   quarter-hours, and describes what they did.
3. Service validates (see below), writes the row as `pending`, and emits
   `volunteer.hours_submitted`.
4. All staff get an in-app notification. No email — a log every few days is
   queue work, not news.

While the log is `pending`, the member can edit any field or withdraw it
entirely. Both are gone the moment staff act.

### Staff reviews

1. Staff opens `/staff/volunteer`, which lands on the Pending tab with a count
   badge.
2. Staff approves (optional note) or rejects (required note).
3. Service sets `status`, `reviewedByUserId`, `reviewedAt`, and `reviewNotes`,
   then emits `volunteer.hours_approved` or `volunteer.hours_rejected`.
4. The member gets an in-app notification and an email carrying the date, role,
   hours, and — on a rejection — the reason.

### Validation

All of it lives in the service layer, not the form.

| Rule          | Limit                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------ |
| `minutes`     | integer, `1 … VOLUNTEER_MAX_MINUTES_PER_LOG` (720). DB check constraint backstops at 1440. |
| `description` | trimmed, `1 … VOLUNTEER_DESCRIPTION_MAX` (1000)                                            |
| `reviewNotes` | `≤ 1000`; required and non-empty on reject                                                 |
| `workedOn`    | not in the future, club time                                                               |
| `workedOn`    | no earlier than `VOLUNTEER_BACKDATE_LIMIT_DAYS` (90) ago                                   |

Both date rules compare **calendar dates in club time**, not the stored instant
against `now`. Because `workedOn` is pinned to noon, an instant comparison
rejected the current day all morning — at 10am, noon today is still ahead, so
every same-day submission came back as "a future date". For the same reason the
member form's date input defaults to `clubToday()` rather than the UTC date,
which from 5pm PT onward is already tomorrow.
| `volunteerRoleId` | must exist, and must be `isActive` **on submit** |
| edit / withdraw | requires `status = 'pending'` **and** `log.userId === userId` |
| approve / reject | requires `status = 'pending'` |

**The active-role check applies to submission, not review.** A role archived
while logs sit in the queue must not strand them — staff can still approve, and
the report still resolves the role name.

---

## Reporting

`/staff/volunteer/report` takes a date range (defaulting to the current calendar
year in club time) and answers four questions, all over `status = 'approved'`
only:

- **Totals** — total hours, distinct volunteers, log count, average hours per
  volunteer. The headline numbers for a board packet.
- **By member** — paginated, hours descending, with log count and last-worked
  date. Counts distinct users, not rows.
- **By role** — with a percent-of-total column, so it is visible where the labor
  actually goes. Includes archived roles.
- **By month** — a trend table; grant applications ask for one.

Tables, not charts. There is no charting dependency in the app and this does not
justify adding one.

**Not cached.** `getCommunityStats` wraps its aggregate in a 24-hour KV cache
because public pages hit it on every request. This is a staff page over a
date-filtered table of hundreds of rows; a report that goes stale immediately
after an approval is worse than a report that takes an extra 30ms.

---

## Phase 2: opportunities and shifts

**Built.** `volunteer_shift` and `volunteer_signup` shipped as designed, with
two deliberate narrowings: shifts do not recur (staff duplicate a shift forward
— the copy is an ordinary shift with no series bookkeeping), and members claim
but do not propose. A post-shift feedback survey (`volunteer_shift_feedback`,
below) shipped alongside, which this section's original text did not anticipate.

Role interest is the standing half of this: it records who _would_ do a job. A
shift is the dated half — who is doing it on Saturday. The join shipped as
designed: the member board orders shifts you already claimed first, then roles
you expressed interest in, then the rest.

The shape: a `volunteer_shift` row is a dated, time-bounded need for a
`volunteerRoleId` — "two Front Desk, Saturday 6–10pm" — optionally attached to an
`event` or (once Productions ships) a `production`. Members browse open shifts on
`/member/volunteer`, claim one, and staff confirm. A `volunteer_signup` row joins
member to shift with its own small lifecycle (`claimed → confirmed → completed`,
plus `cancelled` and `no_show`).

### Attaching a shift to a show

`volunteer_shift.eventId` shipped with the table and then sat unreachable for a
release: the column, the service and the remote form schema all carried it, but
no form ever rendered a field for it, so every shift in production was
unattached. It is reachable from three places now, chosen because they are the
three moments the answer is actually known:

- **The shift forms** (`/staff/volunteer/shifts`, and a role's own page) carry a
  type-to-search event picker, on `searchEvents`. Blank is a legitimate answer —
  work parties and gear-repair days are why the column is nullable.
- **The shift detail page** has an Edit action, which is where a link is added or
  removed after the fact. `updateShift` had been written and had no caller, so
  until now a shift with the wrong time could only be cancelled and rebuilt,
  dropping every claim on it.
- **The staff event page** carries a Volunteer Shifts card: what is staffing this
  show, needed-vs-claimed, and a Schedule action with the event already locked in
  and the times prefilled from doors. This is the direction the work actually
  runs — make the event, then staff it.

Two decisions inside that are easy to reverse by accident:

- **`searchEvents` orders by distance from now, not by newest.** A venue has five
  rows called "Open Mic Night"; `desc(startsAt)` returns the one furthest in the
  future, which is never the one the staffer meant. It also drops cancelled and
  rejected events, which `listAll` keeps — that one is an admin index, this is a
  picker, and you do not staff a show that is not happening.
- **The picker's hidden input is rendered even when nothing is selected.**
  `updateShift` writes `eventId` only when the key is present, so an absent field
  means "untouched" and an empty one means "cleared". Emit the field only while
  something is picked — which is what `SearchSelect`'s own `name` prop does — and
  an event can be attached and then never removed, with the form reporting
  success both times. Pinned by an e2e test that reads the row back, because the
  page shows the stale value only after a reload.

How it connects to Phase 1, all shipped:

- `volunteer_hour_log.shiftId` is a real FK (set-null — deleting a shift must
  not delete hours somebody worked). A completed shift pre-fills an hour log the
  member confirms rather than composes, and the review queue badges shift-filed
  logs as "scheduled" so staff can approve them with less scrutiny.
- `volunteer_role` grew `defaultDurationMinutes` and `defaultCapacity`,
  prefills for the shift form only. "Requires training" is not one of them —
  that is what certifications express.
- Certifications gate claiming, checked **as of the shift's date**: a card that
  lapses next week does not cover a shift the week after. A member who can't
  claim sees the missing clearance by name rather than a hidden shift.
- Three crons: `complete-shifts` (15-minute group; only `confirmed` signups
  complete — an unconfirmed claim is not evidence anyone worked),
  `shift-reminders` (daily batch — the 09:00 reminder carried in the parity
  report since the Laravel app), and `shift-feedback` (daily batch, window
  tiled `[48h, 24h)` ago so a non-answer is asked exactly once).
- `production_slot` staffing still waits for Productions itself.

### Post-shift feedback

One row per signup (`volunteer_shift_feedback`, unique on signupId): a 1–5
rating, a separate "were you set up to succeed?" boolean, and an optional
comment. The two questions are deliberately distinct — enjoyment and
preparedness pull apart exactly where a briefing needs work. Staff see
responses on the shift detail and an **anonymous** per-role rollup on the
report; names would just teach volunteers to answer politely. The emailed link
carries the signup id, which is not a secret — the session authorizes, and
somebody else's signup renders as absent.

---

## Certifications

**Built, as designed below.** The domain model survived contact with
implementation unchanged. Two UI-level deviations: the role requirements picker
is a checkbox group rather than a TagInput, and the clearances view is its own
page (`/staff/volunteer/clearances`) rather than a section of the catalog.
Certifications answer "who can run the desk?" on their own, and are what
shift-claiming checks.

Some volunteer work needs clearance before someone does it alone. Two different
things wear that name and the model has to hold both:

- **Internal clearances** the collective grants itself — "cleared on the sound
  desk", "holds a door code". No issuer, usually no expiry.
- **External cards** a member brings — Food Handler, First Aid/CPR, OLCC alcohol
  service. Issued by somebody else, carry a number, and _lapse_.

### Key concepts

**A certification is a thing, not a property of a role.** First Aid is not a
volunteer role and never will be, and one clearance frequently covers several
roles — sound desk clearance applies to Sound Engineering and to Load-Out. So
certifications live in their own catalog and roles _reference_ them, rather than
each role carrying a `requiresTraining` flag. The alternative was considered and
rejected: it has nowhere to put First Aid, and forces training that clears two
roles to be recorded twice.

**Held certifications are append-only, not overwritten on renewal.** A renewal
writes a new row. This is not tidiness — it is the only way to answer the
question that actually gets asked after an incident: _was their First Aid current
on the day they worked that shift?_ Overwriting the grant date destroys exactly
that. "Does this member hold X **now**" is the most recent row by `grantedAt`.

**Expiry is derived from dates, never stored as a status.** A `status` column
saying `expired` is wrong the moment the clock passes midnight, and keeping it
right needs a cron whose only job is to age rows. Current / expiring soon /
expired is computed from `expiresAt` against today in club time, the same way
the rest of this module compares dates.

**`expiresAt` is stamped at grant time, not computed on read.** It is derived
from the catalog's `validityMonths` when the record is created and then stored.
Computing it live would mean that editing "Food Handler: 3 years" to 2 years
retroactively expires cards that were validly issued for three.

**Certifications are advisory in Phase 1 and never block logging hours.** Someone
who did the work should be able to record it; refusing the hours does not un-do
the work, it just loses the data. The staff review queue flags a log whose role
requires a certification the member did not hold **on the date worked** — which
is a prompt to have a conversation, not a rejection. Gating belongs at
shift-claiming, where it prevents something.

### Domain model

#### Certification

The catalog. Staff-managed, same shape and rules as a volunteer role.

```
volunteer_certification
  id              uuid pk
  name            text unique   — "Sound Desk Cleared", "Food Handler"
  description     text?         — markdown: what it covers, how to get it
  issuedBy        text?         — null = internal to CMC; "Oregon Health Authority" etc.
  validityMonths  integer?      — null = does not expire
  displayOrder    integer
  isActive        boolean       — archived; hidden from the grant form only
  createdAt       timestamp
  updatedAt       timestamp
```

#### Held certification

One member holding one certification, once. Renewals append.

```
member_certification
  id                uuid pk
  userId            uuid fk → user                     cascade
  certificationId   uuid fk → volunteer_certification  restrict
  grantedAt         timestamp   — calendar date, noon club time
  expiresAt         timestamp?  — stamped from validityMonths at grant; null = never
  grantedByUserId   uuid? fk → user                    set null
  reference         text?       — external card or licence number
  notes             text?
  revokedAt         timestamp?  — pulled early; null = not revoked
  revokedReason     text?       — required when revokedAt is set
  revokedByUserId   uuid? fk → user                    set null
  createdAt         timestamp
  updatedAt         timestamp
```

No unique constraint on `(userId, certificationId)` — that is the append-only
decision made structural.

##### Revocation

**Pulling a clearance is recorded, not deleted.** The distinction that matters is
not whether there was fault; it is **whether the record was ever true**:

| Case                                | Action                                             |
| ----------------------------------- | -------------------------------------------------- |
| Typo, wrong member, never relied on | Hard delete — it was never true                    |
| Was true, is not now — any reason   | Set `revokedAt` — the window it covered is history |

Deleting a clearance that someone actually held destroys the answer to "were they
cleared on the night of the incident?", which is the entire reason this table is
append-only. That holds regardless of why it was pulled — and it holds even if
the member is later banned outright, because you still want the record of what
they were cleared for while they worked.

The reasons are mostly blameless, which is why "just ban them" is not the
alternative: a volunteer who keeps mis-patching the desk loses that clearance and
keeps doing load-out; a replaced desk voids everyone's clearance on the old one;
an external card can be pulled by its issuer; someone joining the board should
stop handling door cash. Revocation is also the proportionate middle rung for
conduct that does not warrant losing a member — pull the solo clearance, require
supervision.

`revokedReason` is required whenever `revokedAt` is set, for the same reason a
rejected hour log needs one: the next staffer looking at the list needs to know
why this person is no longer on it.

#### Role requirement

```
volunteer_role_certification
  volunteerRoleId   uuid fk → volunteer_role           cascade
  certificationId   uuid fk → volunteer_certification  cascade
  primary key (volunteerRoleId, certificationId)
```

Cascade on both sides: this row is a link, not a record of anything that
happened, so deleting either end should take it. That is the difference from
`member_certification`, which restricts — a held certification is history.

Three tables, taking the app from 31 to 34.

### Derived state

| State             | Condition                                                                    |
| ----------------- | ---------------------------------------------------------------------------- |
| **current**       | `revokedAt` null, `grantedAt <= today`, and (`expiresAt` null or `>= today`) |
| **expiring soon** | current, and `expiresAt` within `CERT_EXPIRY_WARNING_DAYS` (60)              |
| **expired**       | `revokedAt` null and `expiresAt < today`                                     |
| **revoked**       | `revokedAt <= today`                                                         |
| **never held**    | no row                                                                       |

All comparisons against today in club time, via `clubToday()` — the same rule
that keeps same-day hour logging working.

"Was this member cleared on a given date" is the same predicate with `today`
swapped for the date worked, and it is the whole reason for the shape:

```
grantedAt <= worked
  and (expiresAt is null or expiresAt >= worked)
  and (revokedAt is null or revokedAt  >  worked)
```

Note `revokedAt > worked`, not `>=`: a clearance pulled _on_ the day of a shift
was not in force for that shift. Expiry uses `>=`, because a card is valid
through its expiry date. The asymmetry is deliberate and easy to get backwards.

### Staff UI

- **`/staff/volunteer/certifications`** — the catalog, mirroring
  `/staff/volunteer/roles` exactly: table, create/edit modals, archive rather
  than delete, and delete offered only for an entry nothing references. Editing
  `validityMonths` warns that it applies to future grants only.
- **Role editing** gains a required certifications editor, on the role detail
  page (a `CheckboxGroup` in its own `Action`, not a field on the edit form).
- **Member detail** gains a Certifications card: what they hold, when granted,
  when it expires, who granted it, and a Grant action. Revoke takes a required
  reason. Delete is offered only for a record created today by the same staffer
  — the correcting-a-typo window — so that the ordinary way to end a clearance
  is the one that keeps its history.
- **The review queue** shows a warning glyph on a log whose role required a
  certification the member did not hold on the date worked. Advisory only.
- **A "clearances" view** — who is current, who is expiring, who has lapsed —
  is the natural companion to the hours report. Worth building with the catalog
  rather than after it.

### Member UI

`/member/volunteer` gains a Certifications block: what you hold, what expires
when, and — for a role you are not cleared for — what the role requires and how
to get it (the catalog's markdown description is where that copy lives). This is
the part that turns the page from a form into something worth opening.

### Permissions

- **Grant, edit, revoke a member's certification**: staff. Revocation records who
  did it and why, so it is attributable the way an hour-log rejection is.
- **Manage the catalog and role requirements**: staff.
- **See your own certifications**: any member.
- **See anyone's**: staff.

No new auth roles — and this is what finally closes the question about the old
one. The single scenario that would have justified keeping the dead `volunteer`
auth role was expressing "cleared to claim shifts unsupervised". A certification
expresses that strictly better: it is per-role rather than global, it records
who cleared them and when, and it can lapse. The recommendation to delete the
auth role is now unconditional.

### Deferred within certifications

- **Expiry reminders.** A daily cron mailing members whose card lapses inside
  the warning window, and staff a digest. Wants a `volunteer_certification_expiring`
  notification type. Deferred because it is only worth building once real expiry
  dates are in the table — and it should be folded into the Phase 2 shift-reminder
  cron rather than shipping a second daily job.
- **Evidence upload.** Photographing a Food Handler card. Needs the media work
  tracked in `CHORES.md`; `reference` carries the number in the meantime.
- **Self-service claims.** A member asserting they hold a card, pending staff
  verification. Phase 1 of this is staff-entered only, which is the honest
  default for something that gates work.

---

## Module boundaries

### Inside the volunteering domain

- `volunteer_role`, `volunteer_hour_log` and `volunteer_role_interest` schema
- `volunteer-role-service.ts` — role CRUD, archive/restore, in-use guard
- `volunteer-interest-service.ts` — set/read a member's interests, list them for staff
- `hour-log-service.ts` — submit, edit, withdraw, approve, reject, list
- `volunteer-report-service.ts` — the four aggregates
- `volunteer.remote.ts` — guards and form/query wiring

### Integration points

- **Feature flags** — `requireFeature('volunteering')` at the top of every
  **member** remote function, and on the member nav item. Staff remotes and the
  staff nav deliberately omit it (#171).
- **Notifications** — three new `NOTIFICATION_TYPES` and three listeners on the
  existing domain event bus. No new Postmark templates; the generic `notification`
  alias covers all three.
- **User** — read-only. Hour logs join `user` for display and `primaryRoleFor()`
  for the `MemberLink` glyph.
- **Markdown** — job descriptions render through the existing
  `src/lib/utils/markdown.ts` and `ProseBlock`.

### What doesn't touch volunteering

- **Credits and finance** — explicitly, and there is a test.
- Reservations, bands, equipment, tickets, events, directory — no interaction in
  Phase 1. Events become a Phase 2 integration point.

---

## Schema

Phase 1 added two tables, taking the app from 29 to 31. Phase 2 added six more
(shifts, sign-up, feedback, and the three certification tables) — see
[Certifications](#certifications).

### volunteer_role

```sql
CREATE TABLE volunteer_role (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL UNIQUE,
  description    TEXT,
  display_order  INTEGER NOT NULL DEFAULT 0,
  is_active      INTEGER NOT NULL DEFAULT 1,
  created_at     INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at     INTEGER NOT NULL DEFAULT (unixepoch())
);
```

### volunteer_profile

```sql
CREATE TABLE volunteer_profile (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL UNIQUE REFERENCES user(id) ON DELETE CASCADE,
  first_name          TEXT NOT NULL,
  last_name           TEXT NOT NULL,
  is_adult            INTEGER NOT NULL,
  status              TEXT NOT NULL DEFAULT 'active',
  availability        TEXT,
  approved_by_user_id TEXT REFERENCES user(id) ON DELETE SET NULL,
  approved_at         INTEGER,
  created_at          INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at          INTEGER NOT NULL DEFAULT (unixepoch())
);

-- The staff review queue: blocked profiles, oldest first.
CREATE INDEX volunteer_profile_status_idx ON volunteer_profile(status, created_at);
```

`user_id` cascades — the member is the subject of the row, the same call
`volunteer_hour_log.user_id` makes. `approved_by_user_id` is set-null, matching
`reviewed_by_user_id`: a departed staffer must not take the record of the
approval with them. The unique constraint on `user_id` is what actually enforces
one profile per member; the service checks first, but two tabs racing would
otherwise both write.

### volunteer_hour_log

```sql
CREATE TABLE volunteer_hour_log (
  id                   TEXT PRIMARY KEY,
  user_id              TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  volunteer_role_id    TEXT NOT NULL REFERENCES volunteer_role(id) ON DELETE RESTRICT,
  shift_id             TEXT,
  worked_on            INTEGER NOT NULL,
  minutes              INTEGER NOT NULL,
  description          TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'pending',
  reviewed_by_user_id  TEXT REFERENCES user(id) ON DELETE SET NULL,
  reviewed_at          INTEGER,
  review_notes         TEXT,
  created_at           INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at           INTEGER NOT NULL DEFAULT (unixepoch()),
  CONSTRAINT volunteer_minutes_positive CHECK (minutes > 0 AND minutes <= 1440)
);

CREATE INDEX volunteer_hour_log_user_idx      ON volunteer_hour_log(user_id);
CREATE INDEX volunteer_hour_log_status_idx    ON volunteer_hour_log(status, worked_on);
CREATE INDEX volunteer_hour_log_worked_on_idx ON volunteer_hour_log(worked_on);
CREATE INDEX volunteer_hour_log_role_idx      ON volunteer_hour_log(volunteer_role_id);
```

`status_idx` backs the pending queue, `worked_on_idx` the date-range report,
`role_idx` the by-role rollup and the delete guard.

**FK choices.** `user_id` cascades — the member is the subject of the row, so a
hard account purge should take it, matching `equipment_loan.user_id`.
`reviewed_by_user_id` is set-null, matching `content_flag.resolved_by_user_id` —
a departed staffer must not delete the review. `volunteer_role_id` restricts,
because reports depend on it resolving.

### Certification tables (designed, not created)

```sql
CREATE TABLE volunteer_certification (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL UNIQUE,
  description      TEXT,
  issued_by        TEXT,
  validity_months  INTEGER,
  display_order    INTEGER NOT NULL DEFAULT 0,
  is_active        INTEGER NOT NULL DEFAULT 1,
  created_at       INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at       INTEGER NOT NULL DEFAULT (unixepoch()),
  CONSTRAINT validity_months_positive CHECK (validity_months IS NULL OR validity_months > 0)
);

CREATE TABLE member_certification (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  certification_id   TEXT NOT NULL REFERENCES volunteer_certification(id) ON DELETE RESTRICT,
  granted_at         INTEGER NOT NULL,
  expires_at         INTEGER,
  granted_by_user_id TEXT REFERENCES user(id) ON DELETE SET NULL,
  reference          TEXT,
  notes              TEXT,
  revoked_at         INTEGER,
  revoked_reason     TEXT,
  revoked_by_user_id TEXT REFERENCES user(id) ON DELETE SET NULL,
  created_at         INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at         INTEGER NOT NULL DEFAULT (unixepoch()),
  -- A revocation without a reason is unactionable for whoever reads the list next.
  CONSTRAINT revoked_has_reason CHECK (
    revoked_at IS NULL OR (revoked_reason IS NOT NULL AND length(trim(revoked_reason)) > 0)
  )
);

CREATE TABLE volunteer_role_certification (
  volunteer_role_id TEXT NOT NULL REFERENCES volunteer_role(id) ON DELETE CASCADE,
  certification_id  TEXT NOT NULL REFERENCES volunteer_certification(id) ON DELETE CASCADE,
  PRIMARY KEY (volunteer_role_id, certification_id)
);

-- "what does this member currently hold", the query every screen runs
CREATE INDEX member_certification_user_idx ON member_certification(user_id, certification_id, granted_at);
-- the expiring-soon sweep and the future reminder cron
CREATE INDEX member_certification_expiry_idx ON member_certification(expires_at)
  WHERE expires_at IS NOT NULL;
```

Deliberately **no** unique constraint on `(user_id, certification_id)`: renewals
append, and a unique index would forbid exactly the history the model exists to
keep. `granted_at` is the third column of the user index so "most recent grant"
is an index scan rather than a sort.

Enum tuples and limits live in `src/lib/config.ts`, not the schema file, so
Svelte pages can import them — `flag.ts` declared its tuples inline and
`/staff/flags` had to re-declare them locally as a result.

Migrations are generated with `pnpm db:generate`, not hand-written. Both tables
are purely additive.

`scripts/d1-table-order.mjs` gains `volunteer_role` then `volunteer_hour_log`,
in that order — it is the single source of truth for FK-safe insert and delete
ordering.

---

## Staff UI

Everything follows `docs/development/ui-patterns.md`.

### `/staff/volunteer` — the approval queue

Built on the work-queue pattern from `/staff/inbox`, the most recent version of
it.

- `TabBar` with count badges: Pending, Approved, Rejected, All.
- `FilterBar`: member search, role `Select`, from/to date inputs.
- `DataList` → `Table`, six columns: status glyph, member (`MemberLink`), role,
  date worked, hours (`cell-num`), actions. The description rides on the primary
  cell rather than taking a column.
- Row actions are `Action` modals: Approve with an optional note, Reject with a
  required one.
- Filter state is URL-backed so a reload keeps the view.

No `/staff/volunteer/[id]` detail route — the modal shows the whole record, and
another route is another thing to guard.

### `/staff/volunteer/roles` — the coordinator's home

The list and its detail page absorbed the standing-interest table, which used to
live at `/staff/volunteer/interest`. One nav item, because the two were halves of
one dataset: per-role interest counts were already the interest page's filter
dropdown, and "who would do this" is a fact about a role.

- One `InfoCard` per role group, group order taken from `volunteerRoleGroups`
  rather than the data so sections stay put as roles are added; empty groups drop
  out rather than rendering a bare heading.
- `Table` per section: active/retired glyph, name with description preview and
  required-certification badges, unfilled-shift count, interest count, log count,
  display order. Rows navigate; there are no row actions.
- Retired roles are hidden behind an **Include retired** filter, URL-backed as
  `?retired=1`. They are hidden, never dropped — the work done under them still
  resolves in every report.
- **Unfilled** counts upcoming, uncancelled shifts still short of capacity, so
  landing on the page answers "what needs attention" before "how many are
  interested". An em dash at zero, so a short role is the only thing drawing the
  eye.

### `/staff/volunteer/roles/[id]` — role detail

Every mutation lives here rather than on the list. Note that each `Action` sits
_outside_ the edit `<Form>`: `Button` renders a bits-ui `Button.Root` which
leaves `type` unset, so a trigger nested in the form would post the role edit.

- **Role Info** — an edit `Form`: name, markdown description, group, display
  order, plus the shift defaults (`defaultDurationMinutes`, `defaultCapacity`)
  that prefill the New Shift form. Defaults, not limits.
- **Requirements** — the role's certifications, edited through
  `setRoleCertifications`. Its own `Action` rather than a field on the edit form:
  it posts an array to a different remote, and folding it in would mean one form
  writing to two services.
- **Upcoming Shifts** — next shifts with `claimed/capacity` and a short marker,
  and a New shift action prefilled from this role's defaults. The `from` bound is
  pinned once at page setup: `refresh()` is keyed by argument, so a clock-derived
  bound would mint a new key per evaluation and the post-create refresh would
  miss.
- **Interested Members** — who picked this role, paginated, with copy-emails.
  `since` is when they picked _this_ role, not the earliest thing they ticked.
  When the role requires certifications the list gains a readiness glyph and a
  "N of M ready" count, computed from two queries for the whole page rather than
  two per member; a role that requires nothing renders no such column.
- **How it's going** — the anonymous per-role feedback rollup.
- Archive, restore, and delete live in the page header. Delete on a role with
  logs surfaces `VolunteerRoleInUseError` as a message pointing at archive.

`/staff/volunteer/interest` remains as a 308 redirect, now pointing at
`/staff/volunteer/people` — a bookmark to that URL was always after names, not
roles.

### `/staff/volunteer/people` — the volunteers index

The people half of the old interest page, back as its own route. The roles page
answers "who wants Door?"; this one answers "who are our volunteers?", which the
roles page structurally cannot — a coordinator looking for a name had nowhere to
start.

**Keyed on `volunteer_profile`, not on interest rows.** The interests step is
skippable and a blocked minor never reaches it, so an interest-keyed list drops
the two groups staff most need to see: the person who signed up and picked
nothing, and the minor waiting on approval. `listVolunteers` left-joins the
interests for that reason, where its sibling `listInterestedMembers` inner-joins
them.

- `FilterBar`: member search, an **Interested in role** `Select` (the same
  `RoleOptions`), and a status `Select` (Active / Awaiting review). URL-backed,
  like the hours queue.
- Five columns: status glyph with a `minor` marker, member, interest badges,
  lifetime approved hours, and the date they onboarded. An em dash on the
  interests column is a real answer — they signed up without picking anything —
  not missing data.
- The role filter is an **EXISTS**, so a filtered row still shows every role that
  member picked; narrowing the list must not narrow the row.
- Hours are a correlated subquery, deliberately not a join: joining the hour log
  alongside the interest join is a cartesian product, and the `group_concat`
  would emit a role name once per approved log.
- No detail route. Rows lead to `/staff/users/[id]?tab=volunteer`, which is
  already the per-member volunteer record.

### `/staff/volunteer/report`

A separate route rather than a tab, mirroring `/staff/equipment` ↔
`/staff/equipment/loans` (renamed to `/staff/inventory/**` in #286).

- Two date inputs, defaulting to the current calendar year.
- `StatCard` row: total hours, volunteers, logs, average per volunteer.
- By-member `DataList` + `Table`; by-role and by-month tables in `InfoCard`s.

---

## Member UI

### Onboarding — `/member/volunteer/{start,interests,blocked}`

Three routes, gated in that order, reached by anybody who opens
`/member/volunteer` without a profile.

1. **`/start`** — first name, last name, pronouns, phone, and the 18-or-older
   answer. Email is shown read-only with a link to account settings; it is the
   login address and changing it runs through its own verification flow. Pronouns
   and phone are _not_ read-only, because the account page edits both freely and
   a read-only phone would strand the many members who have never set one.
2. **`/interests`** — the role checkboxes and the availability note. Skippable:
   the profile already exists by this point, so the gate passes either way, and a
   member whose thing isn't in the catalogue must not be stuck here.
3. **`/blocked`** — where an under-18 answer lands. Terminal by design: no form,
   no retry, no way to re-answer. Staff clear them from `/staff/volunteer`.

**Three routes rather than a `Form.Step` wizard**, for two reasons.
`registerStep()` only ever increments `totalSteps` and nothing decrements on
unmount, so a step that exists conditionally corrupts the index bookkeeping — and
one wizard is one submit, so a minor would see the whole role list before the
server ever saw their answer.

**Gating happens inside the remote queries**, matching `getMemberLayout` — this
app has no `+layout.server.ts` anywhere. The shared data query is deliberately
_not_ one of the gates: every gated route reads it, so a redirect in there would
make `/start` bounce itself in a loop.

### `/member/volunteer`

The shift board. Three header actions over a body that is shifts and hours:

1. **Log Hours** — an `Action` modal, not a `/new` route. Role select over active
   roles, date, hours (`step="0.25"`), description.
2. **Interests** — the same role checkboxes as the onboarding step, in a modal.
   It used to sit open in the middle of the page, which pushed the shift board
   below the fold on every visit. It belongs beside the board rather than in it,
   since `OpenShifts` orders by exactly this set.
3. **Profile** — the `/start` fields minus the age question. Re-submitting that
   answer is how a blocked minor would unblock themselves, so
   `updateVolunteerProfile` does not accept `isAdult` or `status` at all.

Body: `StatCard` row (approved, this year, pending), completed shifts with no
log yet, the open-shift board, then a `Table` of your logs or an `EmptyState`.
Edit and withdraw actions appear on `pending` rows only.

The role catalogue with its markdown job descriptions now lives inside the
Interests modal and on the public `/contribute` page, rather than in the page
body. A member who never opens the modal no longer sees it — the accepted cost of
a body that is about shifts.

---

## Notifications

| Key                         | Trigger              | Recipient  | Channels       |
| --------------------------- | -------------------- | ---------- | -------------- |
| `volunteer_hours_submitted` | member submits a log | all staff  | in-app         |
| `volunteer_hours_approved`  | staff approves       | the member | in-app + email |
| `volunteer_hours_rejected`  | staff rejects        | the member | in-app + email |

Staff get in-app only, matching `inbox_message_received` and `content_flagged` —
routine queue work. Emailing every staffer on every log would train them to
ignore it.

Member notifications use the generic `notification` Postmark alias with detail
rows for Date, Role, and Hours, plus Reason on a rejection, and a CTA to
`/member/volunteer`. No new templates, so no `pnpm email:push`.

Staff fan-out goes through `listStaffUsers()` with a per-recipient try/catch, so
one bad address does not swallow the rest — the inbox listener's shape, not
`equipment.loan_requested`'s single-address `dispatchEmailOnly`, which produces
no in-app badge and honors no per-staff preference.

---

## Permissions

- **Log hours, edit or withdraw your own pending log**: any authenticated member.
- **Read the role list and descriptions**: any authenticated member (active roles
  only).
- **Approve or reject**: staff.
- **Create, edit, archive, or delete roles**: staff.
- **Read the report**: staff.

No new auth roles or permissions. Every remote function guards — the remote
function is the security boundary, not the layout. Staff functions call
`requireStaff()` alone; member functions call `requireFeature('volunteering')`
and then `requireUser()`, because the flag gates the member surface only.

### Where the minor block is enforced

Not on the route. `/member/volunteer` redirects a blocked member, but a redirect
only stops somebody driving a browser — every remote function is a directly
callable endpoint. The check that actually keeps an under-18 signup off a shift
lives in the service layer, in three places:

- `claimShift` — before the shift lookup, so it runs ahead of the clearance and
  capacity guards.
- `submitHours` and `updateHourLog` — so a blocked member cannot file time either.

`completeVolunteerOnboarding` maps `isAdult: false` to `status: 'blocked'` in the
service for the same reason: a hand-crafted POST must not be able to route around
it. And `updateVolunteerProfile` accepts neither `isAdult` nor `status`, which is
the one thing that would let a blocked minor clear themselves.

### On the existing `volunteer` auth role

`scripts/seed-dev.ts` seeds a `volunteer` auth role and grants it to six users.
It is read by **zero** code paths. `docs/specs/admin-vs-staff-spec.md` open
question 3 asks whether it means anything or is dead weight.

This module does not revive it, and recommends deleting it:

- Phase 1 is "any member may log hours." Gating on a role would _shrink_ who can
  contribute at a volunteer-run nonprofit, and would require staff to hand-grant
  a role before anyone could file a first log.
- There is no `requireVolunteer` to hang it on. Adding one lands in the middle of
  that spec's unresolved open questions 1 and 2 — a tracking module should not be
  what forces that decision.
- `primaryRoleFor()` has a fixed `admin > staff > sustaining > member` ladder that
  four list pages depend on. `volunteer` is not in it, so holders already render
  as their fallback role.
- **This module makes the role redundant by making it derivable.** After this
  ships, "who volunteers here" is a query over approved hour logs in a date
  range — true by construction, where a hand-assigned flag goes stale the moment
  someone stops showing up.

The one case that would have justified keeping it — "cleared to claim shifts
unsupervised" — is answered better by a certification, which is per-role, dated,
attributable, and able to lapse. Nothing is left arguing for the auth role.
Deletion is still left out of this change set so it can be done on its own
terms, but it is no longer a question of _whether_.

---

## What changes

| Area                | Change                                                                                       |
| ------------------- | -------------------------------------------------------------------------------------------- |
| New schema          | `volunteer_role`, `volunteer_hour_log`                                                       |
| New services        | `volunteer-role-service`, `hour-log-service`, `volunteer-report-service`                     |
| New remote          | `src/lib/remote/volunteer.remote.ts`                                                         |
| New routes          | `/member/volunteer`, `/staff/volunteer`, `/staff/volunteer/roles`, `/staff/volunteer/report` |
| Feature flags       | `feature.volunteering`, default off                                                          |
| `src/lib/config.ts` | Status tuple, limit constants, `formatVolunteerHours()`                                      |
| `StatusBadge`       | `approved` and `rejected` mappings (both maps)                                               |
| Event bus           | 3 payloads, 3 event keys                                                                     |
| Notifications       | 3 `NOTIFICATION_TYPES`, 3 listeners                                                          |
| Nav                 | Staff Operations group, member panel                                                         |
| Seed                | Roles with job descriptions, ~50 status-weighted hour logs                                   |

## What doesn't change

| Area                                    | Notes                                                 |
| --------------------------------------- | ----------------------------------------------------- |
| Credit system                           | Untouched, by design, with a test enforcing it        |
| Finance and Stripe                      | No interaction                                        |
| Auth roles and permissions              | No new roles; the dead `volunteer` role is left alone |
| Postmark templates                      | Generic `notification` alias covers all three emails  |
| Cron and `wrangler.toml`                | Phase 1 scheduled nothing; Phase 2 added three jobs   |
| Reservations, bands, equipment, tickets | No interaction                                        |

---

## Deferred

This list was written at the end of Phase 1. The first four entries have since
shipped in #235 and are struck through; the rest are still open.

- ~~**Opportunities, shifts, and sign-up**~~ — shipped. `volunteer_shift`,
  `volunteer_signup`, `/staff/volunteer/shifts`, `/member/volunteer/start`.
- ~~**Certifications**~~ — shipped. Three tables, `/staff/volunteer/certifications`
  and `/staff/volunteer/clearances`.
- ~~**The daily 09:00 shift-reminder cron**~~ — shipped, alongside
  `complete-shifts` and `shift-feedback`.
- ~~**Per-event and per-production staffing**~~ — the per-event half shipped; a
  shift can name the show it staffs. Productions still do not exist.
- **CSV export** — the report is what a board packet needs, and CSV is the
  obvious next ask. Deferred because there is no CSV endpoint anywhere in this
  app yet, and the first one should set the pattern deliberately rather than as
  a sub-bullet of this feature.
- **Bulk approve** — a festival weekend produces ten logs from one member and
  one-at-a-time is tedious. It is ~20 lines, but it would be the app's first bulk
  table action and deserves its own pattern decision.
- **Skill-tag matching** — IDEAS.md's Member Skill Tags entry describes feeding
  volunteer matching. That is a Phase 2 concern at the earliest.
- **Annual report integration** — IDEAS.md's Annual Report Generator wants
  volunteer hours as a headline stat. `getVolunteerTotals` is the query it will
  call; no work needed here.

---

## Open questions

None. Everything below was asked and answered during design; the answers are
kept so nobody re-opens them from scratch.

### Settled

- **`VOLUNTEER_BACKDATE_LIMIT_DAYS = 90`** — reviewed and kept. Fine to begin
  with; it is a constant, so changing it later costs nothing and needs no
  migration.
- **`CERT_EXPIRY_WARNING_DAYS = 60`** — reviewed and kept, on the same terms. It
  has no effect until the expiry-reminder cron is built.
- **The seeded role list** — left as seeded. Five of the eight names were
  inferred rather than drawn from the repo, but the catalog is staff-editable,
  so correcting them is typing rather than a migration. Not worth blocking on.
- **Which certifications CMC tracks** — First Aid and Food Handler are expected
  eventually, alongside internal sound-desk clearance. `issuedBy`,
  `validityMonths` and `reference` therefore all earn their place, and the
  standalone catalog is the right model: a role-attached training flag would
  have had nowhere to put either card.
- **Revoking a certification** — recorded, not deleted. See
  [Revocation](#revocation).
