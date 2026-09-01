# Volunteering: what happens when a coordinator actually uses it

> A hands-on pass over the volunteering module, driven as the volunteer coordinator, ahead
> of a workflow redesign. Companion to `docs/specs/shipped/volunteering-spec.md` (design
> rationale) and `docs/development/business-workflows.md` (shipped behaviour), and a
> deliberate echo of `docs/reports/inventory-workflow-findings.md`.
>
> **Status: findings complete. The restructure they argue for is separate work.**

## Why this exists

The module is fully shipped — 9 tables, 73 remote functions, 9 staff pages, 3 crons — and
every staff page is shaped around an **entity**: hour logs, volunteers, shifts, roles,
certifications. That is the right shape for a database and the wrong shape for the person
who runs volunteering, whose day is a list of **decisions**: who is working Saturday, who
still needs confirming, which shift is short and who do I ask, whose card lapses before the
show, whose hours are waiting.

The unit and e2e suites prove the module _behaves_. They cannot say that filling next
week's shifts means opening five pages and reading numbers that do not mean what they say.

So this is a friction log, not a bug hunt. Where a bug turned up it is marked separately.

The conclusion is the same one the inventory pass reached, for the same reason:
**the services are right, the doors into them are thin.** Almost every gap below is a
remote function or a page that was never written over a service that already takes the
parameter it needs.

## How it was driven

Local dev server on the worktree port, dev seed, signed in as `admin@corvallismusic.org`
(admin + staff + member). Read-backs went straight to the local D1. Priority order taken
from what a coordinator does most: fill and confirm next week's shifts, run the night,
clear the hours queue, keep clearances current, pull the report.

## Severity

| Mark       | Meaning                                                     |
| ---------- | ----------------------------------------------------------- |
| **BLOCKS** | The coordinator cannot do the job through the UI at all     |
| **SLOWS**  | Possible, but costs a page load and a modal per person      |
| **WRONG**  | The system says something untrue, or promises what it lacks |
| _note_     | Cosmetic, or a design question for the redesign             |

---

## A. Filling and running a shift

**The scenario.** Six shifts are on the books for the next four weeks, twelve places
between them. Somebody has to make sure each one has a person on it who knows they are
expected. This is the coordinator's whole job, and it is the part of the module that was
designed almost entirely from the member's side.

### A1. A coordinator cannot put anybody on a shift — **BLOCKS**

`claimShift` is member-only: the remote takes no user, reads `requireUser()`, and passes
`currentUser.id` (`src/lib/remote/volunteer.remote.ts:1279`). There is no staff equivalent
anywhere in the app. A volunteer who says "put me down for Saturday" in person, by text, or
at the front desk cannot be put down for Saturday.

The role page's answer to "who could do this" ends at the clipboard: **Copy emails on this
page** (`src/routes/staff/volunteer/roles/[id]/RoleInterestedCard.svelte:29`), whose own
comment concedes _"until there's an in-app way to mail volunteers"_.

**The service already does it.** `claimShift(shiftId, userId)`
(`src/lib/server/volunteer/volunteer-signup-service.ts:93`) takes the user as a parameter
and carries the whole guard set — active profile, shift open, capacity race, clearance as
of the shift's date, re-claim after a cancel. Only the remote is bound to the session.

### A2. A coordinator cannot take anybody off a shift — **BLOCKS**

`cancelSignup(signupId, userId)` filters on `eq(volunteerSignup.userId, userId)`
(`volunteer-signup-service.ts:164`), and its only caller is `cancelMySignup`, which passes
the session user. Staff have exactly one lever on a claimant: **No-show** — which the shift
page itself explains is a different fact:

> Different from cancelling: a cancellation is notice, a no-show isn't, and only one of
> them is worth remembering next time.

So when somebody drops out any way other than clicking their own button, the coordinator
chooses between leaving the shift falsely full and recording a no-show that did not happen.

### A3. Confirming is load-bearing and invisible — **SLOWS**

Confirmation is not a formality. Only `confirmed` signups get the day-before reminder; only
`confirmed` signups auto-complete (`completeFinishedShifts`); and only a **completed**
signup produces the pre-filled hour log and the feedback request (`listUnloggedCompletions`,
`listCompletionsAwaitingFeedback`). A claim nobody confirms silently produces no reminder,
no completion, no hours, and no feedback.

Nothing surfaces that a claim is waiting:

- **There is no `volunteer.signup_claimed` domain event.** The bus carries six volunteer
  events (`src/lib/server/event-bus/event-bus.ts:487-492`) and none of them is a claim, a
  cancellation, or a confirmation — so no notification fires in either direction. Staff are
  not told somebody signed up; the member is not told they are booked.
- **The sidebar badge counts pending hour logs only**
  (`src/lib/remote/layout.remote.ts:125`).
- **The shift list's one number conflates the two.** `claimed` counts
  `claimed + confirmed + completed` (`ACTIVE_SIGNUP_STATUSES`,
  `volunteer-shift-service.ts:259`), so a shift with two unconfirmed claims renders `2/2` in
  ordinary type, identical to a shift that is genuinely staffed.

**Demonstrated.** `/staff/volunteer/shifts`, as rendered:

```
Sep 2  Load-Out & Teardown              3/3
Sep 8  Outreach & Tabling               3/3
Sep 16 Front Desk       · Electronic…   1/1
Sep 16 Event Setup      · Electronic…   2/2
Sep 26 Administration   · Folk Circle   2/2
Sep 27 Front Desk       · Blues & Brews 1/1
```

Every row at capacity, all six in plain type, under a column headed **Filled**. Read back
out of D1, six of those twelve places are unconfirmed claims. The shift detail page says it
out loud — **"Needed — 3 of 3 filled"** sits above a list where two of the three read
`claimed` and one reads `confirmed`.

Clearing them is four page loads and six modals. Nothing in the app tells you they exist.

### A4. There is no "who is on tonight" — **SLOWS**

`listShifts` accepts `from`/`to` (`volunteer-shift-service.ts:368`) and no page passes a
`to`. `/staff/volunteer/shifts` is one ungrouped, unbounded list in date order, filtered
only by role and an **Include past** checkbox.

Ticking that box merges ten shifts spanning Aug 6 to Sep 27 into a single flat table — no
divider, no today marker, no styling difference between a shift that has happened and one
that has not. Answering "who is due in tonight, and did they show" means finding the row,
opening the shift, reading the claimant list, and marking attendance one person at a time,
from a page whose default view has already hidden it.

The Aug 6 Sound Engineering row reads **1/2**. That show ran a person short, and nothing in
the app ever said so — before or after.

### A5. "Who can I ask" lives on the wrong page — _note_

The interested-members list, with per-member clearance state and an _"N of M ready"_ count,
is on the **role** page. The question is only ever asked about a **shift**. The shift detail
page shows who claimed it and nothing about who could.

Driven end to end, the role page for Sound Engineering finishes at: _"Interested Members ·
1 of 1 ready"_ → one row → **Copy emails on this page**. The app's entire answer to "who
runs sound on Saturday" is an address on the clipboard.

### A6. The one fact that answers "can you do Saturday" is never shown to staff — **WRONG**

`volunteer_profile.availability` is free text the member types on their own interests form
("weekday evenings, some weekends"). The spec puts it on the profile rather than the join
table precisely because "it describes the person", and the stated purpose of the interest
table is to know "who to contact when a role needs filling".

It is written by `setAvailability` and read back **only into the member's own edit form**
(`volunteer.remote.ts:434`). No staff surface renders it: not `VolunteerListRow`
(`volunteer-profile-service.ts:369`), not `InterestedMember`
(`volunteer-interest-service.ts:257`), not the user page's `VolunteerPanel`.

Neither list carries a phone number either. `/staff/volunteer/people` columns are
Volunteer · Interested in · Hours · Since, and thirteen of nineteen rows show `—` under
Interested in — so for most volunteers the coordinator's whole picture is a name, an email
and two dashes.

### A7. "Ready" means ready _today_, not ready on the shift — **WRONG**

`getInterestedVolunteers` evaluates the clearance gate as `missingFrom(required, held, now)`
(`volunteer.remote.ts:273`). `getOpenShifts` makes the same call with `shift.startsAt`, and
the spec is explicit that "a card that lapses next week does not cover a shift the week
after". So the role page's readiness count answers a question nobody asked: somebody whose
First Aid expires on the 10th reads as ready for the 17th.

Harmless while the list is only advisory. It stops being harmless the moment an "add to
shift" action sits on the same row.

### A8. A standing weekly slot is copied one week at a time — _note_

Recurrence was deliberately declined ("staff duplicate a shift forward"), which is a
defensible call. But `duplicateShift` copies exactly one shift by one offset, so an
eight-week Front Desk block is eight modals — over a service call that would take a loop.

---

## B. Hours

### B1. Staff cannot log hours for a member, and two places promise they can — **WRONG**

`submitVolunteerHours` is session-bound (`volunteer.remote.ts:568`). There is no staff path
to record hours on somebody's behalf — not for the volunteer who does not use the app, and
not for work older than the 90-day window.

Both the help article and the service's own error message send the member to staff for
exactly that:

> Log hours within 90 days of doing the work. For anything older, ask staff to add it.
> — `src/content/help/volunteering/volunteering-overview.md`

```ts
// src/lib/server/volunteer/hour-log-service.ts:110
`Hours must be logged within ${VOLUNTEER_BACKDATE_LIMIT_DAYS} days. ` +
	`Ask staff to add anything older.`;
```

Staff cannot add anything, older or otherwise.

This is the finding with the longest reach. Every report figure filters to
`status = 'approved'` over member-submitted logs, so the hours number the board and grant
applications are given is **only the labor of volunteers who use the web app** — which is
the opposite of the reason the spec gives for the module existing.

**The service already does it.** `submitHours(userId, data)` (`hour-log-service.ts:170`)
takes the user as a parameter.

### B2. The review queue is genuinely good — **sound**

Worth saying plainly. Row-level approve and return with the member's own description as the
subline; a required reason on return; the `scheduled` badge on shift-filed logs; a warning
triangle when the member did not hold a clearance their role required on the day worked;
filters mirrored into the URL; and a refresh that correctly re-keys the argument-keyed
query so an approved row actually leaves the table.

This is the one staff page in the module already shaped like a task, and it is the model
for the rest.

---

## C. Clearances and onboarding

### C1. A lapsing clearance is a tab you have to remember to open — **SLOWS**

`/staff/volunteer/clearances?state=expiring` computes the answer well — two Food Handler
cards expiring Sep 30, two already lapsed, tabbed and counted. Nothing pushes it: no badge,
no dashboard card, no cron, no notification.

And nothing joins it to the schedule. The question that matters is not "who expires soon"
but "**whose card lapses before a shift they are already rostered on**". The data for that
join — `missingFrom(requirements, held, shift.startsAt)` — is already written, and already
used on the member's own board.

### C2. Under-18 approvals are filed under Hours — _note_

`PendingReviewCard` is a queue of _people_ rendered above the queue of _hour logs_, on the
page a coordinator opens to review hours. Its own comment says so. It is invisible from the
nav and found only while doing an unrelated task.

(It also carries a duplicated `{#if rows.length > 0}` wrapper.)

---

## D. Navigation and orientation

### D1. The nav is the entity list, and the landing page is a table — _note_

```
Volunteering  (badge: pending hour logs)
  Volunteers · Shifts · Roles · Certifications · Report
```

Five nouns and a report. `/staff/volunteer` opens on a filtered table of hour logs. Nothing
in the panel answers "what needs me today".

The sidebar badge reads **10** — exactly the pending hour logs. The two under-18 approvals
sitting on that same page, the six unconfirmed claims and the two expiring cards contribute
nothing to it.

The staff dashboard reinforces it. `/staff` carries a **Running low** panel for inventory —
described in its own comment as "the only thing on the dashboard that is asking for an
action today" — plus Recent Members, and nothing about volunteering at all.

### D2. The sub-navigation disagrees with itself — _note_

Every page in the section builds its own header links by hand, and no two agree:

| Page              | Links in its header                  |
| ----------------- | ------------------------------------ |
| `/volunteer`      | Volunteers · Shifts · Roles · Report |
| `/people`         | Hours · Shifts · Roles               |
| `/certifications` | Who's cleared                        |
| `/shifts`         | — (back link + New Shift only)       |
| `/roles`          | — (back link + New Role only)        |
| `/report`         | — (back link only)                   |

Certifications is reachable from the header of no page at all; Report from one. The sidebar
already carries all six as children of Volunteering, so these hand-rolled rows are a second,
inconsistent navigation on top of a working one.

### D3. The staff help article describes a page that no longer exists — _note_

`review-volunteer-hours.md` sends staff to **Volunteering → Interest**, which 308s to
`/people`, and describes "the count beside each role in the filter", which the role
`<select>` does not carry.

### D4. Two member queries have no caller at all — _note_

Fifteen volunteer queries have no caller outside `volunteer.remote.ts`, but that is the
one-load-bearing-query rule working as intended — the `…Page` wrappers compose them
(`getMemberVolunteerPage` fans over six, `getStaffVolunteerRolePage` over three). Not a
finding.

`getMyCertifications` (`volunteer.remote.ts:904`) and `getMyMissingRequirements` (`:929`)
are the real orphans, called from nowhere including the wrappers. A member has no page that
shows the clearances they hold. Same shape as inventory's `addLocation`: a written function
with no door.

---

## E. Checked and found sound

Worth saying plainly, because everything above is a fault.

- **The date off-by-one that runs through inventory does not reach here.** Every formatter
  this module uses — `formatDateShort`, `formatDateShortYear`, `formatDateTimeShort`,
  `relativeDay` — goes through `venue()` in `src/lib/utils/format.ts`, and both `workedOn`
  and the certification dates are anchored at noon club time. Verified on screen: a shift
  stored at `2026-09-03T01:00:00Z` renders as "Sep 2, 6:00 PM–10:00 PM". The module is
  consistent about time zone end to end.
- **The review queue** (B2), including the clearance warning and the `scheduled` badge.
- **The clearance model.** Append-only grants, revoke-not-delete, expiry derived from dates
  rather than stored as a status, and `expiresAt` stamped at grant so shortening a
  validity period cannot retroactively expire a card that was validly issued.
- **The archive-vs-delete rule on roles.** Delete is offered only when nothing was ever
  logged against the role; archiving hides it from the member form and nowhere else.
- **The capacity race.** `claimShift` writes `INSERT … SELECT … WHERE hasRoom` and the
  loser gets `ShiftFullError` — the right shape for a database with no transactions.
- **The event → shift path.** `/staff/events/[id]/production` carries a Volunteer Shifts
  card with the event locked into the create form, which is the direction the work runs.
- **The feedback loop.** Two deliberately distinct questions, an anonymous per-role rollup,
  and a warning colour when "set up to succeed" drops below 80%.

---

## What this adds up to

**The member's half was designed. The coordinator's half was inferred from it.**

Read the two sides next to each other and the asymmetry is the whole report:

|                       | The member can       | The coordinator can                          |
| --------------------- | -------------------- | -------------------------------------------- |
| Join a shift          | claim it             | **nothing** (A1)                             |
| Leave a shift         | drop out             | **only record a no-show** (A2)               |
| Know a claim happened | sees their own board | **nothing** — no event, no badge (A3)        |
| Log hours             | within 90 days       | **nothing**, though two texts say so (B1)    |
| See who is free       | —                    | a name and an email; never availability (A6) |

Everything the coordinator _can_ do is an entity page: a table of hour logs, a table of
volunteers, a table of shifts, a catalog of roles, a catalog of certifications, and a
report. The work itself — confirm these six people, fill that short shift, chase the card
that lapses before the show — is spread across all six with no page that holds it.

### Blocking the job

1. **A1 — nobody can be put on a shift by staff.** The service takes a `userId`; only the
   remote is bound to the session.
2. **A2 — nobody can be taken off one**, except by recording a no-show that did not happen.
3. **B1 — staff cannot record hours for a member**, while the help text and the service's
   own error message both tell members to ask them to.

### Slows it down badly

4. **A3 — confirmation is load-bearing and invisible.** No event, no badge, and one number
   on the list that hides the difference.
5. **A4 — there is no view of the week**, so "who is on tonight" is a checkbox and a hunt.
6. **A5 / A6 — the answer to "who do I ask" is on the wrong page, and does not include the
   one field that was collected to answer it.**

### Genuine bugs, independent of the redesign

7. **A6 — `availability` is collected and never displayed to anybody who could use it.**
8. **A7 — role-page readiness is computed against today**, not against the shift.
9. **D3 — the staff help article points at a route that redirects**, and describes a
   control that does not exist.
10. **D4 — `getMyCertifications` and `getMyMissingRequirements` have no caller**, so a
    member cannot see what they are cleared for.

### Cheapest high-value fixes

Roughly in order of value per line changed. Every one of these is a guard swap or a column,
over a service that already takes the parameter — there is **no schema change in this
list**:

- Give `claimShift` a staff-guarded remote that takes a `userId`.
- Give `cancelSignup` a staff variant without the owner clause.
- Give `submitHours` a staff-guarded remote, with the backdate limit lifted and the row
  landing approved and stamped with the staffer who entered it.
- Emit `signup_claimed` / `signup_confirmed` / `signup_cancelled` and notify accordingly.
- Split `confirmed` out of `claimed` in every list that shows a fraction.
- Put `availability` and `user.phone` on the two volunteer list rows.
- Pass the shift's date to `missingFrom` wherever a shift is in scope.

### Not exercised in this pass

- The three crons (`complete-shifts`, `shift-reminders`, `shift-feedback`) were read, not
  run.
- The volunteer email templates were not rendered.
- The member arm was driven only as an admin who is also a member; a genuine
  non-staff account was not registered, as the inventory pass did.
