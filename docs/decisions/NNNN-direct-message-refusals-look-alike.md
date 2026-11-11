# NNNN Direct message refusals look alike

- **Date:** 2026-08-16
- **Status:** Accepted

## Context

Direct messages (#213) let a member write to anyone they find in the member directory. The scene
is small, and members meet each other at shows. A refusal the sender can see is one recipients
hesitate to make.

## Decision

A first message is a request, and the sender never learns what happened to it.

1. A request is one message until the recipient accepts. The recipient sees the full message
   with Accept, Decline and Report.
2. Declining closes the thread and blocks the sender. Report does the same and files a flag.
3. A block, a decline, a self-address, a deactivated or hidden recipient, and messaging switched
   off all return the same `{ status: 'sent' }` and write nothing. `direct-service.spec.ts`
   asserts these results equal each other.
4. The one refusal reported back is the sender's own standing, with the staff reason.
5. The recipient picker does not mark who accepts messages, and the profile Message button is
   never hidden.
6. Emails never carry the message. A request email names neither sender nor content.
   `emailOmitsUserContent` enforces this in the email layer, not in each listener.
7. Staff see a conversation only once someone reports it, through the report itself.

## Alternatives rejected

- **A helpful error per refusal.** A sender who can tell them apart can tell a decline from an
  unopened request.
- **Showing the recipient only the sender's name.** They could not decide, and could not report a
  bad first message.
- **Quoting the message in email.** Decline, block and report cannot reach an email already sent.
- **An audit log of staff reads.** The flag-keyed read path already limits who can read a
  conversation.

## Consequences

- A sender may write to someone who will never receive it, and is not told.
- Members collect blocks they did not choose, so `/member/account` lists them with an unblock
  action.
- Database counts (`MAX_PENDING_SENT_REQUESTS`, `MAX_UNRESOLVED_REPORTS`) are the limits that
  hold; KV rate limits are a backstop.
