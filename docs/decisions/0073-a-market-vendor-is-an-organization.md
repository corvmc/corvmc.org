# 0073 A market vendor is an organization

- **Date:** 2026-11-13
- **Status:** Accepted
- **Issue:** [#2622](https://github.com/corvmc/corvmc.org/issues/2622)
- **Supersedes:** [0009](0009-market-vendor-contact-lives-on-the-inbox-thread.md) decision 2 and
  its consequence that a returning vendor is matched by the thread's email.

## Context

0009 kept a vendor's name, email and phone on the Inbox thread its application opened, because
there was no vendor record. A returning vendor was matched by that email, so a new address looked
new, and nothing held what a vendor needs at every market. Since 0065 every outside party is an
`organization` with roles and its people are `contact` rows. Production held no market vendor
applications (checked 2026-11-13).

## Decision

1. **A vendor is an organization holding `vendor`.** `market_vendor.organization_id` links each
   application to it. The applicant is a `contact` at it, written by
   `recordApplicantUnguarded` in `contact-service.ts`.
2. **The public form finds the organization by exact email.** A contact already holding the
   normalized email brings their organization; otherwise one is created under the business name.
3. **`vendor_detail` holds the standing setup**: offering, tables needed, power, own table, tent
   and setup notes, 1:1 with the organization. A first application writes it. Staff edit it on
   the organization page. A later application never overwrites it.
4. **An application keeps its own copy** of what it asked for, including `brings_own_table` and
   `brings_tent`, so editing the setup does not change a past market. Its blank setup notes and
   website are filled from the setup and the organization.
5. **Invite-back history matches on the organization.**
6. **The thread stays the conversation.** It is filed to the organization, and keeps the address
   that replies go to.
7. **`event.manage` opens vendor organizations**, as a role's own capability does elsewhere.

## Alternatives rejected

- **Prefilling the public form from `vendor_detail`.** The form has no session, so anyone who
  typed a vendor's email would see that vendor's details.
- **Overwriting `vendor_detail` from each application.** A one-off request would replace what
  staff recorded.
- **Dropping the thread's contact columns.** The Inbox sends replies to them.

## Consequences

- A vendor who applies from an address not on file becomes a second organization until staff
  merge the two on Possible duplicates; the merge carries their applications and setup.
- The public vendor list is unchanged: accepted applications' business name, offering, website
  and table.
