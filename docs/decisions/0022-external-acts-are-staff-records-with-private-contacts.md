# 0022 External acts are staff records with private contacts

- **Date:** 2026-08-08
- **Status:** Accepted
- **PRs:** #341, #351, #354, #359, #361

## Context

CMC books acts that have no relationship with CMC. Staff need their bio, links and photo for
marketing, a contact for lost gear and payment questions, and a path for the act to become a member
band. `event_band` rows are keyed to one event, so they could not hold a reusable record. A booking
phone number is private, and this codebase splats whole rows with `select()` and
`getTableColumns()`, so a private column on a publicly read row is one refactor from a leak.

## Decision

1. **An external act is a `directory_entry` with `userId` and `groupId` both null.** It is forced to
   `visibility: 'hidden'` and has no page, slug or share link at any URL. Public mentions link out to
   the act's own `links`, or render as plain text. `event_band.directoryEntryId` credits it, and a
   row pointing at one is `confirmed` by construction.
2. **Private details live in `contact`**, a separate table. Only `contact-service.ts` may import its
   schema, enforced by `custom/no-contact-schema-imports`, and no client DTO carries its fields.
   `contact.subscriberId` links to the marketing consent ledger; creating a contact never enrols an
   address in an audience.
3. **The act edits its own record through a contact-sheet link**, `/act/{token}`
   (`directory_entry_link`). The token authorizes one entry, creates no session, expires, and cannot
   change the name. The same token shows the act what CMC holds about it.
4. **Claiming is a separate door.** `claimExternalAct` creates a band, sets `directory_entry.groupId`
   and inserts the owner row in one batch. The `contact` row is archived, not carried over.

## Alternatives rejected

- **Lineup rows as the record.** Per-event, so nothing carries to the act's next show.
- **Private columns on `directory_entry`.** One unshaped select would publish them.
- **A public profile page with `noindex`.** CMC would host a page for a band with no relationship to
  CMC; the act already has a web presence of its own.
- **better-auth's magic-link plugin for the contact sheet.** It adds a passwordless path to real
  authentication to solve data entry.
- **Merging contacts into `subscriber`.** Marketing queries join `subscriber`; booking phones and
  payment notes must not be in that join.
- **Carrying the contact into the claimed band.** The booking contact is often a manager, not a
  member.

## Consequences

- Every event an act played stays attached through promotion, because credits point at the entry.
- Retention is `contact.retainUntil` and a staff list of expired contacts; nothing deletes them
  automatically.
