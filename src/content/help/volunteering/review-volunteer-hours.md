---
title: Reviewing Volunteer Hours
slug: review-volunteer-hours
category: volunteering
summary: Scheduling shifts, working the approval queue, finding volunteers, managing roles and clearances, and pulling the report.
minRole: staff
sortOrder: 2
---

## What needs you today

**Volunteering** in the staff panel opens on a worklist, not a table. Each card is
something waiting on a person, with the action on the row, and a card you cannot see is a
card with nothing in it:

- **Needs confirming** — people who claimed an upcoming shift that nobody has confirmed.
  This is the one to clear first: confirming is what turns a claim into a booking, and until
  you do it they get no reminder, the shift never completes itself, and no hour log is ever
  offered. Confirm one at a time or confirm a whole shift at once.
- **Short-staffed** — shifts in the next fortnight with places nobody has taken. **Add
  someone** on the row shows who said they would help with that role, when they said they
  were free, and whether their clearances cover _that shift's date_ — plus a search box for
  anybody else.
- **Hours to review** — the top of the approval queue, with the same approve and return
  buttons. The whole queue is **Volunteering → Hours**.
- **Waiting on a guardian's sign-off** — under-18 sign-ups.
- **Close these out** — shifts that have already happened where somebody's claim was never
  confirmed. Say whether they worked it (which records the hours) or didn't. Leaving it is
  the third answer, and it loses the work.
- **Lapses before a shift they're on** — somebody rostered for a date their clearance does
  not reach. Not the same list as _Who's cleared_: this one has a deadline.

The count in the sidebar is all of that added up.

## The hours queue

**Volunteering → Hours** opens on the **Pending** tab: hours members have logged and nobody
has looked at yet.

For each log you get the member, the role, the date, the hours, and their
description of what they did. Approve or return from the row.

- **Approve** takes an optional note, shared with the member.
- **Return** requires a reason. The member cannot correct and resubmit without
  one, so say what was wrong — wrong duration, duplicate, not volunteer time.

Review is one-way. If you approve something by mistake, ask the member to submit
a corrected log; there is no un-approve.

Filters (member, role, date range) stay in the URL, so a reload or a back button
keeps your view.

### Logging hours for somebody else

Members have 90 days to log their own hours, and the app tells them to ask staff for
anything older. **Log hours for someone** on this page is how you do that. It is also how
you record the volunteer who does not use the app at all — which matters, because the
report only counts what is in here, and an hour nobody typed in is an hour the board never
hears about.

There is no date limit and no second review: what you enter lands approved and attributed
to you. You typing it in is the review.

## Scheduling shifts

**Volunteering → Schedule** is the next two weeks, grouped by day — the view for "who is on
tonight". **Volunteering → Shifts** is the whole catalog, past included, for finding one.

Create a shift from a role (times and headcount prefill from the role's defaults), and
duplicate it forward to make a standing weekly slot — there is no recurrence to configure.

Every list shows **confirmed of capacity**, with anything merely claimed called out beside
it. Those are different things: only confirmed people get the day-before reminder and
auto-complete afterwards, so a shift showing three claims and no confirmations is not
staffed.

**Add** in a shift's **Who to ask** column puts a member on it yourself, for the person who
tells you in person or by text. They go on confirmed. If their role needs a clearance they
do not hold on that date, the button reads **Blocked** and names what is missing — grant it
from their member page and try again.

**Remove** is for somebody who gave you notice; their place reopens straight away. That is
not the same as **Mark no-show**, which is for somebody who was booked and simply did not
turn up, and only one of the two is worth remembering next time.

When a shift is called off, its roster stays put — that is who you have to tell. The shift
page turns into a notify list: **Notify all** emails everybody still on it, and **Mark as
notified** is for the ones you already rang.

A role can require clearances (**Volunteering → Setup**) before its
shifts can be claimed. Requirements are checked against the shift's date, so a
lapsing card is caught before it matters. **People → Cleared** shows who holds
what and when it runs out, one row per person and clearance. Grant from the
member's page; revoke from either. Revoking keeps the record of the period it
covered, which is the point.

The day after a shift, workers get a two-question survey. Responses show on the
shift detail and roll up per role on the report, anonymously. A role scoring
badly on "were you set up to succeed?" is a briefing problem, not a volunteer
problem — fix the checklist, not the person.

## Finding someone to ask

Usually you do not go looking — the **Who to ask** column beside a shift's roster already
shows the people who said they would help with that role, what they told us about when they
are free, and whether they are cleared for that date. Its three filters widen that to people
who have worked the role before, and then to everybody; searching it finds anyone at all,
which is the person who walked up to the desk and is on no list.

**Volunteering → People** is the full list when you do. Its **Roster** tab is everyone who
signed up, with their roles and their availability note; each row carries the one thing
outstanding about that person — a claim of theirs to confirm, a clearance to chase, or
otherwise a way to log hours on their behalf. Filter by role to see how deep the bench is.

**People → Awaiting sign-off** is the under-18 queue. Approving one confirms a guardian has
signed off; the record still says they are under 18, which is what changes how a shift is
staffed.

Expressing interest is not a commitment to a date, so treat it as a place to start asking,
not a rota. A role's own page has **Copy emails on this page** if you want to write to
several people at once.

## Managing roles

**Volunteering → Setup** holds both halves of what volunteering is made of: the roles
members pick from on the left, the clearances that gate some of them on the right. A role
is a name plus a job description in markdown — the description is what members read when
deciding whether to help, so write what the job actually involves rather than a label.
Clicking a role opens its own page, which is where you change it, set what it requires,
schedule shifts against it and read how they went.

**Group** decides which of the three headings a role appears under — at shows,
away from shows, or committees. It is presentation only; nothing else depends
on it.

**Archive** a role you are not using. It disappears from the member's submit
form and stays everywhere else: existing logs keep working, the staff filter
still lists it, and the report still counts its hours. Archiving a role while
logs are in the queue is safe — you can still approve them.

**Delete** is only offered for a role nothing was ever logged against. That is
deliberate: deleting a role with history would quietly change past reports.
Archive is almost always what you want.

## The report

**Volunteering → Report** covers **approved hours only**, over whatever date
range you set (defaulting to this calendar year). It gives you:

- headline totals — hours, distinct volunteers, logs, average per volunteer;
- hours by member, sorted high to low;
- hours by role, with each role's share of the total;
- hours by month.

This is the shape a board packet or a grant application asks for. Approving is
what makes a number appear here, which is the reason the review step exists.
