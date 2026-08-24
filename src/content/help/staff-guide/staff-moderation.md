---
title: Moderation — Flags and Suggestions
slug: staff-moderation
category: staff-guide
summary: Working the report queue, deciding what an upheld report costs, and running the suggestion board.
minRole: staff
sortOrder: 18
---

## Two queues under Moderation

**Content Flags** is reports members have filed — on a profile, a band, an event
listing, a suggestion, or a conversation. **Suggestions** is the member idea
board and its review work. Both carry a count in the sidebar.

## The flag queue

**Moderation → Content Flags** opens on pending reports. Each row is one report:
what was reported, who reported it, the reason they gave, and when.

Open one and you get the reported thing alongside the report, so you are reading
the actual listing or profile rather than a description of it. A reported
conversation is readable here and only here — filing the report is what made it
readable, and it exposes only the thread the reporter was in.

Two outcomes:

- **Dismiss** — nothing happens to anyone. Dismissing costs the reported member
  nothing at all, so it is the right answer whenever you are unsure.
- **Uphold** — the report stands. This is the only action that moderates
  anything, and everything below follows from it.

Leave a note either way. It is what the next staffer reads when the same name
comes up again.

For an event listing, upholding offers to **unpublish** it in the same step. Do
that rather than deleting: an unpublished listing is editable, so the member can
fix it and put it back, and the record of what happened survives.

## Deciding what an upheld report costs

The post and the person are separate decisions, and you make both.

Taking the post down does not have to mean restricting the member. A first
offense that was plainly a misunderstanding is a takedown and nothing else.

When you do restrict someone, it is **scoped to the area it happened in** —
event listings, suggestions, or messaging. An upheld report about a gig listing
puts their listings through review; it does not touch their suggestions and it
does not touch their messages. Resist the urge to restrict everything: the scope
is the whole reason there is one table and not one flag on the user.

| Scope              | Restricted                                  | Off entirely  |
| ------------------ | ------------------------------------------- | ------------- |
| **Event listings** | Listings go to review before publishing     | Not available |
| **Suggestions**    | Posts go to review before appearing         | Not available |
| **Messaging**      | Reply-only — cannot start new conversations | Available     |

Standing lives on the member's record — **Users → the member → Moderation** —
where you can also see every report for and against them. Restore from the same
place, and restore promptly once the conversation has moved on; nothing sweeps
these up for you.

Lifting a restriction is recorded rather than erased. Someone who was restricted
and then cleared still reads differently from someone it never came up for,
which is what you want the next time you are asked.

## The suggestion board

**Moderation → Suggestions** shows the board sorted by votes — which is the
board's whole output, so read it that way rather than by date.

What there is to do:

- **Respond and set a status** — Open, Planned, In progress, Done, Declined. The
  response is public. Decline with a reason rather than leaving something Open
  forever; an honest no is more useful to members than silence.
- **Review pending posts** — from members whose standing puts them through
  review. Approve onto the board or take it down.
- **Review pending edits** — an author editing a post that other people have
  already voted on. Check the edit is a clarification and not a different idea
  wearing the same votes.
- **Merge duplicates** — votes transfer and dedupe per member, and the merged
  post points at the survivor. Merge freely; nobody loses anything.

A reported suggestion is off the board while it waits, so this queue is time
sensitive in a way the flag queue is not — an unanswered report is a post nobody
can see.

## A note on staff-initiated action

Restricting a member without a report behind it is the least reviewed thing in
here: no reporter, no triage, one staffer deciding alone. Write the reason as if
somebody will ask you to justify it, because at some point somebody will.

There is a design for making every moderation action an appealable, filed report
— `docs/specs/moderation-appeals-spec.md` — but it is not built, so today the
discipline is yours.

## Related

- [The staff dashboard](/member/help/staff-dashboard)
- [Editing a member](/member/help/staff-edit-user)
- [Handling the inbox](/member/help/staff-inbox)
