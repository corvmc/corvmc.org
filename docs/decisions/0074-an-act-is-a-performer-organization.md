# 0074 An act is a performer organization

- **Date:** 2026-11-13
- **Status:** Accepted
- **Issue:** [#2622](https://github.com/corvmc/corvmc.org/issues/2622)
- **Supersedes:** [0022](0022-external-acts-are-staff-records-with-private-contacts.md) decisions 2
  and 4: one `contact` row per listing through `contact.entry_id`, and archiving that row on
  claim.

## Context

0022 kept an outside act's private details as one `contact` row keyed by its `directory_entry`.
An act often has several people (a manager, a tour manager, a fill-in), a show's contact was
typed into three columns on `production_slot`, and a claimed act's history had no record to
stay on. Since 0065 every outside party is an `organization` with roles and its people are
`contact` rows. Production held no external acts, contacts or production slots (checked
2026-11-13).

## Decision

1. **An outside act is an organization holding `performer`**, with `directory_entry_id` set.
   `createExternalAct` makes it with the listing; `performerFor` makes it on first need for an
   older one. The listing stays public-shaped and hidden; the organization and its people stay
   private.
2. **`/act/{token}` writes a contact on that organization.** A normalized email already on file
   updates that contact; without an email, the act's own earlier entry with no address is
   updated. `contact.entry_id` is dropped.
3. **A show's contact is `production_slot.contact_id`**, one of the act's people, checked on
   write. It replaces the typed `contact_name`, `contact_email` and `contact_phone`. The people
   are shown to whoever books or runs the show's project, and otherwise to
   `directory.readContact`.
4. **A claimed act stays a record.** The new band's `group.from_organization_id` names the
   organization, which is archived and keeps its gigs, payments and people; its people get a
   retention horizon a year out. The band's staff page links to it.
5. **`group.from_organization_id` has no foreign key.** `organization` reaches `group` through
   `directory_entry`, and the table order cannot hold a cycle. Organization merge moves it and
   role removal counts it.
6. **The migration moved what existed:** a performer organization for every outside act and every
   listing with a contact, contacts onto them, claimed bands linked, and each set's typed contact
   into a contact row (one per address, reusing one on file).

## Alternatives rejected

- **Keeping one contact per listing.** An act's manager and its tour manager are different
  people.
- **Copying a show's contact into its own columns.** The same person would be typed again for
  every show and could not be merged.
- **Moving the act's people to the band on claim.** The booking contact is often a manager, not
  a member.

## Consequences

- Merging people moves a show's contact; `contact-people.spec.ts` walks every foreign key into
  `contact` to keep that true.
- A member band's own listing has no performer organization unless it was an outside act first.
