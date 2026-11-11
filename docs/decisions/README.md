# decisions

Dated records of why the app is built the way it is. Each one records a decision as it stood on its
date. What the app does now is in the living docs listed in
[conventions](../development/conventions.md#living-docs-and-decision-records).

This README is the index for the folder: every record gets a row in the table below.

## Format

One file per decision, named `NNNN-slug.md`: a four-digit number one above the highest here, then a
short slug. Each record has these parts:

- **Date** — the day the decision was made, as `YYYY-MM-DD`.
- **Status** — `Accepted`, or `Superseded by NNNN`.
- **Context** — the problem and the facts that forced a choice.
- **Decision** — what was decided, stated as a rule.
- **Alternatives rejected** — each option weighed, and why it lost.
- **Consequences** — what changes, and what now has to be kept up.

A page or less. Link the issue and the PRs.

## Rules

- **A record is never edited after it merges.** The one exception is the Status line, which a
  superseding record changes to `Superseded by NNNN`.
- **A later record supersedes an earlier one by number.** The new record names the one it replaces
  in its Context.
- **A feature's last PR adds its record.** The proposal itself stays on the issue.

## Records

| #    | Record                                                                                                                    | Date       | Status   |
| ---- | ------------------------------------------------------------------------------------------------------------------------- | ---------- | -------- |
| 0001 | [Specs live on issues](0001-specs-live-on-issues.md)                                                                      | 2026-11-10 | Accepted |
| 0002 | [A ticket row is one entry pass](0002-a-ticket-row-is-one-entry-pass.md)                                                  | 2026-05-14 | Accepted |
| 0003 | [A production is a child of its listing](0003-a-production-is-a-child-of-its-listing.md)                                  | 2026-08-02 | Accepted |
| 0004 | [Set times are derived and running order is fractional](0004-set-times-are-derived-and-running-order-is-fractional.md)    | 2026-08-02 | Accepted |
| 0005 | [Lineup credits need the band's consent](0005-lineup-credits-need-the-bands-consent.md)                                   | 2026-08-12 | Accepted |
| 0006 | [Listings publish first and are moderated after](0006-listings-publish-first-and-are-moderated-after.md)                  | 2026-08-13 | Accepted |
| 0007 | [The canonical event URL holds the general view](0007-the-canonical-event-url-holds-the-general-view.md)                  | 2026-08-28 | Accepted |
| 0008 | [A ticket price is a sliding scale](0008-ticket-price-is-a-sliding-scale.md)                                              | 2026-09-03 | Accepted |
| 0009 | [Market vendor contact lives on the inbox thread](0009-market-vendor-contact-lives-on-the-inbox-thread.md)                | 2026-09-23 | Accepted |
| 0010 | [Poster art is an artifact request](0010-poster-art-is-an-artifact-request.md)                                            | 2026-09-23 | Accepted |
| 0011 | [Productions are projects](0011-productions-are-projects.md)                                                              | 2026-09-29 | Accepted |
| 0012 | [Partner feeds import as community listings](0012-partner-feeds-import-as-community-listings.md)                          | 2026-11-02 | Accepted |
| 0013 | [Stripe is the payment ledger](0013-stripe-is-the-payment-ledger.md)                                                      | 2026-05-12 | Accepted |
| 0014 | [Recurring reservations clone a prototype](0014-recurring-reservations-clone-a-prototype.md)                              | 2026-05-15 | Accepted |
| 0015 | [Instructors rent the room](0015-instructors-rent-the-room.md)                                                            | 2026-08-31 | Accepted |
| 0016 | [A local financial record](0016-a-local-financial-record.md)                                                              | 2026-09-08 | Accepted |
| 0017 | [Payments run against a fake gateway](0017-payments-run-against-a-fake-gateway.md)                                        | 2026-09-11 | Accepted |
| 0018 | [Door sales on one Tap to Pay phone](0018-door-sales-on-one-tap-to-pay-phone.md)                                          | 2026-09-22 | Accepted |
| 0019 | [Sponsors and grants are two modules](0019-sponsors-and-grants-are-two-modules.md)                                        | 2026-09-23 | Accepted |
| 0020 | [Staff comp credits up to a ceiling](0020-staff-comp-credits-up-to-a-ceiling.md)                                          | 2026-09-23 | Accepted |
| 0021 | [A club gets a page, not a panel](0021-a-club-gets-a-page-not-a-panel.md)                                                 | 2026-08-08 | Accepted |
| 0022 | [External acts are staff records with private contacts](0022-external-acts-are-staff-records-with-private-contacts.md)    | 2026-08-08 | Accepted |
| 0023 | [Group announcements are transactional and batched](0023-group-announcements-are-transactional-and-batched.md)            | 2026-08-08 | Accepted |
| 0024 | [Groups split the band table by purpose](0024-groups-split-the-band-table-by-purpose.md)                                  | 2026-08-08 | Accepted |
| 0025 | [Every band gets a subdomain; premium gets its own domain](0025-every-band-gets-a-subdomain-premium-gets-a-domain.md)     | 2026-08-10 | Accepted |
| 0026 | [Uploads are detached and swept, never deleted inline](0026-uploads-are-detached-and-swept.md)                            | 2026-08-28 | Accepted |
| 0027 | [Band music sells files, and the radio plays a timetable](0027-band-music-sells-files-and-the-radio-plays-a-timetable.md) | 2026-09-03 | Accepted |
| 0028 | [Local resources are their own table](0028-local-resources-are-their-own-table.md)                                        | 2026-09-08 | Accepted |
| 0029 | [One durable packing list per band](0029-one-durable-packing-list-per-band.md)                                            | 2026-09-08 | Accepted |
| 0030 | [One application mechanism for clubs and committees](0030-one-application-mechanism-for-clubs-and-committees.md)          | 2026-09-29 | Accepted |
| 0031 | [The audit log records intent, best-effort and append-only](0031-audit-log-records-intent.md)                             | 2026-08-03 | Accepted |
| 0032 | [Guards name capabilities, positions hold them](0032-guards-name-capabilities.md)                                         | 2026-08-03 | Accepted |
| 0033 | [Staff propose a login email change and the new mailbox confirms it](0033-staff-propose-email-changes.md)                 | 2026-08-03 | Accepted |
| 0034 | [Member conversations share the staff inbox](0034-member-conversations-share-the-staff-inbox.md)                          | 2026-08-12 | Accepted |
| 0035 | [Direct message refusals look alike](0035-direct-message-refusals-look-alike.md)                                          | 2026-08-16 | Accepted |
| 0036 | [One report takes a suggestion off the board](0036-one-report-takes-a-suggestion-off-the-board.md)                        | 2026-08-16 | Accepted |
| 0037 | [Suggestion edits lock at the first outside vote](0037-suggestion-edits-lock-at-the-first-outside-vote.md)                | 2026-08-16 | Accepted |
| 0038 | [Member standing is one table keyed by scope](0038-member-standing-is-one-table-keyed-by-scope.md)                        | 2026-08-17 | Accepted |
| 0039 | [Moderation appeals hang off the upheld report](0039-moderation-appeals-hang-off-the-upheld-report.md)                    | 2026-08-18 | Accepted |
| 0040 | [Reports are module-owned over a shared kit](0040-reports-are-module-owned.md)                                            | 2026-08-27 | Accepted |
| 0041 | [Band enquiries are threads the band owns](0041-band-enquiries-are-threads-the-band-owns.md)                              | 2026-09-04 | Accepted |
| 0042 | [A committed manifest keeps cron monitors in step with the schedule](0042-cron-monitor-manifest.md)                       | 2026-09-29 | Accepted |
