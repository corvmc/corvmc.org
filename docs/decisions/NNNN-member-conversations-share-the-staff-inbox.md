# NNNN Member conversations share the staff inbox

- **Date:** 2026-08-12
- **Status:** Accepted

## Context

A signed-in member could reach staff only through the public contact form, which drops the fact
that they are signed in, or by plain email. The staff inbox already modelled a conversation as a
thread, messages and internal notes, with assignment, snooze and resolve. A member conversation
has the same shape. Member-to-member messages were expected next.

## Decision

Member conversations are channels on `inbox_thread` and `inbox_message`, not a parallel system.
Built for staff in #204 and for members in #213.

1. `portal` is a channel, always enabled, like `web`. Staff answer from `/staff/inbox`.
2. Identity is a table, `inbox_participant`, not columns on the thread. A portal thread has one
   participant row; a direct message has two, with no schema change.
3. The stored message row is the delivery. `dispatchReply` sends nothing for `portal`, and the
   member is told through the notification path.
4. Member-facing reads live in their own services (`portal-service.ts`, `direct-service.ts`),
   with ownership in the `WHERE` clause and no read of `inbox_note`.
5. `ThreadTimeline` orients on author identity when given `viewerUserId`, and on direction
   otherwise. The staff inbox needs a colleague's reply to read as ours; a member needs a staff
   reply on the other side.
6. A resolved portal thread is final for the member; their next question opens a new thread.

## Alternatives rejected

- **A separate member messaging feature.** Staff would work two queues.
- **Reusing `getThread()` for members.** It returns staff-only notes.
- **Live push.** The SSE registry is per isolate on Workers; the notification bell covers a
  reply that arrives while the page is open.

## Consequences

- Every staff-side read must exclude conversations staff are not party to. That is
  `staffVisibleThread` and `PRIVATE_CHANNELS` today.
- A change to `ThreadTimeline` has to keep both orientation modes;
  `ThreadTimeline.svelte.spec.ts` pins them against each other.
