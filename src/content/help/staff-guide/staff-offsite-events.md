---
title: Run an Off-Site or Multi-Day Event
slug: staff-offsite-events
category: staff-guide
summary: Set up a show CMC produces somewhere other than the practice room, or one that runs across more than one day.
minRole: staff
sortOrder: 19
---

Most of what the app assumes about a show — that it is in the practice room, that it happens on
one date — stops being true for a festival stage or a partner venue. Nothing is missing, but a few
steps are in places you would not guess.

Two people share this: a **production lead**, who owns the event and the bill, and a **volunteer
coordinator**, who owns the staffing.

## First: one project for the whole thing

**Staff → Projects → New.** A project is the container — one budget, one owner, one place the burn
adds up across every night. A festival is one project and several events; a produced show is one
project and one event; a facility improvement is one project and none.

Attaching things to it is done from the project's own page: pick the kind and paste the row's id,
copied from that row's page. There is no "add to project" button on the event side yet.

## Two days means two events

**One event cannot span two dates.** The create form takes a single date plus start and end times,
and the end only rolls past midnight when it is earlier than the start — so a 9pm–1am show works
and a Saturday-noon-to-Sunday-night one does not. Create one event per day.

Make them from **Staff → Productions → New Event**:

- **Do not tick _Reserve space_** for an off-site show. The room hold is what keeps members from
  booking the practice space, and a show in a park has no reason to take it. (Ticking it and
  overriding the conflict is how the room ends up blocked for a weekend nobody was in it.)
- **Set the venue afterwards.** The create form has no location field. Open the event at
  **Staff → Events → _the event_** and put the venue in **Location** on the inline edit form.
  Until you do, the production console's Space Reservation card will keep asking you to hold a
  room you do not want.
- **Ticketing off**, unless CMC is genuinely selling something. A free stage needs none of it, and
  leaving it off means no check-in tool and no ticket ledger to reconcile afterwards.

## The bill

The lineup editor is on the **event** page, not the production console. Up to **12 acts per
event** — a long day across two events gives you twenty-four, which is usually enough.

- The **order** is the bill: the top of the list is the headliner.
- The **slot note** is free text — "Direct support", "4:30 set" — and is the only per-act field on
  the record.
- A **CMC band** you pick from the search is invited and confirms from its own page. An **outside
  act** is just a name; it needs no account and never has to make one.

**Set times are not stored anywhere.** There is no run-of-show in the app yet, so the running
order, set lengths and changeovers live on a printed sheet. The slot note is the closest thing the
record has, and it is worth filling in for the acts whose times are already settled.

**Riders** are on the production console (**Staff → Events → _the event_ → Production**), as a
read-only summary per act: how many channels, how many need phantom power, how much of it we are
supplying, and — the number that actually matters during the advance — how many acts have sent
**nothing**. Outside acts show "ask them directly", because they have no CMC page to send one from.

**Gear leaving the building** goes out as an equipment loan under somebody's name
(**Member → Equipment**). There is no per-show gear manifest.

## Staffing it

Roles first: **Staff → Volunteer → Setup**. A role is a job description, not a permission. Two
fields there are worth getting right before a festival, because they are what let the weekend be
reported afterwards as contributed services rather than just hours: mark a role as a
**specialized skill** where it is one, and give it a **market rate**.

Clearances live on the same screen, and they are checked **as of the shift's own date** — so a
card that expires between Saturday and Sunday blocks Sunday and not Saturday.

### Build a duty list

**Staff → Volunteer → Duty Lists.** A duty list is a reusable set of work orders, timed from the
event rather than from a calendar, so the same list serves every show.

- **Anchor it to the start** for a festival stage. The doors anchor falls back to the start time
  when an event has no doors, so either works — but saying "start" is saying what you mean.
- An item with an **offset and a duration** becomes a claimable shift: _Stage hands, from 2 hours
  before, for 3 hours, 4 people._
- An item with only a **deadline** becomes advance work with a due date, and its checklist is the
  advance list: _Booking lead, a week before — confirm the lineup, collect riders, send load-in
  details._

### Apply it once per day

From each event's **Production** page: **Apply duty list**. Applying the same list to the same
event twice is refused rather than deduplicated, so a doubled roster is not something you can do
by accident.

The advance work orders land with no window. They show up on **Staff → Volunteer** under
**Needs scheduling**, and on the event's production page under **Advance** — that is where their
checklists are ticked off.

### The fortnight before

**Staff → Volunteer** is the whole job: confirm the claims, fill the short shifts from the
shortlist beside each one, clear any under-18 sign-ups. A card only appears when something is
waiting on you, so an empty page means an empty queue.

**Confirmed is the number that matters, not claimed.** Only a confirmed volunteer gets the
day-before reminder and completes afterwards. A shift showing three claims and no confirmations is
not staffed.

## On the day

There is no volunteer check-in. A confirmed signup completes on its own once the shift's end time
passes, and the member is then offered a pre-filled hour log.

Capacity is judged by overlapping windows rather than headcount, so a 10–4 shift at capacity 1 can
legitimately hold somebody 10–1 and somebody else 1–4.

## Afterwards

Approve the hours from **Staff → Volunteer → Hours**. You can log hours on somebody's behalf with
no 90-day limit — those land approved and stamped with your name — which is what makes "ask staff
to add anything older" a real instruction rather than a dead end.

Then **Staff → Volunteer → Report** for the date range, and its CSV export for anything that has
to leave the app. The report prices the time two ways and they are **not parts of one total**:
_impact value_ covers every approved hour at the Independent Sector rate, and _contributed
services_ covers only the specialized roles at their own rates. The specialized hours are counted
in both, so adding them together double-counts. A specialized role nobody has priced is flagged
rather than valued.

## Related

- [Events, ticketing & check-in](/staff/help/staff-events)
- [Approve loans & record returns](/staff/help/staff-equipment-loans)
