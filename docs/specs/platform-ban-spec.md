# Platform Ban — removing someone, on the record and reversibly

## Purpose

There is no way to ban somebody from CMC. There is `deactivateUser`
(`src/lib/server/user/user-service.ts:60`), and it is the only door out of the
platform — used both by a staffer removing a member and by the member deleting
their own account (`deleteAccount` in `src/lib/remote/account.remote.ts:167`
calls the identical function). Both write `user.deletedAt`, so afterwards
nothing in the database distinguishes "they left" from "we removed them".

It takes a user id and nothing else. No acting staff id, no reason. A removal
leaves no record of who decided or why, which means it cannot be explained to
the member, reviewed by another staffer, or contested. `deactivateUsers` tracks
`skipUserId` so a staffer cannot catch themselves in a batch — it still does not
record who ran the batch.

And it is the wrong weight in both directions at once. It is **heavier** than a
ban should be: it cancels the member's future personal and teaching reservations
and schedules their Stripe subscription for cancellation, and `reactivateUser`
(~:142) clears `deletedAt` and nothing else, so a removal reversed an hour later
has still taken both. It is **lighter** than a ban needs to be: nothing stops the
same person signing up again with a second address, because there is no blocklist
of any kind — and it does not revoke their door code, so on the collective's own
premises it does not remove access at all.

What is not broken is the kill switch. `hooks.server.ts` re-resolves the session
on every request and treats a member with `deletedAt` set as anonymous, and
`deactivateUser` deletes their session rows on the way out. That gate is sound
and this spec does not touch it. What is missing is **the record and the
gradations**.

This is the spec `docs/specs/moderation-appeals-spec.md` defers to. That spec
excludes account deactivation from appeals explicitly, on the grounds that
"designing an appeal against a mechanism nobody has designed would produce a bad
version of both", and says that when this spec lands it "should route through
reports and inherit this". It does.

## The rule this rests on

**Enforcement removes access. It never destroys the member's history.**

A ban is a statement about what someone may do next. It is not a statement that
they were never here. The shows they organised happened, the hours they
volunteered were worked, the money they gave was given, and the conversations
they had are half somebody else's. Removing access to an account must leave all
of that intact, and reversing the removal must give back what the removal took.

Everything below is downstream of that. It is why suspension pauses billing
instead of cancelling it, why a ban does not unpublish anyone's gig listing on
its own, and why the blocklist has to outlive the user row.

The second rule is inherited rather than introduced here, from
`moderation-appeals-spec.md`: **every moderation action is an upheld report.**
A removal recorded by this feature points at a `content_flag`, and the staffer
who imposed it wrote down what happened and why in order to impose it.

## What is true today

Verified against `main` while writing this, because a spec that argues with the
code is worse than no spec:

| Claim                                                                | Where                                                                              |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `deactivateUser(userId)` takes no actor and no reason                | `user-service.ts:60`                                                               |
| Self-delete and staff removal are the same function                  | `account.remote.ts:167`, `users.remote.ts:503`                                     |
| It cancels future personal **and** teaching reservations             | `user-service.ts`, the two-armed `bookerType` predicate                            |
| It cancels the Stripe subscription, swallowing failures              | `user-service.ts`, `if (row.stripeId)`                                             |
| That cancel is `cancel_at_period_end`, **not** immediate             | `finance/subscription-service.ts:411`                                              |
| `reactivateUser` restores neither                                    | `user-service.ts:142` — it sets `deletedAt: null` and stops                        |
| The enforcement gate is sound                                        | `hooks.server.ts`, `if (session && !session.user.deletedAt)`                       |
| Sign-in is already gated, non-enumerating; **sign-up is not gated**  | `auth.ts` `before` hook — `/sign-in/email` yes, `/sign-up/email` is Turnstile only |
| `user.email` is `notNull().unique()`, unconditionally                | `schema/authentication.ts:57`; no partial index in the snapshot                    |
| The standing ladder is `none` / `restricted` / `disabled`, per scope | `src/lib/config.ts`, `standingScopeConfig`                                         |
| No audit table exists                                                | `docs/README.md`, `audit-log-spec.md` is unbuilt                                   |

Four things the issue does not mention, found while checking it, each of which
this design has to account for:

- **Door codes are not revoked.** `lock_member_code` rows are cleared only by an
  explicit `revoke` (`lock/member-code-service.ts`), and `lock-service.ts`
  provisions per-booking codes off an unfiltered join to `user`. A banned member
  holding a standing code, or named on a surviving band booking, **can still open
  the building.** For a physical space this is the sharpest gap in the whole
  issue, and it is not in it.
- **Recurring series keep generating.** The individual future instances are
  cancelled, but `recurring_series` is never stamped `cancelledAt`, and
  `generation-job.ts` selects on `cancelledAt` / `supersededBy` / `endsAt` only.
  A removed member's weekly booking re-creates room-holds indefinitely.
- **Band rosters do not filter `deletedAt`.** `getMembers` and the public band
  lineup in `directory.remote.ts` filter on `groupMember.status` and the
  member's own directory visibility, never on the account being deleted. A
  removed member stays on their band's public page.
- **A removal emails the person it removes, repeatedly.** Each cancelled booking
  dispatches "Reservation cancelled — this was done by CMC staff", and the Stripe
  webhook later dispatches "Your CorvMC membership is set to end". The dispatcher
  has no `deletedAt` check.

One consequence of the unique index deserves stating up front, because it
changes what a blocklist is for: **a soft-deleted row keeps occupying its email
address**, unconditionally — there is no partial index. Re-registering with the
_same_ address already fails today. It fails as a constraint collision rather
than as a decision, and it stops failing the moment the row is purged. So the
naive picture, "a banned member signs up again the next minute with the same
address", is not the actual hole. The actual hole is a second address, and no
blocklist closes that.

The same accident cuts the other way: a member who left and wants to come back
under a fresh account is also stuck, because the app has **no email-change path
at all** (`staff-email-change-spec.md` is unbuilt) and purge is the only thing
that frees an address. Neither half of that behaviour was decided; both are
properties of a `UNIQUE` column.

## How it works

A staffer decides that Kit has to go. On `/staff/users/[id]` they choose
**Remove access**, pick **Suspend** or **Ban**, and — because this is filing a
report — write down what happened. Suspension asks for an end date; a ban does
not have one.

The account is soft-deleted, exactly as today: sessions purged, the next request
resolves as anonymous. Their door code is revoked, which today's deactivation
does not do. Alongside it, a removal record is written naming the staffer, the
reason, the kind, the term, and the report it came from.

What the removal _reaches for_ depends on the term. A four-week suspension
cancels Kit's practice-room bookings inside those four weeks and leaves the ones
after it alone, and it **pauses** their sustaining membership rather than
cancelling it. A ban has no end, so it reaches everything ahead of it.

Kit gets an email. It says what happened, quotes the staffer's note, says when
it ends if it ends, and carries a signed link to a page where they can appeal —
because they cannot sign in to reach one. The appeal is the same
`moderation_appeal` a restricted member files, hanging off the same upheld
report, answered by a staffer who is not the one who made the call.

Four weeks pass. A scheduled job lifts the suspension: `deletedAt` cleared,
billing unpaused, the removal record stamped lifted rather than deleted. Kit
signs in. Their profile, their history, their credit balance and their band
memberships are where they left them. The bookings that were cancelled are
listed on their dashboard, with the ones whose slot is still free offered back
as one click each, and the ones somebody else has taken since marked plainly as
gone.

If the appeal had been granted at week one instead, the same thing happens
earlier, on the staffer's click.

```
                     staff impose
  (good standing) ──────────────────▶ suspended ──term lapses / appeal granted──┐
        ▲                                                                        │
        │            staff impose                                                │
        ├───────────────────────────▶ banned ────appeal granted / staff lift─────┤
        │                                                                        │
        └────────────────────────────────────────────────────────────────────────┘

  (self-delete is not on this ladder — see "The self-delete is not an enforcement action")
```

## Scope

**In:**

- Two new account-level removal kinds — **suspension** (a term) and **ban**
  (indefinite) — distinguished from the member's own **self-delete**.
- A **removal record**: acting staff id, reason, kind, term, the triggering
  report, and how it ended.
- A new `member_standing` scope for the rung below removal, so "you may not book
  the room" stops requiring "you may not have an account".
- Side effects scoped to the term, and **reversal that restores what it can and
  says plainly what it cannot**.
- An **email blocklist** that survives a purge, refuses re-registration, and
  records the attempt.
- An **appeal reachable without a session**, inheriting `moderation_appeal`.

**Out (deliberately):** see [What this does not cover](#what-this-does-not-cover).

## Decisions

### Enforcement does not change; only the record and the term do

`user.deletedAt` stays the single predicate the request gate reads. There is no
second `status` column enforcing a second kind of removal.

This is the most important decision in the spec and it is a restraint rather
than a design. The gate in `hooks.server.ts` is correct, it is one comparison,
and better-auth's session cookie cache already carries `deletedAt` so the check
costs no read. Introducing `status = 'banned'` beside it would create two
predicates that must agree forever, in a codebase where every `isNull(deletedAt)`
filter across the directory, the roster queries and the staff tables would have
to learn about the second one. The first place they disagreed would be a banned
member visible somewhere nobody thought to look.

So: the removal record explains a `deletedAt`; it never independently causes
enforcement. A reader asking "may this person use the site?" reads `deletedAt`.
A reader asking "why not, and until when?" reads the removal record.

### Suspension earns a kind, not a mechanism

This is the open question `docs/specs/reactivation-restore-spec.md` left behind
when it was retired in #427, and it is why that spec could not be finished.

**Answer: yes, suspension is distinct — as a kind and a term on the record, not
as a separate enforcement path.**

A suspension and a ban lock someone out identically. If they were two mechanisms
they would be two code paths that must never diverge, and they would diverge:
one of them would get the fix for the cookie-cache window and the other would
not. What genuinely differs between them is three things, all of them data:

1. **Term.** A suspension has an end date; a ban has none.
2. **Blocklist.** A ban blocks the address; a suspension does not, because the
   account it suspends is coming back and still holds the address.
3. **Posture.** A suspension is a consequence with an end already agreed. A ban
   is a decision to be reviewed. Both are appealable; only one lapses on its own.

One kind column and one nullable term column carry all three, and the side
effects read the term rather than the kind — which is what makes the next
decision fall out for free.

### The rung below removal is a standing scope, not a new thing

The gap between "your DMs are reply-only" and "you no longer have an account" is
real, and it is currently unbridgeable: `member_standing` covers
`community_event`, `suggestion` and `messaging`, so a member who is a problem in
the practice room can only be restricted in domains that have nothing to do with
the practice room, or removed outright.

That is a missing **scope**, not a missing mechanism. `member_standing` already
generalises exactly this: a per-domain gate on a shared `none` / `restricted` /
`disabled` ladder, with `standingScopeConfig` declaring which rungs a scope may
hold. Adding `reservation` — `restricted` meaning a booking waits for staff,
`disabled` meaning no bookings at all — needs no new table, no new service and
no new appeal path, because standing already has all three.

`src/lib/config.ts` sets the bar for adding one: "a scope nothing reads is a
column that lies." `reservation` clears it, because the booking path is an
obvious and single place to consult it. Nothing else in this spec proposes a new
scope; `volunteering` and `door_access` are plausible later and are not claimed
here.

**A removal is not a scope**, and must not become one. The whole point of
`member_standing`'s `(userId, scope)` key is that scope does not collapse — an
upheld report about a listing must not cost somebody their suggestions. A ban is
the collapse of scope by definition. Putting it in that table as
`scope: 'account'` would mean one row whose meaning is categorically unlike every
other row: it gates the application rather than a feature, and every reader of
`getStandings` would have to special-case it.

### The record is a new table — not columns, and not the audit log

**A new table, `account_removal`**, in `src/lib/server/db/schema/` beside
`standing.ts`.

Not columns on `user`, for two reasons. A removal is an **event with a
lifecycle** — imposed, then lifted or lapsed — and the sequence matters: whether
this is somebody's first suspension or their third is exactly the question a
staffer asks before deciding the next one. `user` holds current state, and
columns there would hold one removal and forget the rest. Second, they would be
six columns that are null for approximately every row in the table.

Not the audit log either, and this one is worth being explicit about because
`docs/specs/audit-log-spec.md` already claims a `user.deactivated` action key.
Two properties that spec chooses for itself disqualify it from being the record
of _why someone is currently locked out_:

- **Its writes are best-effort and swallowed** — "an audit write that fails must
  not roll back a deactivation the operator already saw succeed." A record that
  is allowed to be missing cannot be the one a member-facing notice reads.
- **It is pruned at 24 months.** A ban outlives two years. Its reason has to.

The two are complements, not duplicates: the audit log answers "what happened to
this account, ever", append-only and prunable; `account_removal` answers "why is
this person locked out, since when, until when, and who decided", authoritatively
and for as long as it is true. When the audit log lands it should record removals
as it records everything else, and read nothing from them.

**What the record carries** (prose, not schema — the maintainer generates the
migration with `pnpm db:generate`):

- The **subject** and the **actor**, as separate user references. `self_delete`
  is the case where they are the same person, which means the distinction the
  issue asks for — "they left" versus "we removed them" — is answered by the
  kind, and cross-checkable against the actor.
- The **kind**: `self_delete`, `suspension`, `ban`.
- The **reason**, the staff note shown to the member. Required for
  `suspension` and `ban`; meaningless for `self_delete`. Capped at
  `STANDING_REASON_MAX` (500), the cap standing already uses, so a staffer moving
  between the two forms meets one limit.
- The **triggering report** — a `content_flag` id. Required for `suspension` and
  `ban`; see the next decision.
- The **term**: a nullable end timestamp, set for `suspension` only.
- **How it ended**: a lifted timestamp, a lifting user, and a lift reason
  (`appeal_granted`, `term_lapsed`, `staff_lifted`, `member_returned`).
- The **side-effect ledger**: what the removal cancelled or paused, so reversal
  has something to reverse. See [Reversal](#reversal).

One row per removal, never upserted. The current removal is the row with no
lifted timestamp — the same "null means open" predicate the appeals spec uses for
`decidedAt`, and for the same reason: one nullable column beats a status column
that can disagree with the timestamps beside it. A unique partial index on
`(userId)` where the row is unlifted keeps "two open removals" unrepresentable.

The actor and subject references follow `member_standing`'s precedent of
`onDelete: 'set null'` for the actor: purging a staff account must not erase what
it decided.

### Every removal recorded here is a behaviour call, because it requires a report

`triggeringFlagId` is **required** for `suspension` and `ban`. That is the whole
mechanism by which principle 1 — appeals contest behaviour calls only — is
enforced structurally rather than by convention.

This is the constraint #556 imposes on this design, and it is worth restating in
its own terms. Under-18 messaging used to be switched off by writing a
`member_standing` row, which made an eligibility fact wear a moderation costume:
staff read it off the same card as somebody restricted for abusing DMs, and under
the appeals spec the member would have been offered an appeal against their own
date of birth. #671 evicted it — `user.dateOfBirth`, eligibility derived from it,
and a distinct `ineligible` result that carries no reason line and no "contact us
if this is a mistake", because nobody judged them.

The identical error is available here and is worse. "We removed this person
because they have not paid", "because a court told us to", "because the board
voted to exclude them from the building" are all real and none of them are
behaviour calls. Recorded as bans, they would each be shown to the member as a
moderation decision with an appeal button under it — inviting them to contest a
judgement nobody made.

Requiring a report is what makes that obvious rather than merely discouraged:
**an administrative removal has no report to point at**, so it cannot be written
here without someone fabricating one. It therefore has nowhere to live yet, which
is the correct and honest state — the same state the under-18 case was in
between the appeals spec and #671. It is named in
[What this does not cover](#what-this-does-not-cover) rather than accommodated.

`content_flag` has no `user` entity type. A staff-filed removal report targets
`member_profile`, which `scopeForFlag` already maps to `null` — correctly, since
a removal costs no standing in any scope. The removal record is the consequence,
in place of a `member_standing` row.

### The term is what tells the side effects how far to reach

A removal cancels future reservations **that fall inside the removal**, not all
of them:

- **Ban** — no end, so every future reservation. This is today's behaviour.
- **Suspension until D** — reservations starting before D. A booking in
  September is not cancelled by a suspension that ends in July.

Today's blanket cancellation is only defensible because today there is no term.
Once there is one, cancelling beyond it destroys something the removal never
claimed, which principle 2 forbids.

The two-armed `bookerType` predicate in `deactivateUser` is preserved exactly as
written — personal bookings match on `bookerId`, teaching bookings on
`createdByUserId`, because a teaching booking's `bookerId` points into
`instructor`. That distinction was a bug fix and its comment says so; the new
window clause goes beside it, not instead of it.

Band and event bookings stay excluded, unchanged. They belong to the band or the
event, not to the person, and the band outlives them.

### Billing is reversible until the period ends, and then it is not

The issue calls the cancelled subscription unrestorable. That is true eventually
and false immediately, and the difference is the whole design.

`cancel()` in `finance/subscription-service.ts` sets **`cancel_at_period_end:
true`**. It does not cancel the subscription; it schedules one. So there is a
window — up to a full billing cycle — in which `resume()` (which already exists,
and already flips the flag back for a member who changes their mind) restores it
completely. After the period elapses the subscription is genuinely terminal:
Stripe does not un-cancel one, and the only way back is a new subscription with a
fresh payment authorisation from the member.

Two consequences.

**Reversal inside the window restores billing, by calling the function that is
already there.** This is the largest single thing `reactivateUser` is missing and
it costs one call. That the fix was this small is a good reason to doubt anyone
had looked.

**A suspension should not schedule a cancellation at all.** It uses Stripe's
`pause_collection`, which is reversible by design without a deadline and is the
feature that exists for exactly this. A four-week suspension that quietly ends a
membership four weeks and a day later, because nobody noticed the period
boundary, is the destructive side effect this spec exists to remove.

- **Suspension** — pause collection for the term, resume on lift. No deadline.
- **Ban** — schedule cancellation, as today. Indefinite, so the period boundary
  is the right place for it to lapse.
- **Self-delete** — schedule cancellation, as today. The member asked to stop.

Three related facts the current behaviour gets wrong and this should fix:

1. **A banned member keeps their paid benefits, including their monthly free-hour
   credits, until the period ends.** That follows from `cancel_at_period_end` and
   nobody chose it. For a ban it is arguably fine — they cannot sign in to spend
   them. It is worth being aware of rather than surprised by.
2. **`user.subscription` is not updated by the cancel.** It keeps reading active
   until Stripe's `customer.subscription.updated` webhook lands. Any staff
   surface showing membership state during a removal is reading a stale JSON blob
   for up to a webhook round trip.
3. **The webhook then emails the banned member "Your CorvMC membership is set to
   end."** They also get one "Reservation cancelled — this was done by CMC staff"
   per cancelled booking. A removal should suppress transactional mail generated
   by its own side effects; the single removal notice is the communication, and
   three machine-written follow-ups undermine it.

Where restoring is genuinely impossible — the period has elapsed —
reinstatement **never re-creates a subscription on its own**. Taking money on a
card without a fresh authorisation, on a reversal the member may not have asked
for, is not a thing this app should be able to do. Instead:

1. The member's reinstatement notice says their sustaining membership ended and
   offers the ordinary resubscribe flow.
2. The side-effect ledger records that a cancellation was scheduled and when, so
   staff have the dates without reconstructing them from Stripe.
3. Staff decide about the gap. Crediting a wrongly-banned member for the months
   they lost is a judgement, not an arithmetic, and `adjustCredits` already
   exists for it.

Do not reconstruct the subscription from the stored `user.subscription` JSON. It
records `stripeSubscriptionId`, `hoursPerReset` and `creditsResetAt` for a
subscription that no longer exists; using it to rebuild one would mean creating a
Stripe subscription on the member's behalf, which is item 1's job and theirs to
consent to.

### Reservations come back through the booking path, or not at all

Reversal does **not** flip cancelled reservations back to confirmed. The slot was
released when it was cancelled, and somebody else may be in it — un-cancelling by
status would double-book the room, silently, and the conflict would be discovered
by two bands arriving at once.

Instead, reinstatement offers each cancelled booking back through the ordinary
booking path, which already knows about conflicts, credits and payment:

- Still in the future **and** the slot is still free → offered as a one-click
  rebook on the member's dashboard and the staff record.
- Slot taken, or the start time has passed → listed, marked unavailable, and not
  offered. Saying so is the deliverable; silently dropping it is what today does.

Credits work out because `cancelReservation` already refunds what the booking
consumed — the rebook spends them again through the same path. If a rebook is
rejected for insufficient credit, that is the true state of the account and the
member is told, rather than the room being handed over on the strength of an
entitlement that was refunded weeks ago.

### The blocklist outlives the user row, and is a speed bump rather than a gate

Be honest about what this achieves.

**What it blocks:** an account being created with an address on the list. That is
all it can mean.

**What it adds over today**, given `user.email` is already unique:

1. **It survives a purge.** `purgeUser` deletes the row and frees the address;
   the blocklist entry stays. Without this, "get banned, request deletion, sign
   up again" is a laundering path through the member's own self-service. This is
   also the structural reason the blocklist is **its own table with no foreign
   key to `user`** — the same reasoning `audit-log-spec.md` gives for
   `subject_id` — rather than a column on the row it has to outlive.
2. **It covers more than one address.** Staff can add the second and third
   address somebody is known to use.
3. **It says something intelligible.** Today the collision surfaces as "an
   account with this email already exists", which reads as a mistake.
4. **It records the attempt.** A staff-visible note that a blocked address tried
   to sign up on Tuesday is worth more than the refusal itself, because it is the
   only signal the app can give that somebody is trying to come back.

**What it cannot block: a new address.** Email is not identity. No check
available here changes that, and the ones that gesture at it — IP, device
fingerprint, phone verification — are unreliable against anyone making the
slightest effort, punish shared and institutional connections, and are wildly
disproportionate for a volunteer collective of this size.

**That residual risk is accepted, explicitly.** The real control is not
technical: CMC is a physical place with a roster in the low hundreds, where staff
and members know each other by sight. Somebody banned who returns under a new
address is caught by a person recognising them, not by the signup form. The
blocklist's job is to stop the casual attempt and to leave a record of the
determined one — not to be a gate it cannot be.

The refusal copy does **not** confirm that a ban exists: "This address can't be
used to create an account. Contact CMC if you think that's a mistake." Confirming
would disclose that an account existed to anyone who can type an address, and
would invite the argument at the signup form rather than through the appeal.
There is a precedent to match exactly: better-auth's `before` hook already
refuses a deactivated account at sign-in with a generic "Invalid email or
password", deliberately non-enumerating. Sign-up should refuse in the same voice.

**The check goes in that same hook.** `src/lib/server/auth.ts` already branches on
the path — `/sign-in/email` gets the deactivation check, `/sign-up/email` today
gets Turnstile and nothing else, not even an email lookup. Adding the blocklist
lookup to the sign-up branch covers every signup path in one implementation, next
to the one it mirrors, rather than each remote remembering.

### The self-delete is not an enforcement action

It shares the mechanism and nothing else. Recorded as `self_delete`, it takes no
reason and no report, appears on no moderation surface, and gets **no appeal** —
there is no judgement to contest, per principle 1. It is also the only kind that
carries no blocklist entry, since the member may come back whenever they like.

It is also the only case where destroying the member's data is legitimate,
because they asked. Purge stays the mechanism for that and stays staff-run, and
this spec changes exactly one thing about it: **a purge cannot free a blocked
address**, because the blocklist does not reference the user row.

One consequence to state plainly: a member with an open `ban` who then
self-deletes does not thereby lift it. The removal record is not replaced by a
later self-delete, and the appeal against the ban remains the way to contest it.

### The appeal cannot require a session

Every appeal in `moderation-appeals-spec.md` is filed by a signed-in member
looking at the notice explaining what happened. A banned member cannot sign in —
`hooks.server.ts` resolves them as anonymous, which is the point.

So the ban appeal is reached by a **signed, expiring, single-use link in the
removal email**, landing on a public route that renders the notice and the appeal
form and nothing else. The token names the removal; the form writes the same
`moderation_appeal` row against the same upheld flag, and the staff side is
byte-for-byte the queue they already have.

The alternative — letting a removed member hold a session that resolves to one
locked page — was rejected. It means the request gate stops being "deactivated
means anonymous", and every `requireUser`, `requireStaff` and remote function in
the app inherits a new category of caller it was not written for. A signed link
touches nothing already load-bearing.

The cost is real and named: the link is in an email, and an email may not arrive.
The removal notice therefore also carries the staff contact address in plain
text, and staff can re-issue a link from the user record.

### Ordering, with no transactions

D1 has no interactive transactions and `custom/no-db-transaction` is an eslint
error, so imposing a removal — which touches the user row, reservations, Stripe
and the record — needs an ordering where a crash leaves an obvious, re-runnable
state. Multi-statement local writes use `db.batch([...])`; the Stripe call cannot
be in one and is therefore ordered around it.

**The claim is an atomic conditional update.** Whoever flips `deletedAt` owns the
removal:

```
UPDATE user SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL
```

with a row-count check — no row means somebody else got there first, or the
account was already removed, and the caller stops. `deactivateUser` already
writes exactly this shape and throws `UserNotFoundError` on an empty result; that
is the pattern, and lifting is its mirror (`WHERE id = ? AND deleted_at IS NOT
NULL`). It is the only compare-and-swap available here, and a read-then-write
would let two staffers each believe they imposed the removal.

Then, in order:

```
1. claim         conditional UPDATE on user.deletedAt   ← nothing before this
2. sessions      delete the member's session rows
3. door          revoke the standing member code
4. reservations  cancel those inside the term; stamp the series
5. billing       pause (suspension) or schedule cancel (ban / self-delete)
6. record        write account_removal, with the side-effect ledger
```

**Every step between the claim and the record must be non-fatal.** Today they are
not, and there is a live ordering hazard to fix on the way: `cancel()` in
`reservation-service.ts` throws outright for a booking already in
`cancelled | completed | no_show`, and that throw escapes `deactivateUser` after
the soft-delete is written and before the Stripe call — a half-applied removal
with no record and no billing change. Each side effect is individually
try/caught, its outcome (done, skipped, failed) written into the ledger, and the
record still written. A failed side effect is a line on the staff card saying
what did not happen, which is repairable; an exception between steps is a state
nobody can see.

Effects first, record last — the house pattern from `suggestion-service.ts` and
the one `moderation-appeals-spec.md` adopts. The failure modes decide it: a crash
after step 1 leaves someone locked out with no recorded reason, which is visible
to staff (a soft-deleted account with no open removal row), safe, and repairable.
The reverse order would leave a record reading "banned, suspended until July"
over an account that still works — a state that looks finished, tells nobody, and
is discovered when the member does something they were supposed to be unable to
do.

Lifting runs the same way, reversed in intent and identical in shape: unpause
billing, clear `deletedAt`, stamp the record lifted last.

**No backfill.** Existing soft-deleted accounts get no `account_removal` row, and
absence over a set `deletedAt` reads as "removed before removals were recorded".
Manufacturing rows would mean asserting a kind and an actor nobody knows, which
is worse than an honest gap. After this ships that same shape also describes a
crash between steps 1 and 5 — both mean "we do not know why", both are repaired
identically by a staffer recording it, and both should read that way on the card.

## Blast radius

The issue names four areas. Each, concretely — plus a fifth it does not name and
should have.

### Door access

**A ban that leaves somebody able to open the building is not a ban.** This is
the one place where "removes access" has to mean something physical, and today it
does not: `lock_member_code` rows survive deactivation untouched, and
`lock-service.ts` provisions per-booking codes through a join to `user` with no
`deletedAt` filter.

A removal must revoke the member's standing door code, through the existing
`revoke` in `lock/member-code-service.ts` rather than a second path, and the
revocation goes in the side-effect ledger so reinstatement re-issues one. This is
the only side effect that should also fire for a **suspension of any length**,
because the term bounds what somebody may do online and the front door does not
read terms.

Two edges: a per-booking code on a **band** reservation the removed member is on
survives, because the band booking survives, and the band's owner is the right
person to deal with that. And a physical key or a code somebody has memorised and
shared is outside anything this app controls — the same limit as the blocklist,
and the same answer, which is that the building has people in it.

### Reservations

Cancelled: the member's own future bookings inside the term — personal
(`bookerType: 'user'`) and teaching (`bookerType: 'instructor'`, matched on
`createdByUserId`). Untouched: band bookings, event bookings, and everything in
the past.

A removed instructor is the sharp case and it is already handled: their lessons
would otherwise hold the room indefinitely. It stays handled, now bounded by the
term.

**Recurring series must be stamped, and are not today.** Cancelling the generated
instances does nothing to `recurring_series`, which `generation-job.ts` selects
on `cancelledAt` / `supersededBy` / `endsAt` — so a removed member's weekly
booking keeps re-creating room-holds after the removal, forever. A removal sets
`cancelledAt` on the member's own personal and teaching series (band and event
series are excluded on the same grounds as their bookings), and reinstatement
inside the term restores it. This is a bug the ban feature inherits rather than
causes, and it should be fixed here because a ban is where it becomes visible.

Reversal is rebook-or-report, per the decision above. The side-effect ledger on
the removal record is what makes that possible — without it, "which bookings did
we cancel?" is a guess from cancellation reason strings, and today the only trace
is `cancellationReason = 'Account deactivated'`.

### Events

**A removal does not unpublish anybody's event.** Not automatically.

A community listing on the public gig guide is a commitment other people have
made plans around, and the show happens whether or not its author still has an
account. Pulling it silently harms the audience and the other acts to punish one
person, which is the failure principle 2 exists to prevent.

The codebase already agrees, in two places. `purgeUser` **refuses** when the
member has published listings, on the recorded grounds that "a staffer has to
deal with the listings on purpose". And the calendar query in `event-service.ts`
uses a `leftJoin` to `user` with the comment "Left, so a deleted account does not
take the event off the calendar with it" — somebody thought about this and chose.

A removal follows the same instinct one step earlier: it **queues** the member's
future listings for staff review rather than refusing or acting. Staff then
unpublish, reassign or leave each, on purpose, and whichever they choose is a
moderation decision on the listing itself with the appeal that already implies.

One correction the queue needs: `listPendingSubmissions` uses an `innerJoin` and
no `deletedAt` filter, so a removed member's _pending_ submissions already sit in
the staff queue under their name. They should be marked as such rather than
disappearing, since a pending submission from a removed member is a decision, not
a leftover.

Past events are never touched. They happened.

### Directory

The **member directory works already.** `directory-service.ts` carries
`{ user: { deletedAt: { isNull: true } } }` in its shared where-clause, so the
listing, the profile page, search, the instructor listing, `/m/{n}`, the DM
recipient picker, the band member-search and the volunteer rosters all hide a
removed member without this spec doing anything. That is the second reason
`deletedAt` stays the single predicate: those filters are correct, and a second
status column would mean auditing every one of them.

**Band and group rosters are the exception, and they are not filtered.**
`getMembers` in `band-service.ts` and the public band lineup in
`directory.remote.ts` join `user` with no `deletedAt` predicate at all, so today
a removed member stays visible on their band's public page. Group and committee
rosters, `listBandAdmins`, and the owner column on group queries have the same
omission. That is not a decision anybody made — it is a filter nobody added, and
of roughly 140 joins to `user` under `src/lib/server/`, about a dozen filter.

So there is a decision to make here rather than a bug to fix, and it is:
**a removal hides the member from public roster displays, and does not edit
anybody's roster.** A band's membership is the band's record; rewriting it is not
a consequence the removed member's conduct earns, and the roster row is also how
reinstatement puts them back without anyone re-inviting them. The public lineup
and the band's public page gain the filter the directory already has; the band's
own management view keeps showing them, marked, so the owner knows.

The band's owner is notified so they can decide. If the removed member **is** the
owner, the notification goes to staff instead, and this is a genuine trap:
`purgeUser` refuses on owned bands but `deactivateUser` has no equivalent check,
so a band can be left with a soft-deleted owner — and because of the partial
unique index on one owner per group, nobody else can be promoted until that owner
is demoted, which `transferOwnership` requires the owner to initiate. A removal
therefore raises a staff task rather than silently creating a band nobody can
administer. Refusing the removal outright was considered and rejected: a ban must
not be blocked by the subject's own band memberships.

### Billing

Suspension pauses, ban and self-delete cancel, reinstatement never charges
without fresh consent. Covered in full above.

Two things a removal does **not** touch: the credit balance
(`creditFreeHours`, `creditEquipment`) and the ledger behind it. Those are the
member's, they are money-adjacent, and a reinstated member finding their balance
zeroed would be a destruction that no removal announced. Refunds from cancelled
bookings land there normally.

### Messaging, and everything else

Existing threads stay where they are and stay readable to the other participant —
half of that conversation belongs to somebody who was not removed. The removed
member cannot write, because they cannot sign in; no `member_standing` messaging
row is written, because a removal is not a scope.

Starting a _new_ thread with a removed member is already a silent drop
(`direct-service.ts` filters `isNull(user.deletedAt)` on recipient resolution),
and `getDirectThread` already surfaces `counterpartDeleted`, rendered as "This
member's account is no longer active."

Two things follow that the current code does not do. **The composer is not gated
on it** — `replyToDirectThread` checks writable status, mutual acceptance, blocks
and `neitherPartyDisabled`, but not `deletedAt` — so the surviving participant
keeps typing into a thread nobody will ever read, and each reply dispatches a
notification email to the removed account. The reply path should refuse on the
same predicate the notice already reads, and **the notification dispatcher should
not deliver to a soft-deleted user at all**, which is one check in one place and
fixes the removal-generated mail described under billing.

Volunteer hours, event credits, ticket purchases and inventory history are
untouched throughout. They are records of things that happened.

## Retention

Restating the whole picture in one place, since it is the half of the design most
easily lost:

| Thing                              | Ban / suspension                          | Self-delete                      |
| ---------------------------------- | ----------------------------------------- | -------------------------------- |
| Profile row and history            | Kept                                      | Kept until purge                 |
| Public directory visibility        | Hidden (already)                          | Hidden                           |
| Band / group roster rows           | Kept; hidden publicly (new), owner told   | Same                             |
| Past reservations, volunteer hours | Kept                                      | Kept                             |
| Future reservations in the term    | Cancelled, ledgered, offered back         | Cancelled                        |
| Recurring series                   | Stamped cancelled, restored on lift       | Stamped cancelled                |
| Community listings                 | Queued for staff review, not unpublished  | Unchanged; purge refuses on them |
| Credit balances                    | Kept                                      | Kept until purge                 |
| Direct message threads             | Kept, readable by the other participant   | Same                             |
| Door code                          | Revoked, re-issued on lift                | Revoked                          |
| Stripe subscription                | Paused (suspension) / end-of-period (ban) | End of period                    |
| Email address                      | Blocked on ban only                       | Not blocked                      |
| The removal record                 | Kept indefinitely, lifted not deleted     | Kept                             |

A lifted removal is stamped, never deleted — the same rule
`restoreStanding` follows, and for the same reason: a member who was banned and
then cleared has to read differently from one who never was, both to staff
deciding what happens next time and to the member, whose reinstatement is a thing
that happened to them and not an erasure.

Purge remains the only destructive operation and remains staff-run, with the one
change that it cannot free a blocked address.

## Reversal

`reactivateUser` today is `deletedAt = null`. It becomes the mirror of the
removal it is reversing, driven by the removal record's side-effect ledger:

1. Billing, in three cases: unpause if the removal paused it; `resume()` if it
   scheduled a cancellation and the period has not elapsed; otherwise record that
   it is gone and surface the resubscribe offer.
2. Re-issue the door code, and un-stamp any recurring series still in its window.
3. Clear `deletedAt` via the conditional update.
4. Stamp the removal record lifted, with who and why.
5. Notify the member: what was restored, what was not, and the rebook offers.

Three ways a removal ends, all of them writing the same fields:

- **The term lapses.** A cron job at `src/routes/api/cron/lift-lapsed-removals/`,
  matching the existing per-job route pattern (`wake-snoozed` is the nearest
  precedent). Lapsing is up to one job interval late, and reinstatement is up to
  the 60s session-cookie cache late on top of that. For a term measured in weeks
  that is fine, and it is the honest cost of not adding a second enforcement
  predicate.
- **An appeal is granted.** Immediate, on the staffer's click.
- **Staff lift it.** Immediate.

Idempotence matters more than usual here because the cron job will re-run: every
step writes an absolute value or is conditioned on the state it expects, so
running the lift twice on the same record changes nothing the second time.

## Appeal

The ban appeal **is** a `moderation_appeal`, inheriting
`moderation-appeals-spec.md` wholesale — one appeal per upheld report enforced by
the unique index, `decidedAt IS NULL` as the pending predicate, the staffer who
imposed it barred from denying it though free to overturn it, reopenable by staff,
no second level.

Three deltas that spec cannot supply, because it was written for a member who can
still sign in:

1. **Reached by signed link, not by session.** Above.
2. **A third outcome.** `moderation_appeal` carries `contentOutcome` and
   `standingOutcome`. Granting a ban appeal restores neither — it lifts an
   `account_removal`. That is an **`accountOutcome`** column, not a reuse of
   `standingOutcome`: they are different tables with different lift calls, and
   overloading one would mean a granted appeal that has to guess which it meant.
   It takes `not_applicable` on every appeal that is not against a removal,
   exactly as the other two already do.
3. **Nothing pauses while it is pending**, which the appeals spec already
   decides, and which bites harder here. A suspension keeps running while the
   appeal is read, and its term keeps counting — so an appeal answered after the
   term expires is answered against a lifted removal, and can still be granted.
   Granting a lapsed suspension is not a no-op: it changes the record from
   "served" to "should not have happened", which is what the member is asking for
   and what staff read next time.

Not appealable, per principle 1: a self-delete (no judgement), and any
administrative removal, which cannot be recorded here at all.

## Permissions

| Who        | Can                                                                    |
| ---------- | ---------------------------------------------------------------------- |
| Signed out | File one appeal, via a valid signed link, against the removal it names |
| Any member | Self-delete their own account, password-confirmed                      |
| Staff      | Impose, lift, read any removal; add and remove blocklist entries       |
| Staff      | Decide any ban appeal **except** one against a removal they imposed    |
| Admin      | As staff; purge remains where it is today                              |

Every handler lives in a remote function and opens with `requireStaff()`, save
the self-delete (`requireUser()` plus the existing password check) and the
signed-link appeal, which authenticates by token alone and must therefore verify
the signature, the expiry and single use before rendering anything about the
account. Remote functions bypass route and layout loads and read their params
from a client header, so these guards are the only guard — a layout gate would
gate nothing.

The identity block on deciding an appeal is enforced in the **service**, not the
UI, per the appeals spec: the staff page disables the button and says why, and a
hand-rolled request from the imposing staffer is refused by name.

## Surfaces

| Route                 | What changes                                                                             |
| --------------------- | ---------------------------------------------------------------------------------------- |
| `/staff/users/[id]`   | `AccountPanel`'s deactivate control becomes **Remove access**: kind, reason, term        |
| `/staff/users/[id]`   | A removal history card — every removal, its reason, actor, and how it ended              |
| `/staff/users/[id]`   | Reinstate shows what will and will not come back before it is clicked                    |
| `/staff/flags/[id]`   | The removal appears as the consequence of the upheld report, beside the standing outcome |
| `/staff/blocklist`    | New. Blocked addresses, who blocked them, and refused signup attempts                    |
| `/staff/events`       | The review queue gains listings whose author was removed                                 |
| `/removed/[token]`    | New, public. The removal notice and the appeal form; nothing else                        |
| `/member/account`     | The self-delete copy says what it does and does not destroy                              |
| `/member` (dashboard) | After reinstatement: what was restored, the rebook offers, the resubscribe offer         |

`/staff/users/[id]` is where almost all of this lands, which
`docs/specs/shipped/staff-user-detail-context-spec.md` already establishes as the
operational record for a member. No new staff nav item beyond the blocklist,
which is a reference tool and is linked from the staff dashboard rather than the
main nav — the `audit-log-spec.md` reasoning for `/staff/audit`.

All controls are `form()`-backed and use `$lib/components/ui/Form/`, per
`docs/development/ui-patterns.md`. Sentence case throughout; no gradients.

Notifications, following the existing schema:

- **`account_removed`** (member) — email, since they cannot sign in to see an
  in-app one. Carries the reason, the term, the appeal link and a staff contact.
- **`account_reinstated`** (member) — email and in-app. What came back, what did
  not, and why not.
- **`removal_appeal_filed`** (staff) — in-app. Queue work, not news.
- **`member_removed_from_band`** is deliberately **not** sent, because nobody is
  removed from a band. The band owner gets the existing notification shape saying
  a member's account was removed and their roster is unchanged.

## Dev testing

`scripts/seed-dev.ts` should leave every state reachable without clicking through
the flow, following the existing persona convention: a member under an open
suspension with a term still running, one under an indefinite ban, one lifted by
a granted appeal, one self-deleted, one soft-deleted with no removal record (the
legacy shape), and a blocklist entry with a refused signup attempt against it.

Specs live beside their services, `.spec.ts`, and the ones that matter are the
ones that fail today: that reinstatement restores a paused subscription, that a
suspension does not cancel a booking beyond its term, that a purge does not free
a blocked address, and that the conditional update refuses a second concurrent
removal. Per `docs/development/conventions.md`, run the whole
`src/lib/server/user` and `src/lib/server/moderation` directories rather than the
files touched — the specs there mock `drizzle-orm` export by export, so one new
operator breaks a sibling.

## Phasing

Each phase is useful alone and none of them leaves the app in a worse state than
it is in now.

0. **Close the holes that are not about bans.** Revoke the door code on
   deactivation, stamp the recurring series, gate the reply path and the
   notification dispatcher on `deletedAt`, and filter band rosters. None of this
   needs the record, all of it is wrong today, and each is small. It is phase
   zero because a ban built on top of these is a ban that works, and one built
   without them is a ban that lets somebody in the front door.
1. **The record.** `account_removal`, actor and reason on the removal path, the
   kinds, the staff history card. No behaviour change beyond the form asking for
   a reason. This alone answers the issue's central complaint.
2. **The term.** Suspension, term-scoped reservation cancellation,
   `pause_collection`, the lapse job, and `resume()` on reversal inside the
   period. This is where the destructive side effects stop being destructive.
3. **Reversal.** The side-effect ledger, rebook offers, the resubscribe path, the
   reinstatement notice.
4. **The blocklist.** The table, the before-create hook, the staff surface, the
   attempt log.
5. **The appeal.** Depends on `moderation-appeals-spec.md` having shipped, since
   it consumes `moderation_appeal` and `content_flag.origin`. The signed link and
   `accountOutcome` are the only parts specific to this feature.
6. **The `reservation` standing scope.** Independent of everything above and
   deliverable at any point; it is here because it completes the ladder.

Phase 5 is the only ordering constraint. If appeals has not shipped when phases
1–4 have, a ban is imposed with a recorded reason and contested by writing to
staff, which is where every moderation decision was before that spec — no worse,
and not a regression this feature introduces.

## What this does not cover

- **Administrative and eligibility removals.** Non-payment, a legal instruction,
  a board exclusion, an under-18 rule. They are not behaviour calls, they have no
  report to point at, and recording them here would offer the member an appeal
  against a judgement nobody made — the #556 error, one category up. They have no
  home today. That is the honest state, and inventing one inside a moderation
  spec is exactly how the last one went wrong.
- **Banning a band or a group.** Groups have their own lifecycle, their own
  ownership and their own members who did nothing. `staff-bands-spec.md` owns
  deactivating a band; this spec is about people.
- **Identity verification of any kind.** No phone verification, no device
  fingerprinting, no ID check at signup. See the blocklist decision.
- **Automated removals.** Nothing imposes a ban without a staffer. No thresholds,
  no strike counts, no escalation from a third upheld report.
- **The audit log.** `audit-log-spec.md` is its own unbuilt feature. This spec
  says only that the two are complements and that neither should read the other's
  table.
- **Changing purge.** It keeps its refusals, its permissions and its shape. One
  thing is added: it cannot free a blocked address.
- **A second-level appeal**, inherited from `moderation-appeals-spec.md`. A
  denied appeal has been read by two people; a third is a committee, and the
  collective does not have one.
- **Tamper-evidence.** A staffer with database access can edit a removal record.
  This design records well-behaved application writes and does not defend against
  its own operators.

## Open questions

These need the maintainer's decision and are not the author's to make.

1. **Does a suspended member keep paying?** This spec proposes pausing
   collection, on the grounds that it is reversible and cancellation is not. The
   alternative — they keep paying, because they are still a member and the
   collective's costs do not pause — is defensible and is a values question about
   what a sustaining membership is for, not a technical one. Pausing is the
   recommendation because it can be reversed either way; billing somebody for a
   period you barred them from cannot be undone as gracefully.
2. **How long is the default suspension, and is there a maximum?** A suspension
   with no cap is a ban that lapses eventually. Somewhere around three months is
   where the two stop being meaningfully different.
3. **Who may impose a ban?** This spec says staff, matching every other
   moderation action. An indefinite removal is a heavier decision than a
   takedown, and restricting it to admin — or requiring a second staffer to
   confirm, which nothing in the app does today — is a reasonable alternative.
