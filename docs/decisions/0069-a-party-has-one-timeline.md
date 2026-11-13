# 0069 Tasks link to what they are about, and a party has one timeline

- **Date:** 2026-11-13
- **Status:** Accepted
- **Issue:** [#2622](https://github.com/corvmc/corvmc.org/issues/2622), with
  [#2630](https://github.com/corvmc/corvmc.org/issues/2630) phase 3

## Context

A follow-up with a funder is a task, so a task had to say which organization or person it is
about. `work_order` already carried `asset_id` and `reservation_id` for the same purpose, one
column per kind of record. When committee members change, the next person needs what was said,
what was sent and what was done in one place, and those were in staff memory, the Inbox and the
audit log.

## Decision

1. **`work_order_link`** holds one row per record a task is about, with one nullable cascading
   foreign key per target (`organization_id`, `contact_id`, `asset_id`, `reservation_id`), a
   CHECK that exactly one is set, and a partial unique index per target. `work_order.asset_id`
   and `reservation_id` moved into it. A new kind of target is one nullable column and its index.
   A column that code acts on (project, event, role, committee, duty list, schedule) stays on
   `work_order`.
2. **Related tasks resolve linked records** through it: an organization's linked tasks, then its
   contractor jobs, then the tasks on its grants' and sponsorships' projects. New task from an
   organization, person, unit or booking writes a link.
3. **`activity`** holds what staff log about an organization or person: a call, meeting, email or
   note, on a club date. `contact.manage` writes it and `contact.read` reads it.
4. **An Inbox conversation is filed** by `inbox_thread.organization_id` or `contact_id`, at most
   one, set-null. A conversation from an address on file is offered for filing to that person.
   Band conversations are never filed.
5. **One timeline per party**, newest first, merged at read time from notes, filed conversations,
   audit entries for its organization, grant and sponsorship projects and contractor jobs, and
   linked tasks marked done. Nothing is copied into a timeline table.
6. **Merging** organizations or people moves their links, notes and filed conversations.

## Alternatives rejected

- **A type and id pair on the task.** It has no foreign key, so a deleted record leaves a dangling
  link.
- **A JSON array of targets on `work_order`.** SQLite cannot index membership, and two edits can
  overwrite each other.
- **A stored timeline table.** Every source already has its own rows; a copy would drift from them.

## Consequences

- Campaign sends are not on the timeline: marketing stores no per-recipient record yet.
- The Contacts list shows each organization's last activity (latest note or filed message) and its
  next open task.
