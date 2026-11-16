# 0065 Outside parties are organizations with roles

- **Date:** 2026-11-12
- **Status:** Accepted
- **Supersedes:** [0051](0051-contractor-work-has-its-own-tables.md) decision 1 (the `contractor`
  table). Amends [0019](0019-sponsors-and-grants-are-two-modules.md) and
  [0022](0022-external-acts-are-staff-records-with-private-contacts.md).

## Context

`funder`, `sponsor` and `contractor` were three tables with the same columns: a name, a website,
notes, one contact name and email, and an archive date. One business could not be both a sponsor
and the shop that services the PA without being entered twice, and each table held one person's
details in plain columns outside `contact-service.ts`. Production held no rows in any of them
(#2622).

## Decision

1. **One `organization` table** for every outside party: name, website, notes, an optional
   public `directory_entry` for an act, and `archived_at`.
2. **What it is to CMC is a `party_role` row**: funder, sponsor, contractor, performer, vendor,
   press, partner, supplier or donor. Exactly one of `organization_id` and `contact_id` is set,
   and a role is held once per owner.
3. **The role is checked on write.** `grant_application`, `sponsorship` and `contractor_job`
   reference `organization_id`; their services refuse an organization without the matching role,
   since SQLite cannot.
4. **What only a contractor has** is `contractor_detail`, 1:1: trade, licence and insurance expiry.
5. **People are `contact` rows** with `organization_id`, `user_id`, name, job title, email and
   phone, read only through `contact-service.ts` and guarded by `contact.read` and
   `contact.manage`. The Grants, Sponsors and Contractors forms write the first one.
6. **Exact email merges; likely matches are suggested.** A normalized email already on file
   attaches to that contact. The same name, the same phone, or organizations with the same website
   domain are listed for staff to merge, and a merge writes an audit entry.
7. **`retain_until` is enforced.** A daily sweep deletes contacts past it. An act's contact gets a
   horizon a year out when the act becomes a member band.
8. **A logo is a `media_attachment`** of type `organization`, not a `logo_key` column.

## Alternatives rejected

- **A `kind` column on `organization`.** One business can be several things in the same year.
- **Keeping the three tables and linking them.** Every new kind of party would be another table,
  and the duplicates would stay.
- **Merging likely matches automatically.** A shared `info@` or front-desk number belongs to an
  organization, not a person.

## Consequences

- `/staff/contacts` lists every organization, with a view per role, an organization page and a
  Possible duplicates page. Sponsors and Contractors leave the staff nav; their pages stay as the
  records for those roles.
- A role's own capability (`grant.read`, `sponsor.read`, `contractor.read`) opens that role's
  view and its organizations' pages, without the people.
- Phase 2 (#2622) makes grants and sponsorships projects; phase 4 moves acts, vendors and
  suppliers onto organizations and drops `contact.entry_id`.
