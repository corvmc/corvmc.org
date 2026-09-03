# Volunteering redesign

> Reshapes the two volunteering applications without changing what volunteering _is_.
> Companion to [volunteering-spec.md](volunteering-spec.md) (why the model is what it is) and
> [../../reports/volunteer-workflow-findings.md](../../reports/volunteer-workflow-findings.md)
> (what was wrong with the shape).
>
> **Status: shipped.** How the surfaces behave day to day is
> [business-workflows.md §12](../../development/business-workflows.md#12-volunteering); what
> survives here is the design rationale — the shape that was chosen and the reasons.

## Why

The findings report argued that the coordinator's half of volunteering is shaped like the database —
a table of hour logs, a table of volunteers, a table of shifts, a catalog of roles, a catalog of
certifications, a report — when the job is shaped like a list of decisions. Its **blocking** findings
were fixed in code: staff can put somebody on a shift and take them off, clearances are judged as of
the shift's date, staff can log hours for a member, and `/staff/volunteer` became a worklist.

What did not happen was a pass over the **shape** of the surfaces. The handoff shot all 31 screens
from a populated seed; a design canvas turned those into two working prototypes and a screen
specification. This spec is that specification, brought into the repo.

The redesign is an **information-architecture change, not a data-model change.** Everything below is
already supported by the existing tables except the two columns named in [Schema](#schema).

## The two shapes

**Staff is a worklist.** Seven nav rows collapse into four working screens — Today, Schedule, People,
Setup — plus a read-only Report and a shift detail page. Shifts folds into Schedule; Volunteers,
Clearances and the under-18 queue fold into People; Roles and Certifications fold into Setup.

**Member is a next-action stack** beside a claim board. Claim and booking are drawn as separate
states on a two-step rail, so "claimed but unconfirmed" — the state that silently produces no
reminder and no auto-complete — is legible to the person in it.

## The state machines, restated

Unchanged from the shipped spec; repeated because every screen below depends on them.

| Signup state | Meaning and exits                                                                                                                                                      |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| _(open)_     | A place on a shift with nobody in it. Appears on the member board. Exits by member claim or staff add.                                                                 |
| `claimed`    | The member has committed; staff have not. **No reminder is sent and the shift never auto-completes.** Exits to `confirmed`, or back to open if either side removes it. |
| `confirmed`  | Booked. Reminder set for the day before. **A staff add lands here directly, skipping `claimed`** — a coordinator typing the name in _is_ the decision.                 |
| `completed`  | The shift has passed with hours owed. Offers a log entry and a feedback prompt.                                                                                        |
| `no_show`    | Staff-set only. Keeps the person on the roster as a record. A staff **release is a cancellation, not a no-show**.                                                      |

Hours: a member log is filed `pending`; staff approve it (it counts in the report) or return it with
a **required** reason — `rejected` renders as **"Returned"** because it is a request for a correction,
not a judgement. Hours entered by staff land `approved`, stamped with the staff name, with no
backdate limit.

**Clearance rule.** Eligibility is evaluated at the **shift date**, never at today. A clearance valid
today that lapses before the shift blocks nothing, but is flagged on both the candidate list and the
Today worklist.

## Copy convention

Labels name the action in context rather than addressing the user — `Close`, `Remove`, `Log Hours` —
and **every consequential action states its consequence before it is taken**. The one exception is
explanatory copy on a blocking state, where direct address carries better: the guardian sign-off
screen speaks to the member ("Because you're under 18 there's a bit of paperwork to sort out
first…") rather than describing the state impersonally.

## Schema

Two nullable columns. Both are additive `ALTER TABLE … ADD COLUMN` with no default, which is the only
form SQLite accepts on a populated table.

| Column                                 | Why                                                                                                                                           |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `volunteer_signup.notified_at`         | Only meaningful once the **shift** is cancelled, where the roster becomes the list of people to tell. This is how far down it staff have got. |
| `volunteer_shift.cancelled_by_user_id` | The cancelled shift names who called it off, because the roster it leaves behind is a list of people somebody now has to ring.                |

`cancelShift` already keeps its signups — the roster survives precisely so it can be a notify list.
**Cancelling does not notify.** Calling a shift off and telling six people about it are two
decisions: the first is often made in a hurry and sometimes reversed, and a coordinator who has
already rung the sound engineer does not want the system mailing them anyway. So cancelling leaves a
notify list, and `Notify all` is the button on it — `notifySignupsOfCancellation` stamps the rows and
raises `volunteer.shift_cancelled` per person, idempotent by the `notified_at IS NULL` filter.
`markSignupNotified` is the "I rang them" escape hatch and sends nothing.

## Staff application

Sidebar badges: **Today** carries the total waiting count — unconfirmed claims, pending logs, minors,
close-outs and lapses together; **Schedule** the short-staffed count; **People** the minor count.
Setup and Report carry none. `New Shift` shows in the header on Today and Schedule; `Log Hours` on
Today and People.

### Today

Subtitle "Tuesday, Sep 1 · N items waiting", or "nothing waiting". One column, at most 1000px. Cards
appear in fixed priority order and each is **omitted entirely when its queue is empty**; when all are
empty, one teal card reads "Nothing waiting — all claims confirmed, all hours reviewed, no short
shifts in the next two weeks."

1. **Needs confirming · N** — the only card with an accent left border. Explanatory line:
   "Unconfirmed claims get no reminder and never auto-complete." Grouped by shift, each group headed
   by the role name (links to shift detail) and the date and time. Per person: avatar, name, email,
   "claimed {when}", then `Confirm` (teal) and `Remove`. A `Confirm all N` link clears the card.
2. **Short-staffed · next two weeks** — shifts inside 14 days where confirmed < capacity. Row: date
   and time (links to detail), role, a subline resolving to the event name, or "N claimed but
   unconfirmed", or "N confirmed", or "nobody on it"; an "N of M" need count, red when nobody is
   confirmed and amber otherwise; and `Add people`, which opens shift detail with the Interested
   candidate tab selected. A `Schedule →` link sits in the card header.
3. **Hours to review · N** — oldest date in the header, top five rows, and a link to the full queue.
   Row: member name, an amber chip where relevant ("not cleared that day"), the description, role,
   date, hours, then `Approve` and `Return`, both of which open a modal.
4. **Awaiting guardian sign-off · N** — "Under 18. Cannot claim shifts or log hours until approved."
   Row: MINOR chip, name, email, "signed up {when}", `Approve`. Approving removes the row and toasts
   "{First name} can volunteer now" — this is what turns the member's blocked screen into a dashboard.
5. **Close these out · N** — signups never confirmed before their shift date, so never completed: no
   hours offered, no feedback requested. Row: name, shift, supervisor's name and email. `They worked
it` writes an approved log; `No-show` records the no-show. Both clear the row.
6. **Clearance lapses before a booked shift · N** — amber. Row: name, "{clearance} expires {date} ·
   on {shift}", `Renew`, which opens the grant modal.

### Schedule

Subtitle counts live shifts, short-staffed shifts and claims to confirm. Filter row: a segmented
window control (7 / 14 / 30 days / Everything), a role dropdown defaulting to All roles, and a
Short-staffed toggle pill. Shifts group under day headings with a hairline rule.

Row: time; role name (links to detail); a subline showing the event in teal, else the briefing note,
else "not tied to an event"; staffing as "C of cap", suffixed "· N unconfirmed" where applicable,
**teal when full, amber when unconfirmed claims exist, orange when nobody is confirmed**. A shift with
nobody on it at all gets an amber border and tinted fill.

Inline actions: `Confirm N` when unconfirmed claims exist, confirming them all in place; `Add N` when
the shift is not full, opening detail on the Interested tab, rendered as a filled primary button when
the shift is empty.

Empty: "No shifts match that. Widen the window, or clear the filters." Cancelled shifts are excluded
from the list and surface below a divider as links: "{date} {role} cancelled · N to notify".

### Shift detail

Title "{Role} · {date}", subtitle "{time} · {event}" or "· not tied to an event". Back button returns
to whichever screen opened it. Two equal columns; one when cancelled.

**Left — Who's on it · N.** One card per person: avatar, name, email, status chip. A `claimed` person
gets an inline strip reading "Unconfirmed: no reminder, no auto-complete." with `Confirm`. Row buttons
are `Remove` and, for confirmed people only, `Mark no-show`. `Confirm all` appears when more than one
claim is outstanding. Empty: "Nobody on it yet." Below the roster: a Briefing card showing the shift
note, or "No briefing yet — add one and claimants see it before they commit.", then `Edit` and
`Cancel shift`.

**Right — Who to ask · N.** Subtitle "Cleared as of {shift date}." Three filter pills: Interested
(people who listed this role), Has worked it, All. Up to five candidates, each with avatar, name,
stated availability or "Hasn't said when they're free", and **one** flag line resolved in this order:

1. **Blocked** — missing a required clearance: "Needs {clearance}", or "{clearance} lapsed — not
   cleared on {date}". The button reads `Blocked`, is not clickable, and on press toasts "Refused.
   {Clearance} is required for {role}."
2. **Lapsing** — clearance valid now but expiring before the shift: "{Clearance} lapses before
   {date}". Amber, not blocking.
3. **Day mismatch** — stated availability conflicts with the shift's day: "Day may not suit — read
   their note". Orange, not blocking.
4. **Clear** — "Cleared for {clearance} on {date}", or where the role needs none, "{N} hrs logged · N
   of these before".

`Add` puts the person on the shift as **confirmed** — a staff add is a booking, not a claim. Empty:
"Nobody left in this group. Try All."

**Cancelled variant.** Kicker "Called off {date} by {staff name}"; the title is struck through. An
amber banner leads with the outstanding count — "N to notify", or "Everybody has been notified" —
with a `Notify all` action. Claims and bookings **stay on the roster, since they are the notify
list**; each row's chip switches to notified / not notified and its button to `Mark as notified`,
settling to a non-interactive "✓ Notified". The candidate column and the cancel action are withdrawn.

### People

Three tabs, with a row count in the footer.

- **Roster N** — avatar, name, and a subline resolved by priority: a clearance expiry warning, else
  "awaiting your confirm · {role} {date}", else the email address. Then stated availability, the roles
  they would take (truncated to two plus a count, or "Ask them →" when they have listed none), total
  hours, and **one** contextual action: `Confirm` if a claim is outstanding, `Chase` if a clearance is
  lapsing, otherwise `Log Hours`, which opens the staff log modal pre-filled with that member.
- **Awaiting sign-off N** — MINOR rows: "under 18 · signed up {when}", "Can't claim shifts or log
  hours until a guardian signs off.", `Approve`.
- **Cleared** — one row per grant: person, clearance name, a status chip reading "current" or "expires
  {date}", and `Revoke`, which requires a reason on the record.

### Setup

Two columns. **Left:** "Roles · N live" with `New Role`, roles grouped under At shows / Away from
shows / Committees. Each role card carries the name, "N would do · N logs", the description shown to
members, and a teal "needs {clearance}" chip where one is required, and **links to its own detail
page** — see [What the prototypes leave out](#what-the-prototypes-leave-out). **Right:** a Clearances
panel; each card gives the clearance name, issuer and validity period, "N hold it · required by N
role", and where relevant "1 lapses before a booked shift →". Footnote: "Grants are made on a
person's record."

### Report

Read-only, scoped "Jan 1 – today. Approved hours only." Four stat tiles: Approved hours, Volunteers,
Logs, Still in review. Below, Hours by role as a sorted horizontal bar list with hours and percentage
share per role, footnoted "Approved logs only." Approving a log on Today moves its hours into these
figures immediately.

### Staff modals

470px, dismissed by overlay click or ×.

- **Approve these hours?** — restates hours, role, member, date and the member's own description;
  where the log is flagged, adds that they were not cleared that day, "which does not block the record
  of work already done." Optional note, shared with the member. Confirms teal.
- **Return these hours?** — restates the log. Reason **required**, sent to the member; submitting
  empty raises "A reason is required." Confirms in the danger colour.
- **Schedule a shift / Edit this shift** — role select, a defaults line reading the role's default
  duration, capacity and clearance; When; People needed; and a briefing field noted "Shown to
  claimants before they commit." Validation: "When is it? A date and a time." and "How many people do
  you need?". Reducing capacity below the confirmed count warns without removing anyone: "N places, M
  already confirmed. Nobody is removed; the shift reads as over-full until you take someone off."
  Saving an edit toasts "Shift updated. Everyone on it stays on it."
- **Cancel this shift?** — "Claims and bookings stay in place — they are who you need to notify. The
  shift stops taking claims." Dismiss reads `Keep shift`.
- **Log hours for a member** — member, role, date worked, hours, and a required description ("The
  record. Keep it specific."). Footnote: "No backdate limit. Lands approved, stamped with your name."
- **Grant a certification** — "Expiry is stamped from the granted-on date and locked in. Grants
  append, so a renewal is a new row." Granting clears the matching lapse from Today.

## Member application

Header actions — `Interests`, `Hours`, `Log Hours` — show on the dashboard and hours screens only.
Modals are 440px.

### Sign-up · "About you"

A single 520px card, subtitled "Asked once." Fields: first and last name, pronouns (optional), phone
with the reason given ("For shift-day contact."), and "Are you 18 or older?" with the consequence
stated ("Under 18 requires a guardian sign-off."). Validation, **in order**: names required, phone
required, age question required. Under 18 routes to the blocked screen and toasts "Sent to staff for
a guardian sign-off." 18 or older continues to Interests in onboarding mode, where the secondary
action reads `Skip` rather than `Cancel`.

### Awaiting guardian sign-off

A terminal state, not an error, and deliberately warm: it opens by welcoming the member ("Thanks for
signing up — one thing first"), explains that paperwork including a guardian's sign-off comes first
and that a staff member will get in touch to walk them through it, then reassures — nothing to chase
on their end, and volunteering opens up right here once it's done. Actions: `Contact staff` and `Back
to dashboard`.

### Interests

"Select the roles you'd take", framed as information rather than commitment: "Not a commitment. It
tells staff who to ask, and we'll show you how the job is done." A live count of selections sits in
that line. Roles are listed in the same three groups as Setup, each a full-width toggle card with a
checkbox, name and the member-facing description. Below, a free-text availability field with an
example. The save button reads `Saved` until an edit is made and `Save` after; the selections drive
the dashboard board's matching.

### Dashboard

Two columns at up to 1080px: a next-action stack on the left, the claim board on the right.

- **Hours to log** — the only accented card, shown when a worked shift has hours owed: "{Role},
  {date} · N hrs. Add what you did to file it." `Log these hours` opens the log modal pre-filled from
  the shift. Filing it clears the card.
- **Your shifts · N** — one card per claimed, confirmed or worked signup: a date block, the role and
  time, and a two-step progress rail, **Claimed → Booked**, with the reached step in teal and bold. A
  claimed shift's note reads "Awaiting staff confirmation."; a booked shift shows the briefing plus
  "Reminder lands the day before." Buttons: `Drop out`, and `How did it go?` once worked. Empty:
  "You're not on any shifts. Claim one from the list beside this."
- Three summary rows close the column: hours filed (with returned count when non-zero), roles
  selected, and any clearance expiry — each a link into the relevant screen.
- **Board** — headed "Open shifts for you" with a `Show all N` toggle, or "All open shifts" with `Show
matches`. The subline explains the filter, including the case where no roles have been selected.
  Cards carry the role, an INTERESTED chip on matches, the date, time and event, and a fill line
  reading "nobody on it yet" in orange or "N of M filled". Action: `I'll do it`. Empty: "Nothing open
  matches the roles you picked. Try every open shift, or add a role to your list."

### Your hours

Three tiles — Approved, Awaiting review, Returned — then the full log list, newest first. Each row: a
status pip, the role, a status chip (approved / in review / returned), the description, hours and
date. A returned log is tinted, shows the staff reason in full, and offers `Fix it`; pending logs are
also editable. **Approved logs are locked.** Fixing reopens the log modal in correction mode and
resubmits as `pending`.

### Shift feedback

Titled with the shift it concerns. Three questions: a five-star rating (required — "Pick a rating.");
a single checkbox, "I knew what to do and had what I needed", framed as "Used to fix the briefing, not
to assess you."; and an optional free-text field **sent to staff without the member's name**. Sending
returns to the dashboard and closes the shift out; the confirmation differs by answer, acknowledging
the briefing when the member was not set up to succeed.

### Member modals

- **Claim this shift?** — restates the shift, then shows the three-step rail **You claim it → Staff
  confirm → Booked** with only the first step lit, and states the consequence: not booked until staff
  confirm, usually within a day; email plus a reminder the day before; drop out any time. The
  briefing note is quoted beneath. Confirming sets `claimed` and toasts "Claimed. Staff confirm next."
- **Log hours** — three variants. Free entry asks which role first. Pre-filled entry from an owed
  shift shows "Pre-filled from the shift. Adjust if it differs." and no role picker. Correction mode
  reopens an existing log. All three take date, hours and a description ("One sentence. Staff read
  this when reviewing."). Validation: hours required to the nearest quarter hour, twelve-hour cap per
  log, description required.
- **Drop out of this shift?** — restates the shift and separates notice from absence: "Notice isn't a
  no-show. The place goes back on the board for someone else." Confirming returns the place to open.

## Cross-application behaviour

- A member claim appears on the staff Today worklist under Needs confirming, and on the member's own
  shift card as Claimed with staff confirmation pending. **Neither side sees a booking until staff
  act.**
- Approving a minor on the staff worklist is what converts the member's blocked screen into a working
  dashboard.
- A member drop-out returns the place to the board and to the staff short-staffed list. A staff
  removal has the same effect, and toasts "Taken off. The place is open again."
- Cancelling a shift does not remove anyone; it converts the roster into a notify list.

## What the prototypes leave out

The prototypes are thinner than what already shipped in three places. **Capability is kept**, reached
from the new screens rather than from the nav, so the redesign is not a feature regression:

| Prototype                              | What shipped, and where it now lives                                                                                                                                                                                                             |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Setup's role cards are read-only       | `/staff/volunteer/roles/[id]` stays, unlisted — role editing, clearance requirements, upcoming shifts, the interested list and the per-role feedback rollup. Each Setup role card links to it, and `entityHref` still resolves a role ref there. |
| Report is four tiles and hours-by-role | Hours by month, hours by member (paginated) and the feedback rollup stay below the fold. The by-member roll-up is the number the board and grant applications ask for.                                                                           |
| Hours is the top five on Today         | `/staff/volunteer/hours` stays, unlisted — the filterable queue with status tabs and pagination, reached from Today's card. A backlog of forty does not fit in five rows.                                                                        |

Retired routes redirect rather than 404: `shifts` → `schedule`, `clearances` →
`people?tab=cleared`, `roles` and `certifications` → `setup`, matching the existing `interest` →
`people` redirect.

## Not in scope

- Shift recurrence. There is still no series column; a standing weekly slot is `duplicateShift`.
- Ask-tracking for feedback. The ask is inferred from the answer's existence, so a non-responder is
  indistinguishable from never-asked.
- The prototype's persona-switch bar, and its org header / three-band rule / cream sidebar — that is
  the existing `AppShell`, unchanged.
