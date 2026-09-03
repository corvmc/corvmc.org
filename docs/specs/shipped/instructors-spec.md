# Instructors — teaching in the practice space

CMC has no tools for people who teach in the practice room. The homepage advertises "Workshops,
masterclasses, and mentorship programs" with nothing behind it, `/contribute`'s "Host a Workshop"
card is a link to the contact form, and `directory_entry.teachesLessons` is a checkbox that renders a
badge and does nothing else. `bookerType` has carried a `'lesson'` value since the reservation system
shipped; nothing has ever written it.

An **instructor** is a person CMC has granted the right to rent the practice room on teaching terms.
Two capabilities, and the spec should be checked against whether it serves them:

1. **Book the room to teach** — on terms that differ from a member rehearsal.
2. **Be found as a teacher** — a real listing, not a badge.

The driving case: a guitar teacher who wants Tuesdays 4:00–7:00 held for a term — either as one block
or as six half-hour slots back to back — at a rate that is not the member rehearsal rate, findable by
a parent in Corvallis who has never heard of CMC.

---

## The scope decision

**CMC's relationship is with the teacher, not the student.** CMC rents teachers the space. The
instructor bills their own students, and CMC never sees a student.

Everything below follows from that one line, so it is worth stating what it rules out:

| Not built          | Because                                                                           |
| ------------------ | --------------------------------------------------------------------------------- |
| Enrolment, rosters | A student is not a party to anything CMC records                                  |
| Lesson records     | There is no lesson entity; there is a room booking                                |
| Minors, consent    | The teacher's relationship with a minor is the teacher's, and does not route here |
| Payouts, splits    | Money flows student → teacher directly, and teacher → CMC for the room            |

That last row is load-bearing rather than convenient. The app has **no payout path at all**, and the
absence is deliberate elsewhere: `event-service.ts` refuses to let a band gig sell tickets through CMC
checkout because "the money would land in CMC's Stripe account with no payout path back to the band."
A teaching module that took enrolment fees would need Stripe Connect, which is a larger project than
this one and would arrive as a side effect rather than a decision.

### What `IDEAS.md` imagined, and why this is narrower

`IDEAS.md` § "Lessons / Teacher Panel" proposes "a teacher panel for sharing resources with students,
keeping lesson notes, and coordinating schedules." Two of those three are student-facing and are
**deliberately not built**: lesson notes and shared resources presume CMC holds a record of a
teaching relationship it is not party to, and coordinating schedules is a second scheduling system
beside the room calendar.

What survives from that entry is its third clause — "integrate with the reservation system for
booking lesson rooms and with member profiles to link teachers to their specialties" — which is
exactly the two capabilities above. The narrowing is the design, not an omission.

### CMC-run classes and workshops need nothing new

Worth stating so it is not rebuilt. A CMC-sanctioned class is already covered by shipped Groups phases
5–9: staff create a `club`, appoint a leader, set `joinPolicy: 'by_application'` — whose motivating
example in [groups-spec.md](groups-spec.md) is literally "a workshop with a skill floor" — and run
sessions that hold the room **free** via `createGroupEvent` → `bookerType: 'event'`.

So the teacher of a CMC workshop is a **group leader**, and an independent teacher renting the room is
an **instructor**. Two relationships, two mechanisms, already distinct. The line between them is who
the program belongs to: a club is CMC's and gets the room free; a teaching studio is the teacher's and
pays for it.

---

## Domain model

### Instructor

```
instructor
  id                 text (uuid), PK
  userId             text, not null, unique, FK → user (cascade)
  status             text, not null, default 'requested'
                       ('requested' | 'rejected' | 'active' | 'paused' | 'retired')

  -- The listing. This IS the application: staff approve what they would publish.
  headline           text, nullable   (max 120)
  blurb              text, nullable   (max 2000, sanitized)
  ratesNote          text, nullable   (max 200 — free text; CMC never handles this money)
  bookingUrl         text, nullable
  teachingContact    json, nullable   ($type<DirectoryContact>)
  acceptingStudents  boolean, not null, default true

  -- The application's private half.
  applicationNote    text, nullable   (max 2000; member-written, staff-only)
  reviewNotes        text, nullable   (staff-written, member-visible)

  -- The grant, as an audit record.
  grantedByUserId    text, nullable, FK → user (set null)
  grantedAt          timestamp, nullable
  statusChangedAt    timestamp, nullable
  statusNote         text, nullable   (staff-only; required on send-back, pause, retire)
  createdAt          timestamp, not null
  updatedAt          timestamp, nullable
  index(status)
```

#### It hangs off `user`, not `directory_entry`

Three arguments, in order of weight.

**It is an authorization record**, consulted before every teaching booking. `directory_entry` is a
member-owned listing edited from `/member/profile`, and `updateMemberProfile()` does a blind
`.set({...})` over eleven columns — a staff grant on that row is one added field away from being
self-service.

**`directory_entry` is optional and polymorphic; an instructor is neither.** An entry attaches to a
user, to a group, or to nothing (the phase-10 external act). An `entryId` foreign key would therefore
be nullable by shape, and would let a _band_ or an _unowned external act_ be granted teaching status —
a rule the service layer would have to remember, where `userId text NOT NULL UNIQUE REFERENCES user`
simply cannot express it. This is the reasoning [groups-spec.md](groups-spec.md) uses for
`band_site.groupId` being NOT NULL: the constraint is structural and nobody has to remember a rule.

**The precedent is `volunteer_profile`, and it is exact.** Its `userId` is
`.notNull().unique().references(() => user.id, { onDelete: 'cascade' })`, its `status` is a
staff-controlled enum, and its guard is `requireActiveVolunteer(userId)`. Same shape, same reason,
same guard signature — one fewer novel pattern for a reader to learn.

#### Status

| Status      | Set by | May book teaching time | Listed publicly             |
| ----------- | ------ | ---------------------- | --------------------------- |
| `requested` | member | **no**                 | **no**                      |
| `rejected`  | staff  | **no**                 | **no**                      |
| `active`    | staff  | yes                    | yes, if `acceptingStudents` |
| `paused`    | staff  | **no**                 | no                          |
| `retired`   | staff  | **no**                 | no                          |

`requireInstructor` matches **positively** — `eq(status, 'active')`, never `ne(status, 'retired')`.
That is the rule [groups-spec.md](groups-spec.md) extracted from `group_member.status`: a negated
filter silently widens the day a sixth value is added. It is also what makes the application workflow
free for the booking path — `'requested'` and `'rejected'` are two more values the guard already
refuses, so an applicant cannot book **by construction** rather than by a check somebody remembered
to write.

`paused` and `retired` differ only in intent, and that difference is the whole of their value: the
staff list has to distinguish "off for the summer, will be back" from "no longer teaches here." Both
block booking, and re-granting is the same operation from either.

`acceptingStudents` is the **instructor's own** switch and governs the listing only. "My book is full
this term" and "CMC has suspended my terms" are opposite facts that one column would conflate — and
the first must be settable without a staff round trip, while the second must never be.

#### `teachingContact` — a separate published contact

A teaching contact is a different fact from a member-directory contact, for the same reason the
listing is a sibling route rather than a filter: **different audience.** `directory_entry.contact` is
what bandmates use. `/directory/instructors` is public and unauthenticated, and its reader is a parent
who found CMC from a search engine. A teacher may reasonably want a teaching address or a forwarding
number there and their mobile nowhere near it.

**It reuses `DirectoryContact` and `contactForView`, and does not invent a shape.** Same Zod object
(`{ email?, phone?, social?, address?, visibility? }`), same single gate. A second contact shape means
a second gate, and the second gate is the one that leaks.

**Null falls back to `directory_entry.contact`** — the `group_member.alias` pattern, whose comment
already argues it: null means "use the account name", so the row falls back "rather than storing a
copy that goes stale."

The fallback runs through `contactForView('public', …)` like everything else, and the consequence is
designed for rather than discovered: a member whose directory contact is `visibility: 'members'` gets
**nothing** rendered on the public instructor card. That is correct — publishing it would be this
module silently overriding a privacy choice made elsewhere — but an instructor listing nobody can
contact is the feature failing at its one job. So `/member/profile` detects exactly that state and
says so. **Nudge, never auto-publish.**

**It is named `teachingContact`, not `contact`, deliberately.** [groups-spec.md](groups-spec.md) phase
10 introduces a `contact` **table**: private third-party booking details, staff-only, guarded by its
own ESLint rule banning schema imports outside one service. That is the _opposite_ privacy posture
from this column, which is published by definition. Two things called `contact` with inverted rules,
in one schema, is how somebody eventually joins the wrong one.

`bookingUrl` stays its own column rather than folding into `teachingContact.social`: it is the card's
call to action and renders as a button, not a fact in a list.

#### What it carries versus what it reads

| Fact                | Lives on                                                             |
| ------------------- | -------------------------------------------------------------------- |
| Name, avatar        | `user.name` / `user.image` — never copied                            |
| Bio, tagline, links | `directory_entry` — never copied                                     |
| Genres, instruments | `directory_tag` — reused, see below                                  |
| Headline, blurb     | `instructor` — teaching-specific, meaningless off a teaching listing |
| Rates, booking link | `instructor`                                                         |

**Instruments taught reuse `directory_tag kind='instrument'`.** "What I play" and "what I teach" are
usually the same set and always overlapping, and CMC's scale does not yet justify two tag editors that
will drift within a term. Adding a `'teaches'` kind later is a one-line change emitting **zero SQL** —
it is a TypeScript-only drizzle enum. Deferring costs nothing; adding early costs a second editor
forever. Stated here so the omission reads as a decision.

A consequence worth naming: an instructor with no instrument tags renders a card with no instruments
on it. The application should nudge, not block — a listing that cannot be created because a tag is
missing is a listing that never gets created.

### The application: a return state, not an appeal

Instructor status is **staff-granted**. That is forced rather than chosen: teaching time gets its own
rate and a longer booking horizon, so a self-declared flag would let anyone tick a box to get them.
Same structural argument [groups-spec.md](groups-spec.md) makes for free room time — "the abuse case
is closed structurally rather than by a check someone has to remember."

Staff-granted does not mean staff-initiated. Staff must be able to grant directly (someone they
already know), **and** a member must be able to ask. One row carries both: staff insert at `'active'`,
a member inserts at `'requested'`.

**The application is the draft listing.** There is no separate application body, because the listing
fields are already on the row and they are what staff are deciding about. One form, not two, and staff
approve exactly what they would be publishing.

Every step is an existing pattern:

| Step           | Mechanism                                                                | Precedent                                 |
| -------------- | ------------------------------------------------------------------------ | ----------------------------------------- |
| Member applies | Insert `status: 'requested'` with listing fields + `applicationNote`     | `group_member.status = 'requested'`       |
| Staff review   | A **Requested** block at the top of `/staff/instructors`                 | `/staff/groups/[id]` renders exactly this |
| Approve        | Scoped positive-match update to `'active'`, stamping the grant           | `approveApplication()` in `group-service` |
| **Send back**  | `'rejected'` + `reviewNotes`; member edits and resubmits → `'requested'` | `event.reviewNotes` + `eventStatuses`     |
| Withdraw       | The member deletes their own `'requested'` row                           | `leaveGroup()`                            |

**Declining does not delete the row, and that departs from the groups precedent deliberately.**
`declineApplication()` deletes because a group application carries no content — there is nothing to
hand back, so deletion is the only sensible decline. An instructor application **is a draft listing**,
which is precisely the case a return state exists for. The `event.reviewNotes` schema comment already
makes the argument: stored rather than only emailed "because `rejected` exists so the member can fix
and resubmit — and they can't fix what they can't see."

**Why a return state rather than an appeal.** The rule this collective holds is that appeals contest
**behavior calls only** — a judgment about the _member_ — while a judgment about a _thing_ is handed
back with a reason so the author can fix it. A declined teaching application is a judgment about a
proposal, so routing it through [moderation-appeals-spec.md](moderation-appeals-spec.md) would be a
category error twice over: that spec's appeal hangs off an **upheld `content_flag`** and no report was
filed here, and it already lists restrictions that are not moderation as out of scope "because there
is no judgement to contest."

The line that draws: **"is this application good enough?" wants an edit; "should this person teach
here at all?" is a behavior call**, and belongs to moderation and `member_standing` — not to a
resubmission loop. If someone abuses resubmission, that is the second question, not the first.

`reviewNotes` is the **third** instance of an established convention. `event.reviewNotes` and
`volunteer_hour_log.reviewNotes` are the other two, and the event one names the volunteer one as its
model. Reusing the column name is what makes the fourth reader recognize it on sight.

**`rejected` is reused, not coined.** `StatusBadge` already labels that value "Returned", and its
comment already gives this module's reason — "sent back to its author to fix".
`volunteerHourStatusLabels` argues it in prose: staff return a log for correction and the member logs
it again, which "rejected" reads as final. So the vocabulary was settled before this spec, and a
fifth word for the same idea would only have hidden the pattern.

That also means this module ships **no status label map**. `StatusBadge` merges every vocabulary's
labels into one flat record keyed by the bare status string, so an `instructorStatusLabels` would
have relabelled equipment loans' `requested` and overwritten the `rejected` → "Returned" it wants
anyway. The remaining four humanise correctly unaided; only `paused` needed adding, to `variants`
and `badgeClass`.

**`applicationNote` and `reviewNotes` point in opposite directions and must not be merged.** One is
the member telling staff something the public never sees; the other is staff telling the member why
their application came back. A single "notes" column would be a staff-only field the member is also
shown.

### `teachesLessons` coexists

`directory_entry.teachesLessons` is self-declared, has production data, and reaches six UI sites plus
a directory filter. It stays, and it keeps meaning what it means.

The two facts are different and both true of different people:

- `teachesLessons` — _"I offer instruction."_ Possibly in their living room, possibly in Albany,
  possibly over a video call. A fact about the member's life that CMC has no standing to adjudicate.
- `instructor` — _"CMC has granted this person teaching terms in the practice space."_

| Rejected alternative                               | Why not                                                                                                                                                                                                    |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Replace** — drop the column                      | Destroys member-entered production data, and re-declares a self-description as a staff grant. A member who teaches at home would have their own profile flag revoked by a staff process they never entered |
| **Derive** — `teachesLessons := status = 'active'` | Worse. It makes a self-description a _function of_ a staff grant, so pausing an instructor silently edits a fact about that person's life                                                                  |
| **Write it on grant**                              | Still staff writing a member-owned column. If a nudge is wanted, the grant notification should _ask_ the instructor to tick it                                                                             |

The cost is two similar-looking flags, and it is paid entirely in copy: the self-declared one becomes
**"Teaches privately"** and the new listing is labelled **"Teaches at the Collective."** Two different
words for two different facts is the whole fix.

---

## Booking

### `bookerType` gains `'instructor'`

`reservation.bookerId` carries **no foreign key** — it cannot, since it points into different tables —
so `bookerType` exists to say which table that is. [groups-spec.md](groups-spec.md) is explicit that
this axis must answer _which table_ and never _what sort of thing the row is_, which is why it refuses
to put group `kind` on the polymorphism.

A staff-granted `instructor` table is what makes `'instructor'` a legitimate value: `bookerId` points
at `instructor.id`, a real row in a real table. The same person booking both produces
`('user', user.id)` and `('instructor', instructor.id)` — same human, different capacity, different
table, different terms.

`bookerType: 'instructor'` with `bookerId → user.id` would have been the wrong shape: two discriminator
values addressing one table, distinguished by what sort of thing the row is.

#### The legacy `'lesson'` value

> **Run, and the answer was zero.** Production holds **no reservation with
> `booker_type = 'lesson'`.** The value sat in the enum from the reservation
> system's first day, reserved for a module that had not been designed, and was
> never once written.
>
> So `'lesson'` is **deleted** — from `bookerTypes` and `prototypeTypes` alike —
> and `'instructor'` takes `IconSchool` back. Nothing is renamed and nothing is
> backfilled, which are the two things a rename would have required and the
> second of which would have minted staff grants out of historical data.
> Removing an enum value emits no SQL.
>
> One consequence is not a deletion. The staff reservations page carried a
> special case giving `'lesson'` its own glyph, because a booker type whose ref
> resolves to the member leaves the Booker column unable to say what the booking
> is. **`'instructor'` has exactly that property**, so the branch was retargeted
> rather than removed.

**`'lesson'` is not renamed to `'instructor'`, whatever the census says.** The `band` → `group` rename
was safe because the rows stayed correct: `group.id` **is** `band.id`, so every stored `bookerId`
still resolved after the value changed. Here nothing moves and there is nothing to point at —
`refs.ts` states that `'lesson'` "has no record to point at." Renaming would relabel rows as pointing
into `instructor` when they do not, so the discriminator would be wrong about exactly the rows the
rename was performed to describe. A dead value that is honestly dead is strictly better.

**Backfilling `instructor` rows for those users is also refused.** It would mint a staff grant out of
historical data: whoever appears on a legacy lesson booking would acquire teaching status nobody
granted them, arriving silently through a migration. That is the one thing the staff-grant decision
exists to prevent.

`recurring_series.prototypeType` needs **no** new value. An instructor's recurring booking is a
recurring _reservation_.

### Teaching terms

Terms split by **what the number is a fact about**. Facts about the _room_ — operating hours, slot
minutes, buffer, minimum advance, maximum duration — are identical for everyone and stay on
`ReservationConfig`. Facts about _who is booking_ move behind a resolver, so no caller reads a rate
directly:

```ts
export interface BookingTerms {
	hourlyRateCents: number;
	minDurationHours: number;
	maxAdvanceDaysOneoff: number;
	maxAdvanceDaysRecurring: number;
	creditsApply: boolean;
}
export function termsFor(bookerType: BookerType, cfg: ReservationConfig): BookingTerms; // pure
export async function getBookingTerms(bookerType: BookerType): Promise<BookingTerms>;
```

A parallel `getTeachingConfig()` under its own `teaching.` prefix was rejected: it costs a second
`getConfigsByPrefix()` — an extra KV `listKeys` plus a `getJson` per key — on a hot path, and leaves
two places to look for "the rate." Merely widening `ReservationConfig` was rejected too: it grows a
parallel set of every term with nothing stopping a caller reading `config.hourlyRateCents` when it
meant the teaching one, and there are already about twenty such reads.

| Key                                           | Default | Note                                                                                      |
| --------------------------------------------- | ------- | ----------------------------------------------------------------------------------------- |
| `reservation.teachingRateCents`               | `500`   | **$5/hr — the rate a sustaining member's contribution already buys, uncapped.** See below |
| `reservation.teachingMinDurationHours`        | `0.5`   | `minDurationHours: 1` blocks a half-hour lesson today                                     |
| `reservation.teachingMaxAdvanceDaysOneoff`    | `60`    |                                                                                           |
| `reservation.teachingMaxAdvanceDaysRecurring` | `90`    |                                                                                           |

#### $5/hr is the member rate, not a discount on it

**A sustaining member's contribution already buys room time at exactly $5 an hour.**
`webhook-handlers.ts` states it in a comment and then computes it:

```
$5 = 1 hour = 2 credits
freeHoursCredits = contributionCents / (DOLLARS_PER_UNIT * 50)   // cents / 250
```

So `$5 → 2 credits → 1 hour`. The $15 `reservation.hourlyRateCents` is the **drop-in** rate: what an
hour costs once your monthly allocation is spent, or if you never contributed.

That makes the teaching rate not a subsidy and not a favour. **It is the member rate with the monthly
cap lifted.** A teacher whose contribution buys ten credits runs out after five hours; teaching status
lets them keep buying at the same price instead of stepping up to drop-in. CMC forgoes the _difference
between drop-in and member pricing on hours past the allocation_ — not two thirds of its room revenue.

Three things follow, and the first two reverse what an earlier draft of this spec claimed.

**The abuse case is much smaller than "a third of the price" suggested.** An instructor who books
teaching time and rehearses in it is paying what they would have paid with credits. Nothing stops
them, and nothing needs to: the only thing they gain over any other member is that their hours are not
capped at the allocation. That is worth naming — an uncapped member rate is still worth something —
but it is a long way from the cheapest rehearsal in the building, which is what a genuine third-price
rate would have created. Trust it; surface teaching hours on the staff page if it ever needs watching.

**And it makes the rate defensible without appeal to what CMC likes.** "Teachers pay what members
pay" answers the member who asks why someone else's business is being subsidised. "Teachers pay a
third" does not.

**The remaining asymmetry is the cap, so that is the number to tune if this ever goes wrong** — not
the rate. Cutting the rate would break the equivalence that makes it defensible; capping teaching
hours per week would not.

**A last, small consequence.** A 30-minute lesson is a **$2.50** charge against a Stripe fee of
roughly $0.38 — about 15%. Cash at the door already exists and avoids it. A reason to prefer it for
teaching, not a reason to raise the minimum duration.

**The windows are the load-bearing number, and they are policy.** The member 14-day window rations a
scarce room among many members. A teaching studio is a standing arrangement a student pays for a
_term_ of; at 14 days an instructor cannot tell a student when their next four lessons are, which
makes the whole feature not work. This is a decision about how much of the room CMC is willing to sell
to teaching, which is why it is config rather than a constant — it is the first number staff will
re-tune.

**`teachingMaxAdvanceDaysRecurring > maxAdvanceDaysOneoff` is a constraint, not a preference.**
`checkEventAndClosureConflict` treats only `bookerType: 'event'` as a hard block, so a teaching series
is Tier 2 and _can_ be waitlisted behind a member's one-off booking. Teaching time is rented, not
privileged, so that is correct — but the first complaint this module generates will be "the teacher
lost the room they teach in every Tuesday." The mitigation needs no new machinery: a teaching horizon
longer than any member can book into means the series is already materialized before a member can
reach that week. Assert it in `termsFor` so it cannot drift.

#### Where off-peak pricing meets this

CMC also intends to price the room lower before 4pm, for everyone, to fill hours that are otherwise
empty. That is a room-pricing change rather than an instructor one and gets its own spec; two things
about the seam belong here.

**The rate is the lowest that applies.** `min(bookerRate, timeRate)` — a teaching booking at 2pm pays
$5, not some compounded figure, and a teacher never has to reason about which discount they are on.
Since the teaching rate is already the member rate, off-peak will in practice rarely go below it, so
this mostly means teaching is unaffected by the time of day. That is the right outcome: the two
instruments target different things, and stacking them would be pricing the same hour down twice for
reasons that have nothing to do with each other.

**Off-peak is where `creditsApply` earns its keep.** Credits and the teaching rate agree at $5, so
credits on teaching time are exact. An off-peak rate that is _not_ a whole number of credit-halves
would leave a member's credit over- or under-covering a slot, and `commitReservationCredits` needs the
flag to say so. Keeping the parameter is what stops that being discovered later as a rounding bug.

**Pricing stops being `duration × rate`.** A booking spanning 4pm has two rates, so the total is a sum
over half-hour slots rather than a multiplication. That is not a change of rate _source_, which is what
`termsFor` was built for — it is a change of _formula_, and it replaces
`Math.round(durationHours * hourlyRateCents)` at eight-plus sites. The off-peak spec owns that work;
this module only has to not assume a single scalar rate per booking.

### Credits apply to teaching, and the arithmetic is already exact

`creditsApply: true` for `'instructor'`. An earlier draft of this spec said the opposite, on the
grounds that a credit would be "worth $2.50 in teaching where the same credit is worth $7.50 in
rehearsal." That was wrong twice over.

**A credit is always thirty minutes.** `hoursToCredits` and `creditValueCents` are both derived from
`MINUTES_PER_CREDIT = 30`, so `creditValueCents(rate) = rate / 2` is exactly what thirty minutes costs
at that rate — at $5 and at $15 alike. One credit buys half an hour whatever it is spent on. Its cash
value tracks the rate because the rate is what it is discounting; it does not "lose value."

**And the goal is to extend the allocation, not to bypass it.** Teaching status exists so a teacher
can keep going _past_ their ten credits, which presupposes the credits were spent first. Refusing them
would mean a teacher paying cash from the first hour while their allocation sat unused — the opposite
of extending it.

The two prices agreeing is what makes this seamless rather than merely permitted: at $5/hr one credit
covers exactly one half-hour slot, so the ledger does not have to reason about partial coverage on a
teaching booking at all.

`computeReservationCredit` needs no change for any of this — it already takes `hourlyRateCents` and
`freeHoursBalance` as arguments and is agnostic about where they came from. `commitReservationCredits`
still needs its `creditsApply` parameter, because off-peak pricing below introduces the one case that
genuinely wants credits withheld.

### Recurring

Instructor series reuse `recurring-series-service` and `generation-job` unchanged in their insert
path — `processSeries` copies `bookerType`/`bookerId` from the prototype and never calls
`validateBooking`.

Two things do change. `generationWindowEnd(from)` is **global** — one horizon for every series in the
system — and gains a `bookerType` parameter that `processSeries` supplies from the prototype. And the
recurring branch carries **no sustaining-membership gate**: `bookMemberReservation` requires one
because recurring rehearsal time is a membership benefit that the subscription buys. Teaching time is
not a benefit; it is a rental at a different rate that CMC granted directly. Requiring a membership on
top of a staff grant would mean staff granting something the member then cannot use.

---

## Surfaces

### The listing is a sibling route, not a filter

`/directory/instructors` (public) and `/member/directory/instructors`, reached by a third `TabBar` tab
whose `href` points at the sibling route. `TabBar` renders `<a>` in URL mode, so cross-route tabs
compose with no shared state.

Reusing the existing `teachesLessons` filter checkbox was the cheap move and is wrong for three
compounding reasons:

- **Different reader.** The existing directory answers _"who can I play with"_ for a signed-in member.
  This answers _"who can teach me"_ for someone who found CMC from a search engine and has no account.
  A query string is not a landing page.
- **Different columns.** `IdCard` shows instruments, genres and bands. An instructor card shows what
  they teach, whether they are taking students, and how to reach them. Bolting a mode onto `IdCard`
  gives one component two layouts and two prop sets.
- **Different truth.** The filter reads the self-declared flag, which deliberately still means
  "anywhere." A route whose entire content is "teaches at the Collective" cannot be a filter over a
  column that means something else.

`/directory/instructors` is **public**: the whole point of "be found as a teacher" is that the finder
is not a member.

### Three gates, and all three are exposure risks

This is the only part of the module where a mistake publishes somebody who did not consent. Each gets
its own test.

1. **`eq(status, 'active')`** — stops an unapproved applicant's draft listing being published. The
   application is a real listing in a real table, one missing predicate from the public page.
2. **`directory_entry.visibility`** — stops a member who hid their directory listing being surfaced by
   a second one.
3. **`contactForView('public', …)` over the resolved contact**, fallback included.

And a fourth that is a whitelist rather than a gate: `applicationNote` must never reach any DTO.
Follow `toPublicMemberProfile`'s rule — fields are listed explicitly "so a newly added column never
leaks by default."

### No instructor panel

A panel is for work you return to. An instructor's entire relationship with the module is _book the
room_ and _keep my listing current_ — two things, neither workspace-shaped.

Booking lives on `/member/reservations`: `CreateModal` gains a booking-type step that appears **only**
when the caller is an instructor, and the rate, minimum duration and window shown in the wizard come
from `getBookingTerms(bookerType)` once the type is chosen.

Everything else is one card on `/member/profile` with five states: an "Apply to teach at CMC" prompt
when there is no row · the application form at `'requested'`, withdrawable · `reviewNotes` plus an
edit-and-resubmit form at `'rejected'` · the listing editor at `'active'` · a status line at
`'paused'`/`'retired'`. `member/nav-items.ts` is untouched.

`/contribute`'s existing "Host a Workshop" card is the **groups** path, not this one. Different ask,
left alone.

### Staff

| Surface                                        | Answers                                                          |
| ---------------------------------------------- | ---------------------------------------------------------------- |
| `/staff/instructors`                           | _Who teaches here?_ — the roster, the Requested block, the grant |
| `/staff/users/[id]` → `panels/InstructorPanel` | _What is this person's story?_ — grant record, status, bookings  |

The list route is where applications are reviewed and grants are made, mirroring `/staff/groups` as
the only place a club is created. The panel goes on the existing **`space`** tab rather than a ninth
tab — `tabs.ts` already says eight "outrun a phone even collapsed" — and that is also where it belongs
semantically: the grant is a right in the room.

Five actions: **Approve**, **Send back**, **Grant** (direct, skipping the application), **Pause**,
**Retire**. A note is **required** on Send back, Pause and Retire, for the reason
`member_certification.revokedReason` already carries a CHECK: the next staffer reading the list needs
to know why, and in Send back's case so does the applicant.

**Retiring does not cancel future teaching bookings.** Ending a grant is a decision about the future;
a booked lesson has a student on the other end who has already been told a time. The staff page
surfaces the count and links to the reservations, and cancelling is a separate deliberate act. Any
other behavior means a staff click silently strands somebody at the door.

---

## Defects this module uncovers

Found by reading the source while designing, all verified. Each would ship a silent bug.

| Defect                                                                                     | Effect                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `commitReservationCredits` reads the balance itself and accepts no policy flag             | A teaching booking routed through it **spends the instructor's free hours**. Needs `creditsApply`. Skipping the call instead leaves `cashDueCents = null`, which every staff query and the unconfirmed sweep read as an uncommitted member booking                                                       |
| `cancelAllForUser` scopes only on `createdByUserId`, and runs on `subscription.deleted`    | An instructor whose sustaining membership lapses **silently loses their standing lesson slots** — silent because a cancelled series does not error, it stops generating. Scope to `booker_type = 'user'`: the lapse should cancel the benefit the subscription bought, and it never bought teaching time |
| `deactivateUser` matches `bookerType='user' AND bookerId=userId`                           | An instructor booking's `bookerId` is `instructor.id`, so it never matches — a deactivated instructor's future bookings **keep holding the room**, with `instructor` cascading away underneath them. Needs a second arm on `createdByUserId`                                                             |
| `reservation.minAdvanceMinutes` is written by the settings form but absent from `DEFAULTS` | Works only because `config.ts` supplies a local fallback; `config('reservation.minAdvanceMinutes')` throws. Pre-existing                                                                                                                                                                                 |

One known limit, stated rather than fixed: `bufferMinutes` applies in `hasConflict` but not in
`create()`. Back-to-back teaching slots work today only because the buffer defaults to 0 _and_ the
member create path ignores it. If staff ever raise it, an instructor's own consecutive slots refuse
each other on the generation and staff paths but not on the member path.

---

## Not in scope

Stated flatly so no omission reads as an oversight.

Students, enrolment, lesson records, minors, guardian consent, waivers · payouts, revenue splits, or
any money between CMC and the instructor beyond room rent · a student-facing booking page —
`bookingUrl` links out to whatever the instructor already uses · instructor availability publishing,
which would be a second scheduling system beside the room calendar · a separate
`directory_tag kind='teaches'` · an instructor panel · multi-room or per-room teaching rates, since
there is one room · repointing or backfilling legacy `'lesson'` rows.

On the application specifically: **CMC verifies nothing an applicant claims.** `applicationNote` is
prose staff read, not a credential — no background check, no reference check, no insurance
attestation, no `volunteer_certification`-style clearance. If CMC ever wants to _verify_ rather than
_read_, that machinery already exists in `volunteer_certification` / `member_certification` and should
be reused rather than reinvented. Also out: a **second-level appeal** — a returned application has
been read by two people, a third is a committee, and per the appeals spec the collective does not have
one — and an application queue SLA or auto-expiry.

---

## Phases

Shipped across six phases with no feature flag. Its two remaining loose ends — a handful of raw
`hourlyRateCents` reads that bypass the teaching-rate resolver, and missing instructor coverage in
`conflict-service.spec.ts` — are tracked in `CHORES.md`.

**There is no feature flag**, which shapes the phasing rather than merely removing a line. A flag is
what makes it safe to land a member-facing surface before the capability behind it works; without one
the _order_ carries that guarantee. Two rules follow:

- **Staff-only surfaces may land early.** A half-built admin page is a normal intermediate state.
- **No member-facing surface lands before the thing it advertises works.**

That puts the member application in the same phase as the listing, at the end — which produces a
better rollout than the flag would have. Between the staff surface landing and that launch, the module
runs **staff-curated**: staff grant instructors they already know, directly, and those instructors book
teaching time. Open applications are then a deliberate second launch rather than a flag flip, and that
is a real operating mode CMC may want to sit in for a term.
