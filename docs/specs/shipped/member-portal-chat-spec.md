# Member Portal Chat

Members message CorvMC staff from inside the member portal. Threads land in the
existing unified staff inbox as a new channel; staff answer them with the tools
they already use.

Status: **implemented**.

## Why a channel rather than a new feature

Before this, a signed-in member's only way to reach staff was the public contact
form — which throws away the fact that they are signed in — or plain email. The
staff inbox already models a conversation as thread + messages + internal notes,
with assignment, snooze and resolve on top. A member conversation is that same
shape, so it is a channel (`portal`) instead of a parallel system. Staff get one
queue, not two.

`portal` joins `web` as an **always-enabled** channel: both deliver through the
site itself, so there is nothing to authenticate and nothing to switch off. See
`alwaysEnabledInboxChannels` in `src/lib/config.ts`.

## Model

`inbox_thread` is unchanged. Identity comes from a new table:

```
inbox_participant
  thread_id   → inbox_thread  (cascade)
  user_id     → user          (cascade)
  role        'member' | 'staff'
  last_read_at                 -- unread ⇔ thread.last_message_at > last_read_at
  UNIQUE (thread_id, user_id)
```

Threads on the outward channels (email, SMS, web, Instagram, Messenger) have no
participants — their contact has no account, and their identity is denormalized
onto the thread as `contact_name` / `contact_email` / `contact_phone` /
`contact_external_id`. A `portal` thread has exactly one participant: the member
who opened it.

This is a table rather than a pair of columns on the thread specifically so that
a conversation between two signed-in people needs no schema change. See
_Forward compatibility_.

### Threading

Each conversation has a subject and is addressed explicitly, so `portal` never
dedupes — `findOrCreateThread` treats it exactly like `web` and always inserts.
A member reply targets a thread by id. Folding a second conversation into an
open one would silently discard its subject.

**Resolve is final.** A resolved thread is read-only for the member; their next
question opens a new conversation. `replyToPortalThread` enforces this by
restricting writes to `open` and `snoozed` threads. A reply to a _snoozed_
thread reopens it — the member asking again should put it back in front of staff
rather than leaving it parked.

Volume is bounded by `MAX_OPEN_PORTAL_THREADS` (5 open or snoozed per member),
surfaced as a field error on the compose form.

## Delivery

There is no external system to send to: **the stored message row is the
delivery**. `dispatchReply` returns `null` for `portal` without calling Postmark,
Twilio or Meta — a portal reply must never also go out as a support email.

The member finds out through the normal notification path instead. A staff reply
emits `inbox.message_sent`; the listener in `register-listeners.ts` looks the
thread up, and dispatches `portal_message_reply` to each participant — in-app
plus (by default) email, both subject to the member's own preferences. Staff are
notified of an inbound portal message by the existing `inbox.message_received`
fan-out, which needed no changes.

## Permissions

Remote functions are the only guard in this app: SvelteKit dispatches a remote
call before any route load runs, so each endpoint is only as guarded as its own
first line. Two invariants hold across `src/lib/server/inbox/portal-service.ts`:

1. **Ownership lives in the WHERE clause**, via a join on `inbox_participant`.
   Never a post-hoc check on a returned row.
2. **Nothing there reads `inbox_note`.** Notes are staff-private. This is the
   reason the portal functions exist instead of reusing `getThread()`, which
   returns them. `portal-service.spec.ts` pins it.

`getPortalThread` also masks `author_user_id` to null for anyone but the caller,
so no staff user ids reach the client. The timeline only needs to know which
bubbles are the viewer's own.

Member→member is structurally impossible today: a portal thread has one
participant, and every outbound message is written behind `requireStaff()`.

## Timeline orientation

Both inboxes are the same two-pane shell — `InboxShell` mounted from each
`+layout.svelte`, so the list survives navigating between threads and every
`/…/[id]` URL still resolves. That matters most here: `/staff/inbox/[id]` is
deep-linked from notification emails, the in-app bell and the staff user record.

One consequence of the list living in the layout: `/staff/inbox`'s filter mirror
keeps running while a thread is open, so it writes onto the **current** pathname
rather than a hard-coded `/staff/inbox`. Pinned to the index it would navigate
straight back out of whatever you just opened; carrying the query onto the thread
URL is also what makes back return to the same filtered view.

`ThreadComposer` is shared by both sides. Its `noteForm` is optional — with no
note form it renders as a plain reply box, which is the member side, since
internal notes are staff-private.

`ThreadTimeline` serves two readers with opposite ideas of "mine", so it orients
on **author identity, not direction**:

- `viewerUserId` given → a bubble is the viewer's iff they wrote it, with **no
  direction fallback**. A message with no author id was written by someone else,
  which is what puts a staff reply on the left for the member reading it.
- `viewerUserId` omitted → sides follow `inbound`/`outbound`, i.e. the
  organisation's point of view. This is the staff inbox, where a colleague's
  outbound reply must still read as ours — and why the fallback cannot be
  author-based.

`ThreadTimeline.svelte.spec.ts` pins both modes against each other, because a
change that fixes one view by flipping the axis silently breaks the other.

## Surfaces

| Path                               | What                                                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `/member/messages`                 | The member's conversations, in the left pane of a two-pane inbox; unread dot, status, last activity. Compose is a modal. |
| `/member/messages/[id]`            | One conversation in the right pane; timeline + composer, or a closed notice when resolved. Opening it marks it read.     |
| `/staff/inbox`                     | The queue, in the left pane of the same shell. Portal threads appear as channel "Member Portal".                         |
| `/staff/inbox/[id]`                | The thread pane. Status and assignment sit in the header; the details card is a disclosure under it.                     |
| `/staff/settings` → Inbox Channels | Member Portal shown as Always On, with no toggle.                                                                        |

The member nav badge comes from `countPortalUnread` on `getMemberLayout()`. It
refreshes on the member's own mutations; live push is deliberately out of scope,
since the SSE registry is per-isolate on Workers. The existing notification bell
covers a reply arriving while the member is on the page.

## Forward compatibility — member↔member DMs

Not built. Recorded so the boundary exists before there is anything to leak.

**Already handled.** `inbox_participant` scales from one row to two with no
schema change. `inbox_message.author_user_id` is the real author identity and
the timeline orients off it, so a two-member thread renders correctly with no
component change. Notification dispatch already iterates participants.

**What a DM feature would add.** A `direct` channel value, participant rows for
both members, and member-side routing to start one. The staff-queue fields
(`assigned_to_user_id`, `snoozed_until`, `inbox_note`) simply stay null on those
rows.

**Visibility.** `listThreads()` has no ownership filter today because every
thread genuinely is staff's business. When `direct` lands that stops being true,
and the exclusion belongs in that function's `conditions` array — there is a
comment there marking it as the single enforcement point.

**Escalation on report.** `content_flag` is already polymorphic (`entity_type`
enum + `entity_id`, the same discriminator pattern as `reservation.booker_type`),
so surfacing a reported DM means adding `'inbox_thread'` to `flagEntityTypes` and
letting the `listThreads` exclusion carry an `OR EXISTS (pending flag)`. No new
table, and `/staff/flags/[id]` already exists to review it.
