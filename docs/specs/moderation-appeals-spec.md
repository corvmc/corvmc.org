# Moderation Appeals — contesting a moderation decision

## Purpose

When staff moderate a member — take their post down, put their future posts
through review, switch their messaging off — the member has no way to contest
it. Their only recourse is to open a thread in `/member/messages` and hope
somebody reads it.

That is workable at the collective's current size and clearly not workable at
three times it. The structural problem is not volume, it is who is being asked to
improvise: the person who most needs a channel is the one who has just been told
they are not trusted, which is exactly the moment an informal "just ask us" stops
working. Nobody writes that message. They just stop posting.

It also leaves a loose end on the staff side. **Restore standing** on
`/staff/users/[id]` is a button somebody has to remember to press after a
conversation that happened somewhere else entirely — a different inbox, a
different week, possibly a hallway. The decision to forgive and the act of
forgiving are separated by human memory, which is the weakest component in the
system.

This is the **Moderation Appeals** entry in `IDEAS.md`, the deliberate follow-up
to the suggestion board (`d4df38c`), and it now sits on top of the merged
`member_standing` table (`docs/specs/shipped/member-standing-spec.md`).

## The rule this rests on

**Every moderation action is an upheld report.**

Not a convention — the thing that makes the rest of this design possible. A
report is the _record of why something was done to a member_, and no moderation
action should exist without one. Reports come from two places:

- **A member files one.** Someone reports a suggestion, a listing, a profile, a
  conversation. Staff triage it and uphold or dismiss.
- **Staff file one.** A staffer who notices something themselves files a report
  and upholds it in the same action. It is not a fiction and not a workaround:
  staff saw something, wrote down what and why, and acted. That written reason is
  exactly what a report is for.

Dismissing never costs anyone anything. **Upholding is the only thing that
moderates**, whoever filed it, which keeps `resolveFlag` in
`src/lib/server/flag/flag-service.ts` as the single choke point it already nearly
is.

Two things fall out, and both are the point:

**Every moderation action is appealable, uniformly.** The appeal hangs off the
flag, and there is always a flag. No second mechanism for actions staff took on
their own initiative — which would otherwise be the category _least_ reviewed,
since no reporter and no triage was involved and one staffer decided alone.

**Every moderation action has a stated reason.** Today a staff-initiated
restriction can be recorded with `reason: null`. Requiring a report requires a
reason, in the one place a member will later be shown it.

This is a change to the system, not just an addition — see Schema delta.

## How it works

Sam posts a gig listing on the community calendar. Someone reports it, a staffer
reads the report and agrees, and two things happen: the listing comes off the
public guide, and Sam's next listing will wait for a staffer before it goes up.
Sam gets an email with the staffer's note in it.

Under the notice explaining what happened there is a button: **Appeal this
decision**. Sam writes a paragraph saying why they think the call was wrong, and
sends it. Nothing changes yet — the listing stays down and Sam stays on review
while this is looked at. Sam can see the appeal is pending, and cannot file a
second one about the same decision.

It works the same way when no member reported anything. If a staffer had noticed
the listing themselves, they would have filed their own report and upheld it on
the spot; Sam sees the same notice, the same reason, and the same button.

The appeal shows up on the staff report page, directly under the decision it is
contesting, so whoever picks it up reads the report, the staffer's note, and
Sam's objection in one place, top to bottom. The staff **Content Flags** nav item
grows a count of appeals waiting — it has never had one — so an appeal is not
sitting on somebody happening to look.

Whoever answers it cannot be the staffer who made the original call. That button
is switched off for them, with the reason written next to it. They _can_ undo
their own decision if they have changed their mind — they just cannot be the one
who confirms it was right. This matters most in the staff-filed case, where the
same person would otherwise file, uphold, and rule on the objection.

The answer is two questions, because they come apart. Does the listing go back
up? Does Sam come off review? A staffer might well conclude the listing did break
the rules but that a first offense does not warrant probation — so no to the
first and yes to the second. Whichever way it goes, it happens right there:
saying Sam comes off review _is_ taking Sam off review.

Sam gets an email with the answer and the reasoning. If it was a no, that is the
end of it as far as Sam is concerned. Staff can reopen the appeal later if
something new turns up, but Sam cannot keep filing.

```
        member files
  (none) ──────────────▶ pending ──staff decide──▶ decided
                            ▲                         │
                            └────staff reopen─────────┘
```

## Scope

**In:**

- A member-filed appeal against any **upheld** (`resolved`) `content_flag`
  affecting their own content or standing — member-reported or staff-filed alike.
- Two independent outcomes: the content and the standing, decided together in one
  form, applied immediately.
- One appeal per decision, enforced in the schema; reopenable by staff.
- A hard identity block: the staffer who resolved the flag cannot deny the
  appeal, though they may grant it.
- **Closing the flagless path**: `setStanding` requires a flag, and the staff
  standing form files one.

**Out (deliberately):**

- **Appealing a dismissed report.** Nothing was lost. The reporter has no
  standing to contest; their report was read and answered, which is all a report
  entitles anyone to.
- **Appealing account deactivation.** `deactivateUser` is not routed through
  reports and is not covered here. `CHORES.md` records that the app has no real
  ban — only deactivation, which doubles as the member's own self-delete — and
  that a proper ban has to answer re-registration, retention _and_ appeal in its
  own spec. Designing an appeal against a mechanism nobody has designed would
  produce a bad version of both. When that spec lands, it should route through
  reports and inherit this.
- **Restrictions that are not moderation.** Switching a feature off because of who
  a member is rather than what they did — the under-18 messaging case is the only
  one today — is not a moderation action and gets no appeal, because there is no
  judgement to contest. It also should not be a `member_standing` row at all;
  requiring a report is what makes that obvious. Recorded in `CHORES.md`, since
  the replacement does not exist yet.
- **A second-level appeal.** A denied appeal has been read by two people. A third
  is a committee, and the collective does not have one.
- **Changing what a report _does_.** The griefing tradeoff in
  `docs/specs/shipped/member-suggestions-spec.md` — one report hides a suggestion — is
  untouched. This feature is downstream of it.

## Decisions

### Closing the flagless path is part of this feature, not a prerequisite

`setStanding` (`src/lib/server/moderation/standing-service.ts`) takes `flagId` as
**optional** — "The upheld report, when a report is what caused this" — and
`setMemberStanding` in `src/lib/remote/standing.remote.ts` is a staff form that
uses exactly that: "Staff imposing a standing directly, without a report behind
it."

That path has to close, or the appeal has nothing to attach to precisely where
oversight is thinnest. So this feature makes `flagId` required and reroutes the
staff form through a filed-and-upheld report.

The worked example in that docstring turns out to argue for closing it rather
than against: switching messaging off for an under-18 member, "since the site has
no age of its own."

**That is not a moderation action and should never have been a standing.** Nobody
misbehaved. It is an eligibility restriction — a fact about who the member is,
not a judgement about what they did — and the two must not share a mechanism.
Filing a report about someone's age would be a category error, and once appeals
exist it becomes a visible one: the member would be told they had been moderated,
shown a report, and offered an appeal against their own date of birth.

So this feature does not accommodate that case; it evicts it. Requiring a report
on every `member_standing` write is exactly the pressure that surfaces it, and
the eviction is the point rather than a cost. The replacement — some notion of
member eligibility or capability that is not moderation — is out of scope here
and recorded in `CHORES.md`. The root gap is that `user` carries no date of birth
at all, so "this member is a minor" has nowhere to live but a restriction.

Until that lands, staff switching messaging off for a minor will file a report
like any other. That is worse than a proper eligibility field and better than
`reason: null`, and it is deliberately uncomfortable: the friction is the signal
that the case is in the wrong home.

Note this does not cost the `disabled` rung its purpose. `disabled` has a genuine
moderation use — the escalation past `restricted`, which for messaging is
reply-only — and `direct-service.ts` gates both sending and receiving on it. It
is the age case that is the wrong occupant, not the rung.

### The appeal hangs off the flag, not off a message thread

`IDEAS.md` proposed attaching an appeal to the upheld flag rather than opening a
new inbox thread. With every moderation action now report-sourced, the flag is a
complete anchor rather than a partial one, and the alternative loses on its own
terms.

Reusing `src/lib/server/inbox/` is genuinely tempting. Threading, staff
assignment, unread counts, notification plumbing and a member-facing UI all
already exist; the appeal would be `startPortalConversation` with a link pasted
in, and the schema delta would be near zero.

It fails on the thing this feature exists to fix. **A thread has no outcome
state.** Nothing on a conversation can mean "granted", nothing can be queried to
find appeals nobody has answered, and — decisively — nothing can _cause_ the
standing restore. The remedy would still be a button on `/staff/users/[id]` that
somebody has to navigate to and remember to press once the conversation ends,
which is precisely the failure `IDEAS.md` names as the reason to build this.
Reusing the inbox would produce a nicer-looking version of the status quo.

Two smaller strikes. The inbox is behind the `staffInbox` feature flag, so
appeals would inherit a kill switch that has nothing to do with them. And
splitting the record from the decision means a staffer reads the objection in one
place and the report it objects to in another.

A polymorphic `(actionType, actionId)` target was also considered — appeal points
at a standing row, or a suggestion, or an event. It is strictly more general and
buys nothing once every action is report-sourced, while costing a per-type
resolver and a second discriminator in a codebase that already carries one on
`content_flag`.

What is lost by not using the inbox is **back-and-forth**. An appeal is one
statement and one answer, with no way to ask a clarifying question inside it.
Accepted: staff can still message the member, and an appeal needing three rounds
is a conversation, not a form. If threading is ever needed, the appeal row is the
right place to hang a thread id.

### Two outcomes, decided separately

An upheld report can cost a member their post, their standing, or both, and staff
should be able to answer those separately. "The post did break the rules, but a
first offense doesn't warrant probation" is a coherent and probably common
conclusion, and a design that cannot express it forces a staffer into a decision
they do not believe.

`contentOutcome` and `standingOutcome` are therefore separate columns and neither
is derivable from the other. The member still writes one paragraph — making them
pick which consequence they are contesting would be asking for a legal theory
when their actual state of mind is "I think you got this wrong."

Content restoration is scoped by domain, and the two are **not symmetric**:

- A **suggestion** restores cleanly — `setVisibility('visible')` puts back exactly
  what was there, and its early-return on an unchanged visibility makes a re-run
  a no-op.
- A **community listing** comes back as a `draft`, so restoring means
  republishing. The service publishes **directly**, bypassing the standing-aware
  publish path. Otherwise the case these split outcomes exist for — content
  restored, standing upheld — would route the listing into the review queue
  instead of back onto the guide, and a staffer who just decided it should be
  public would have to approve it a second time. Safe and narrow: a staffer has
  looked at this specific listing and said it should be public, which is more
  scrutiny than the queue applies. Standing still governs the member's _next_
  listing, which is what standing is for.

The listing's **poster survives** a takedown now — `unpublishWithNotice` rotates
the object to a withheld key rather than deleting it (`fd07e76`) — so a granted
content appeal restores the artwork with the listing. Before that fix it could
not, which was half the reason an earlier draft of this spec kept content out of
scope entirely.

### The staffer who made the call cannot ratify it — but may overturn it

`admin` and `staff` are the same authorization everywhere in this app
(`docs/specs/admin-vs-staff-spec.md`), so "a second staffer" cannot be a role
check. It is an **identity** check against `contentFlag.resolvedByUserId`.

A hard block with no override raises the obvious objection: with a small
volunteer staff, the only person around may be the one who made the call. The
answer is an asymmetry rather than an escape hatch.

**You may overturn yourself. You may not ratify yourself.**

The original resolver may grant an appeal, fully or partly, and may not deny one.
"I've thought about it and I was wrong" needs no second opinion; it costs the
collective nothing and the member benefits immediately. "I've thought about it
and I was right" is the judgement that needs somebody else, because it is the one
where the reviewer's interest and the member's diverge.

This matters more now than it did when appeals only covered member-reported
actions. In the staff-filed case the same person would otherwise file the report,
uphold it, and rule on the objection to it — three roles, one desk. The rule
splits the last one off.

The deadlock only ever blocks the outcome the member has no reason to want
faster. An appeal that deserves granting can always be granted by whoever is
around. One that deserves denial waits for a second staffer, and while it waits
nothing about the member's situation is worse than before they filed, because
nothing pauses. A denial arriving late is a denial arriving late.

Rejected: a soft warning any staffer may click through — it puts the rule on
norms, and norms are what this replaces. Also rejected: an ageing escalation that
notifies everyone after N days; at this size that notifies the person already
blocked.

One edge, recorded because the FK makes it: `contentFlag.resolvedByUserId` is
`onDelete: 'set null'`. If the resolving staffer's account is deleted the
comparison never matches and any staffer may decide. Correct — the rule guards
against self-review, and there is no self left to review.

### Nothing pauses while an appeal is pending

The post stays down. The member stays restricted. Filing changes nothing until it
is decided.

The alternative — lifting the consequence for the duration — is kinder and is an
exploit. It hands anyone restricted a way to un-restrict themselves for as long
as the queue is slow, by objecting. The worse staff are at keeping up the better
it works, which is exactly backwards. Restoring _content_ while pending is worse
still: a report upheld against genuinely bad content would be undone by its
author objecting, inverting the decision on the say-so of the person it was made
about.

The cost is bounded. A member on `restricted` standing is not silenced — they can
still post, their posts queue. Waiting costs them the delay between writing and
publishing, not the ability to participate. That is what makes "nothing pauses"
tolerable, and it is the same property that makes the reviewer deadlock
survivable.

### One appeal per decision, reopenable by staff

`uniqueIndex(flagId)` on `moderation_appeal`. Re-filing is a database error
rather than a policy the service has to remember.

A denial is final from the member's side. That is the benefit of the constraint —
an appeal queue where a determined member re-argues a decision already reviewed
twice is a way to spend unlimited staff attention, and the members most likely to
do it are the ones the system is already straining against.

But "final" should be a policy staff hold, not a wall the code builds. Staff can
**reopen**, which clears the decision and returns the row to pending. New
information does turn up, and a member wrongly moderated and denied on a
misunderstanding should not have their only remaining route be a message thread —
that is the failure this exists to fix, and reintroducing it at the point of
highest stakes would be perverse.

Reopening reuses the row, so the unique index holds and the history stays in one
place. It is a staff action with no member-facing trigger: a member cannot
request a reopen, which keeps "one appeal" honest.

### The unique index is the abuse control; the rate limit is a velocity backstop

**The volume is structurally bounded.** An appeal requires an upheld flag against
the member, and each flag admits exactly one appeal. A member cannot generate
appeals; they can only spend the ones moderation has handed them. The ceiling is
the number of times staff have upheld something against them — a number staff
control, and small for exactly the members who would abuse it.

On top of that, `allowRateLimited` (`src/lib/server/rate-limit.ts`) at
5/hour/member on the file path, matching `flagSuggestion`. A velocity backstop
against a script, not the cap. KV is eventually consistent, so it is a soft
throttle — its docstring says to pair it with a stronger gate on public
endpoints, and this endpoint is not public: filing requires an authenticated
member, an upheld flag, and ownership.

**No cap on open appeals.** An earlier draft had one, copied from
`MAX_OPEN_PORTAL_THREADS`. That cap protects a genuinely scarce resource — an
open portal thread is an unbounded conversation demanding ongoing attention. An
appeal is one paragraph and one decision. Same reasoning
`docs/specs/shipped/community-events-spec.md` used to reject a total listing cap, landing
the same way: the only person a cap reliably stops is the member with several
legitimate grievances.

### Standing is already merged; this consumes it

An earlier draft of this spec argued at length for keeping the standing tables
separate behind a facade, on the grounds that appeals adds no standing of its own
so the rule-of-three trigger had not fired. That is obsolete. It fired
independently when direct messages added a third table, and the merge landed in
`0e8a718` (`docs/specs/shipped/member-standing-spec.md`).

What this feature consumes, unchanged:

- **`member_standing`** keyed `(userId, scope)`, scopes `community_event` /
  `suggestion` / `messaging` in `src/lib/config.ts`.
- **`restoreStanding({ userId, scope, staffId })`** — exactly the call a granted
  appeal makes.
- **`scopeForFlag`** — the single place a flag maps to a scope, and not the
  identity function: an `event` flag costs standing only when
  `event.source === 'community'`.
- **`standingScopeConfig`** — which rungs each scope may hold. Only messaging has
  a use for `disabled`.

One property of that merge is load-bearing here: **self-service lives outside the
standing table.** A member switching their own messages off writes
`user.acceptsDirectMessages`; `setStanding` has no argument shape that expresses
a member changing their own standing. So `member_standing` is purely enforcement,
and an appeal can treat every row in it as something done _to_ the member. If
preference and enforcement shared a column, an appeal against a self-imposed
setting would be a reachable absurdity.

### Ordering, with no transactions

D1 has no transactions and `custom/no-db-transaction` is an eslint error, so
granting — which touches standing, content, and the appeal row — needs an
ordering where a crash leaves an obvious, re-runnable state. The house pattern is
the merge algorithm in `suggestion-service.ts`: **do the effects first, mark the
record last.**

```
1. restoreStanding(...)      if standingOutcome === 'restored'
2. restore the content       if contentOutcome === 'restored'
3. stamp the appeal decided  decidedAt / decidedBy / outcomes / notes
```

Both restores are idempotent — `restoreStanding` writes a known status rather
than reading and modifying, and `setVisibility` early-returns on an unchanged
value. So a crash between any two steps leaves an appeal still reading
**pending** with the remedy partly delivered: visible in the queue, repaired by
clicking Grant again.

The reverse order must not be written. It would leave an appeal displaying
**granted** over a member still restricted — a state that looks finished,
notifies nobody, and is discovered only when the member writes in to ask why
nothing changed. That is the exact failure this feature removes, so
reintroducing it as a crash artifact would be a particularly bad joke.

### `decidedAt IS NULL` is the pending predicate

No `status` column. Pending is `decidedAt IS NULL` — one predicate, hard to get
wrong, in the spirit of the suggestion board's `eq(visibility, 'visible')`. The
label a human reads (Granted / Partly granted / Denied) is **derived** from the
two outcome columns, never stored, following the `merged` precedent in
`member-suggestions-spec.md`: a stored label is a third copy of a fact two
columns already carry, and all it can do is disagree with them.

Reopening is `decidedAt = NULL` plus clearing the outcomes, which returns the row
to the queue by the same predicate that put it there. No `reopened` state,
because nothing behaves differently about a reopened appeal — it is pending.

## Schema delta

`src/lib/server/db/schema/moderation.ts` — **`moderation_appeal`** (new):

| column                     | notes                                                                                    |
| -------------------------- | ---------------------------------------------------------------------------------------- |
| `id`                       | uuid pk                                                                                  |
| `flagId` → `content_flag`  | **`uniqueIndex`** — one appeal per decision, enforced by the database                    |
| `appellantUserId` → `user` | `set null`, matching `contentFlag.reportedByUserId` — a deleted account keeps the record |
| `body`                     | the member's argument, `APPEAL_BODY_MAX`                                                 |
| `contentOutcome`           | `restored` / `upheld` / `not_applicable`; null while pending                             |
| `standingOutcome`          | `restored` / `upheld` / `not_applicable`; null while pending                             |
| `decisionNotes`            | the staffer's reasoning, shown to the member                                             |
| `decidedByUserId` → `user` | `set null`                                                                               |
| `decidedAt`                | **null ⟺ pending**                                                                       |
| `createdAt`                |                                                                                          |

Indexed on `decidedAt` (the queue), `appellantUserId` (the member's own view),
and the unique `flagId`. No `scope` column — `scopeForFlag` answers that from the
flag, and storing it would be a second copy that can disagree.

Both outcomes carry `not_applicable` because an upheld report does not always
cost both: an event flag only unpublishes when staff tick `unpublishEvent`, and a
`member_profile` flag costs neither. The service writes that value by checking
actual state at decision time — it is not a choice the form offers, because a
staffer should not be able to record "we upheld the takedown" where no takedown
happened.

**`content_flag` gains `origin`** — `['report', 'staff_action']`, defaulting to
`'report'` so existing rows are correct. It separates "a member reported this"
from "a staffer acted and recorded why", which the queue needs (a staff action is
filed already-resolved and must not appear as pending work, or re-notify staff)
and the member-facing copy needs ("someone reported your listing" is wrong when
nobody did).

**`setStanding` requires `flagId`.** The optional parameter becomes required, and
`setMemberStanding` files a `staff_action` flag, resolves it, and passes its id.
This is the change that makes the anchor total.

Migrations are generated by the maintainer with `pnpm db:generate`.

Notifications — `src/lib/server/db/schema/notification.ts`:

- **`moderation_appeal_filed`** (staff) — in-app only, the
  `community_event_submitted` reasoning: a queue item, not news.
- **`moderation_appeal_decided`** (member) — email + in-app, the
  `suggestion_moderated` reasoning: the member asked a question and is waiting,
  and silence reads as being ignored. The notes ride in the body as a quote,
  since a decision without a reason is the thing members write in about.

## Permissions

| Who                   | Can                                                                             |
| --------------------- | ------------------------------------------------------------------------------- |
| Signed out            | Nothing                                                                         |
| Any member            | File one appeal per upheld flag against **their own** content or standing       |
| Staff / admin         | Read the queue; decide any appeal they did not resolve; reopen a decided appeal |
| The resolving staffer | Everything above, **except denying** the appeal against their own resolution    |

Every handler in `src/lib/remote/appeals.remote.ts` opens with `requireUser()` or
`requireStaff()`. Remote functions bypass route and layout loads, so these are the
only guard.

**The member never passes a flag id.** Filing is keyed to the thing they are
looking at — this suggestion, this listing, this standing card — and the service
resolves the upheld flag itself after confirming the member owns the content or
the standing. Nothing to enumerate, because there is no id to guess. Appealing
someone else's decision 404s rather than 403s: a 403 confirms it exists.

The identity block is enforced in the **service**, not the UI. The staff page
disables deny and says why, but a hand-rolled request from the resolving staffer
is rejected by `decideAppeal` with a message naming the rule. The UI state is a
courtesy; the service is the rule.

## Surfaces

**No new routes.** An appeal is a small object attached to a decision, and both
sides already have a page where that decision is explained.

| Route                        | What changes                                                                                       |
| ---------------------------- | -------------------------------------------------------------------------------------------------- |
| `/member/suggestions/[id]`   | The withheld/hidden `Alert` gains **Appeal this decision**, then pending state and outcome         |
| `/member/events/[id]/manage` | Same, on the takedown notice that already renders `reviewNotes`                                    |
| `/member/suggestions`        | The standing banner gains the same, for the standing half                                          |
| `/member/events`             | Same, on the standing banner there                                                                 |
| `/member/account`            | The messaging standing notice gains it — the scope with no content page of its own                 |
| `/staff/flags/[id]`          | The appeal renders beside the Resolution card: the member's argument, then the decide form         |
| `/staff/flags`               | An **Appealed** filter, and a **new** badge on the Content Flags nav item counting pending appeals |
| `/staff/users/[id]`          | The standing cards show "appeal pending" where one is open, linking to the flag                    |
| `/staff/users/[id]`          | `setMemberStanding` grows a required reason — it is filing a report now, and a report needs one    |

The member-side placement follows the two outcomes: the content pages carry the
appeal for a takedown, the standing banners for a restriction, and both reach the
same appeal because both consequences came from one upheld report. Whichever
surface a member happens to be looking at, the button is there.

A dedicated `/staff/appeals` was considered and rejected. The suggestion board
argued for a list-plus-detail pair because its notification needed a stable `href`
and a merged post needed a landing page. Neither applies: the appeal's stable href
is `/staff/flags/[id]`, and putting it anywhere else would undo the reason for
attaching it to the flag.

The nav badge is new — `Nav.Item href="/staff/flags"` carries none today, unlike
Suggestions with `layout.suggestionsAwaiting`. It counts _pending appeals_, not
pending flags: an unresolved report is work staff chose the pace of, an appeal is
somebody waiting on an answer they were promised.

All controls are `form()`-backed and driven by `<Form>` / `<Action>` per
`docs/development/ui-patterns.md`; filing is a form modal.

## Dev testing

`scripts/seed-dev.ts` should leave every state reachable without clicking through
a moderation flow first:

- an **upheld suggestion flag with a pending appeal**, so the decide form has
  something in it on a fresh seed
- an **upheld community-listing flag with a pending appeal** where the listing was
  _not_ unpublished, so `contentOutcome: not_applicable` renders
- a **`staff_action` flag** with a pending appeal — the path with no reporter,
  where the filing staffer is also the resolver and so cannot deny
- a **partly granted** appeal (standing restored, takedown upheld) — the outcome a
  naive implementation collapses, so it should be visible at a glance
- a **denied** appeal, so the member-side terminal state renders

Then, by hand:

1. Report another member's suggestion, uphold it, confirm the author is on review
   with the suggestion hidden.
2. As that member, appeal; confirm the suggestion stays hidden and the banner
   still says on review — **nothing pauses** is the property most likely to be
   quietly broken.
3. Confirm a second appeal against the same decision is refused.
4. As the staffer who upheld it, confirm deny is disabled with the reason shown,
   and that **grant still works**.
5. Restrict a member's messaging from `/staff/users/[id]` with no member report
   involved. Confirm a `staff_action` flag was created and resolved, that the
   member sees the reason, and that they can appeal it.
6. As a different staffer, deny one; confirm the member's email carries the notes.
7. Grant one with standing restored and content upheld; confirm `/staff/users/[id]`
   shows the member restored while the post stays down, with nobody having touched
   the Restore button — the automatic restore is the whole reason this exists.
8. Grant a listing's content half and confirm it returns to the **public guide**
   rather than the review queue, **with its poster**.
9. Reopen a denied appeal and confirm it returns to the queue.

Service tests in `appeal-service.spec.ts`, in the register of
`flag-service.spec.ts` — that file is the executable form of the moderation rules
and this is its counterpart: filing requires ownership; the unique index refuses a
second appeal; granting calls `restoreStanding` for the scope `scopeForFlag`
returns; the resolving staffer is refused a denial and permitted a grant; a
deleted resolver frees the appeal; a content grant publishes directly rather than
through the standing-aware path; and the effects-before-stamp ordering holds.

`standing-service.spec.ts` gains the inverse assertion: `setStanding` **rejects a
call with no `flagId`**. That test is the executable form of "every moderation
action is an upheld report", and it is the one that stops the flagless path
growing back.
