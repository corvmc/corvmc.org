# NNNN Band enquiries are threads the band owns

- **Date:** 2026-09-04
- **Status:** Accepted

## Context

The contact form on a band's public profile sent one email to the press kit's booking address
and kept nothing. The band had no thread, no status and no way to reply without giving a stranger
its own address. The staff queue, portal chat and direct messages already ran on `inbox_thread`.
Groups left one question open: does a message to a group expand to participant rows at send time,
or resolve the group's members at read time?

## Decision

A booking enquiry is a `band` channel thread owned by the band through a nullable
`inbox_thread.group_id`, where null means the collective. Built in #487, #490 and #491.

1. **Ownership is live.** Readers come from the roster at read time, through `requireGroupRole`.
   A new admin sees past enquiries, and someone who leaves loses them.
2. **A band thread has no `inbox_participant` rows.** Member-side queries find threads through
   that table, so one row would put an enquiry in `/member/messages`. The read cursor lives in
   `inbox_group_read` instead.
3. **Owner and admin only.** Answering an enquiry commits the act to a date and a price.
4. **Mutations resolve the band from the thread** (`bandOfThread`), never from a slug the caller
   sends alongside it.
5. **Each form submission opens a new thread.** Folding on the sender's address would let a
   stranger append to a closed negotiation.
6. **Replies go out as "<Band> via CorvMC"** with a signed per-thread Reply-To. Neither side sees
   the other's address.
7. **Staff cannot see band threads** until one is reported.

## Alternatives rejected

- **Participant rows written at send time.** Later admins would never see the thread, and former
  members would keep it.
- **Snooze, assignment, notes and tags.** A four-person act is not a work queue.
- **Closing as a dead end.** A band or a booker writing back reopens a closed enquiry.

## Consequences

- `group_id` is general; a club or committee could own threads, and nothing writes one yet.
- A booking address that matches no owner or admin still gets the old `band_site_contact` email.
- drizzle-kit emitted `REFERENCES group(id)` unquoted. `scripts/db/quote-reserved-refs.mjs`
  quotes reserved words in generated migrations.
