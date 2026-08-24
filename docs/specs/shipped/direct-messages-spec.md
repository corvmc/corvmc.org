# Direct Messages — member↔member

Members can message each other from the site. The point is the directory:
someone looking for a bassist should be able to reach the bassist whose profile
they just read, without needing an email address or an Instagram handle.

Status: **implemented**.

This is the feature `member-portal-chat-spec.md` left a door open for. The
transport was already there — `inbox_participant` scales from one signed-in
party to two — so almost all of the work here is the safety layer.

## How it works

**Starting one.** Alice finds Bob in the member directory and clicks Message.
She writes one message and sends it.

**Receiving one.** It appears in Bob's Messages list alongside his other
conversations, marked as a request. He gets a bell notification and a short
email — "you have a new message request", naming neither Alice nor what she
wrote. It does not add to his unread count.

Opening it shows who it is from and the full message, with three actions:
**Accept**, **Decline**, **Report**.

Showing him the message is what makes the decision possible. A name alone tells
him nothing — he will not recognise most members — so he would accept everything
or decline everything, and either wastes the feature. It is also what makes
Report meaningful: a bad first message is exactly what that button is for, and
you can only report what you can see. Nothing is pushed at him — the message
sits behind a deliberate click and never reaches his email.

**Accepting** makes it an ordinary conversation. **Declining** closes it and
blocks Alice, and **Alice is never told which happened.** From her side a
declined request and one Bob has not opened look identical, and she cannot send
a second message either way. That is the core of the design: saying no costs Bob
nothing socially, which matters in a small scene where these people run into
each other at shows.

**A request is exactly one message** until accepted. Not one message and then a
nag, not one a day — one. Alice may have five requests outstanding at a time and
may start five conversations a day.

## Model

No new thread or message tables. One column:

```
inbox_participant.accepted_at   -- null on the recipient of an unaccepted request
```

The initiator's row is stamped at creation; the recipient's stays null until
they accept. That asymmetry _is_ the request mechanism. Declining sets the
thread to `resolved`, the existing status that already means "final, read-only",
so there is no new thread state either.

Two new tables in `schema/moderation.ts`:

```
user_block          blocker_user_id, blocked_user_id, source, created_at
messaging_standing  user_id, status, source, reason, triggering_flag_id, …
```

`messaging_standing` is one switch per member covering all three ways it gets
thrown: `restricted` after staff uphold a report (reply yes, initiate no),
`disabled` by staff (how we handle the occasional under-18 member — the site has
no age of its own), and `disabled` by the member themselves. `source` decides
who may change it: a member may lift their own, never one staff or a report put
there. Absence of a row means no restriction, and lifting sets `'none'` rather
than deleting, so "we looked at this and cleared it" still reads differently
from "this never came up" — the same idiom as `communityEventStanding`.

**Superseded.** This table was the third domain to need standing, which fired the
rule-of-three note in `member-suggestions-spec.md`; all three are now one
`member_standing` keyed `(userId, scope)`. Two things above changed with it, and
`docs/specs/shipped/member-standing-spec.md` has the reasoning:

- **`source` is gone.** It existed only because this one table held both a
  moderation decision and a member preference. Those split: the two staff/report
  cases stay as standing at scope `messaging`, and "switched off by the member
  themselves" became `user.acceptsDirectMessages`, a directory-profile preference
  they own outright. `MessagingStandingNotYoursError` is deleted rather than
  renamed — a member has no way to write standing at all now, so there is no
  guard to forget.
- **A restricted member can now set their own preference**, which the `source`
  check used to prevent. It cannot lift the restriction; they write different
  tables.
- **Four read filters were left behind, and broke the feature outright.**
  `direct-service.ts` names `messaging_standing` in hand-written SQL in four
  places, and dropping the table took `/member/messages` down for every member —
  staff threads included — because `listMemberConversations` is one of them.
  Nothing caught it: the service specs mock `db` wholesale and assert on captured
  fragments they never execute. Two consequences worth keeping:
  - The port is not a rename. The old table held **both** halves of "cannot be
    reached"; the split means each site now checks standing at scope `messaging`
    **or** `user.acceptsDirectMessages`, exactly as `messagingIsDisabled` does.
    Checking standing alone silently stops honouring the member's own switch.
  - The tables are now interpolated into those fragments rather than spelled
    out, so the next such migration fails the build. `db/raw-sql-tables.spec.ts`
    scans every remaining `sql` template for table names the schema does not
    declare.

`messagingIsDisabled` is where the two halves recombine, and it returns one
boolean on purpose: a sender must not be able to tell a staff decision from a
personal choice.

### direction gets a third value

`inbox_message.direction` means "which way relative to CorvMC". A DM is neither
inbound nor outbound — nobody wrote to us and we sent nothing — so DMs are
`'peer'`.

This is not cosmetic. `addOutboundMessage` builds its email `References` chain
by querying `direction = 'inbound'`, and any future "how fast does staff reply?"
report would count the same rows. With `'peer'`, both exclude DMs because the
data says so rather than because someone remembered a channel filter.

## Enforcement

`src/lib/server/inbox/direct-service.ts` is the boundary — a sibling of
`portal-service.ts`, not an extension of it. Two reasons, and the second is the
one that matters: portal hard-codes `channel = 'portal'` in all six of its
queries (which is why a DM cannot leak through the member↔staff pages), and
**DMs need the opposite of one of portal's rules.** `getPortalThread` hides the
other party's user id because a member has no business learning staff ids; in a
DM, knowing who you are talking to is the whole feature. One file cannot hold
both without making the rule conditional, and conditional rules rot.

The file adds a third rule to portal's two: _WHERE clause for anything that
selects a row that already exists; a plain `if` only for preconditions on
creating one._ Blocks, standing and rate limits are preconditions on a write, so
those three are `if`s. Everything else is SQL.

### Silent drops all return the same value

Blocked, self-addressed, recipient deactivated, recipient hidden from the
directory, recipient with messaging off — every one returns `{ status: 'sent' }`
and writes nothing. A sender who can tell those apart can tell a decline from an
unopened request, and the consent model rests on them not being able to.

`direct-service.spec.ts` asserts these are `toEqual` **each other**, not each to
a literal, so a future "let's give a helpful error message here" change has to
notice it is breaking something deliberate.

The one branch that does report back is the sender's own standing: they are
entitled to know they cannot start conversations, and to read the staff note
saying why.

**The recipient picker obeys the same rule.** `searchDirectoryMembers` reuses
the directory's own visibility predicate, so it can only offer members the
sender could already browse — it widens nothing. It deliberately does **not**
filter on `acceptsDirectMessages` and does not mark who accepts: hiding or
greying out the unreachable would hand the sender precisely the signal the
silent drops exist to withhold. The composer is allowed to offer someone
unreachable, and the send is then dropped like any other.

### Blocking

Checked when sending, replying and accepting — never when reading. Blocking ends
a conversation but must not delete it: the person who blocked still needs the
messages if they later decide to report. `blockUser` also closes the thread, but
that is so the message box disappears, not the thing stopping them writing — the
`NOT EXISTS` in the reply query is. Both parties blocking is two rows; every
check reads both directions, so extras change nothing and one person unblocking
does not undo the other's.

### Rate limits

`allowRateLimited` returns _before_ it writes, so a rejected attempt does not
push the window out — it means "N allowed per window, counted from the last
allowed one". Someone hammering the button does not extend their own lockout.

KV is only roughly accurate, so it is the backstop. The limits that actually
hold are counted in the database and clear themselves:

- `MAX_PENDING_SENT_REQUESTS` — you cannot have more than five people ignoring
  you at once. Falls as recipients accept or decline.
- `MAX_UNRESOLVED_REPORTS` — you cannot have more than five reports waiting in
  the staff queue. Better than a daily quota because reporting auto-blocks:
  someone having a genuinely bad week can report again as soon as staff clear
  the backlog, while someone burying the queue stops until staff look.

The most important protection is neither: a request is one message until
accepted, enforced in SQL.

## Staff visibility

**Staff see nothing until someone reports.** Private conversations are absent
from the staff inbox, from its counts and from its search, and cannot be opened
by URL.

Three pre-existing leaks had to be closed before any of this could ship, which
is why they landed first:

1. **`getThread()` did not check who was asking** — it took a thread id and
   returned messages _and_ staff-only notes with no ownership join, backing
   three staff endpoints. It now refuses `direct` outright, before fetching
   anything.
2. **`inbox.message_received` had no channel gate** — it notified every staff
   member and put the first 200 characters of the message in the notification.
   Its sibling `message_sent` listener _did_ check the channel, which is exactly
   what made this easy to miss.
3. **The aggregate counts read every thread** — `getUnresolvedCount` and
   `countThreadsByStatus` would have put live DMs in the staff badge, and
   `listThreads`' search `LIKE`s `preview`, which for a DM is private text.

A fourth appeared while this was in review: `listThreadsByContactEmail`, added
by the staff-user-page rework, reads threads by a denormalised address and
selects `preview`. It happens to be safe — a direct thread has no
`contactEmail`, so the equality never matches — but that is an accident of what
we store rather than a rule, and it would break silently the day anyone
denormalises an address onto a direct thread. It carries the predicate too.

All four now use one exported predicate:

```ts
staffVisibleThread = or(channel != 'direct', EXISTS pending inbox_thread flag)
```

pushed into `listThreads`' conditions **unconditionally, before any filter
branch**, so it cannot end up behind an `if`.

A reported conversation is read through `getFlaggedDirectThread`, which is
**keyed on the flag, not the thread**. Staff have no way to name a DM and ask
for it; the report is the only handle. There is no condition on the flag's
status, so a resolved report stays re-readable for appeals and repeat offenders
— the flag row is still the key, so that does not widen who can reach anything.

## Reporting

The existing content-flag system, unchanged: same table, same `/staff/flags`
queue, same resolve flow. `'inbox_thread'` is a new `entityType`.

What is new is one remote, `reportDirectThread`, which exists instead of
widening `submitFlag` because a conversation report has two requirements the
shared path must not inherit. `submitFlag` takes its entity type and id straight
from the browser and checks nothing about the reporter — fine for a public
profile, and catastrophic for a private conversation, since filing the report is
what makes it readable. `submitFlag` is now narrowed to
`memberReportableEntityTypes`, which deliberately excludes conversations.

Report does everything Decline does — same block, same closed thread — plus
files the flag. It works on a **pending request** as well as an accepted
conversation: `getDirectThread` carries no `acceptedAt` condition precisely so
that Report can sit beside Accept and Decline.

Three arms in `flag-service.ts` that fail loudly or leak if missed:

- `resolveEntityLabel` — its `default` does a `user` lookup, so without a case it
  returns null and `createFlag` throws: reporting a DM fails outright. Returns a
  content-free constant, **never the subject or preview**, since `listFlags`
  renders `entityLabel` in the queue and that would put private text in front of
  staff before anyone opened the report.
- `entityHref` — its `default` sends a thread id to `/staff/users/<id>`.
- `listFlags`' batched labels — without a bucket the queue shows `(deleted)`.

**Triage** renders the conversation inline. The report being open is what makes
reading appropriate, so there is nothing further to gate on. The timeline is
drawn from the reporter's point of view (`viewerUserId={flag.reportedByUserId}`)
— without it the fallback is the org's point of view, and neither member is the
org, so every bubble would land on the same side.

**Upholding** restricts the reported party: reply yes, initiate no. Dismissing
does nothing to standing, and does **not** un-block: staff deciding it was not a
violation is not staff deciding who a member has to talk to. Which standing an
upheld report costs is `scopeForFlag`'s single answer now, shared with listing
and suggestion reports.

## Notifications and email

| type                      | email | carries                          |
| ------------------------- | ----- | -------------------------------- |
| `direct_message_request`  | yes   | neither sender nor message       |
| `direct_message_received` | yes   | sender's name, never the message |
| `messaging_restricted`    | yes   | the staff note                   |

Both DM emails are a nudge: something is waiting, here is the link. The consent
line sits on the sender's **name** — a live conversation says "Robin sent you a
message", a request says "you have a new message request". Until you have
accepted, we do not put a stranger's name in your inbox.

Why the message itself stays out: decline, block and report only work on the
site, and none of them can reach an email that has already been sent. Keeping
the words on the site means every message can still be stopped. The asymmetry
with `portal_message_reply`, which _does_ quote the text, is the point rather
than an inconsistency — there the sender is CorvMC and the words are a staff
answer.

**Enforced in the email layer, not the listener.** "Remember not to pass the
message text" is a habit, and there are ~23 hand-built `emailTemplate.model`
literals to copy the wrong one from. `NotificationTypeDef` gains
`emailOmitsUserContent`; `dispatch` looks it up from the registry and
`normalizeNotificationModel` strips `quote`/`quote_text` — and `preview_text`,
which is derived from the body and would otherwise put the opening line in the
inbox preview pane. That is the same choke point that already escapes `quote`
"so it cannot be forgotten". `dispatcher.spec.ts` pins it against the
_dispatcher_, not a listener: a test checking one listener's literal would pass
again the moment someone added a quote back.

**Inbound email can never write into a DM.** `handlePostmarkInbound` routes a
signed reply back "whatever the thread's channel", and its own comment notes
that anyone a forwarded alert reaches can write into the thread. Sending no
reply address for DMs is not enough — that relies on the address never leaking —
so the handler rejects `channel === 'direct'` outright. A message filed that way
would land with a null `authorUserId`, which renders as "not yours" to _both_
participants.

## Surfaces

| Path                             | What                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/member/messages`               | The conversation list, in the left pane of a two-pane inbox (`InboxShell`, shared with `/staff/inbox`). Staff threads and member threads in one list, requests tagged. Both are participant-based, which is what made a single query possible. Compose offers **Message a Member** — a recipient picker over the directory roster — and **Message Staff**. |
| `/member/messages/[id]`          | The thread pane. Discriminated on kind; a pending request shows Accept / Decline / Report instead of a message box. Below `lg` it replaces the list, so its back button is the only way out.                                                                                                                                                               |
| `/member/directory/members/[id]` | Message button. Shown for anyone but yourself — deliberately _not_ hidden based on blocks or the recipient's switch, which would tell the sender what the silent drop is designed to withhold.                                                                                                                                                             |
| `/member/account`                | The member's own switch, any staff restriction, and the list of members they have blocked. Unblocking lives here because declining a request blocks the sender too — members accumulate blocks they never consciously chose.                                                                                                                               |
| `/staff/flags/[id]`              | Reported conversation, in full, from the reporter's point of view.                                                                                                                                                                                                                                                                                         |
| `/staff/inbox`                   | Unchanged. Direct threads never appear.                                                                                                                                                                                                                                                                                                                    |

## Deliberately not built

- **Platform bans.** Deactivation is the only lever and it is a poor one — see
  `CHORES.md`. The `restricted` → `disabled` ladder covers messaging harms;
  a real ban has to answer re-registration, retention and appeal.
- **An audit log of staff reads.** A DM is simply not surfaced until a report
  makes it appropriate to read. The `listThreads` exclusion and the flag-keyed
  lookup _are_ the protection; a read log would only be evidence of a boundary
  the WHERE clause already enforces.
- **Group conversations.** `inbox_participant` would take a third row, but
  every rule here is written for exactly two parties — blocks, the counterpart
  join, "the reported party is the one who is not the reporter".
