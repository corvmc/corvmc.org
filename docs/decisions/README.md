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

| #    | Record                                                                                                                 | Date       | Status   |
| ---- | ---------------------------------------------------------------------------------------------------------------------- | ---------- | -------- |
| 0001 | [Specs live on issues](0001-specs-live-on-issues.md)                                                                   | 2026-11-10 | Accepted |
| 0002 | [A ticket row is one entry pass](0002-a-ticket-row-is-one-entry-pass.md)                                               | 2026-05-14 | Accepted |
| 0003 | [A production is a child of its listing](0003-a-production-is-a-child-of-its-listing.md)                               | 2026-08-02 | Accepted |
| 0004 | [Set times are derived and running order is fractional](0004-set-times-are-derived-and-running-order-is-fractional.md) | 2026-08-02 | Accepted |
| 0005 | [Lineup credits need the band's consent](0005-lineup-credits-need-the-bands-consent.md)                                | 2026-08-12 | Accepted |
| 0006 | [Listings publish first and are moderated after](0006-listings-publish-first-and-are-moderated-after.md)               | 2026-08-13 | Accepted |
| 0007 | [The canonical event URL holds the general view](0007-the-canonical-event-url-holds-the-general-view.md)               | 2026-08-28 | Accepted |
| 0008 | [A ticket price is a sliding scale](0008-ticket-price-is-a-sliding-scale.md)                                           | 2026-09-03 | Accepted |
| 0009 | [Market vendor contact lives on the inbox thread](0009-market-vendor-contact-lives-on-the-inbox-thread.md)             | 2026-09-23 | Accepted |
| 0010 | [Poster art is an artifact request](0010-poster-art-is-an-artifact-request.md)                                         | 2026-09-23 | Accepted |
| 0011 | [Productions are projects](0011-productions-are-projects.md)                                                           | 2026-09-29 | Accepted |
| 0012 | [Partner feeds import as community listings](0012-partner-feeds-import-as-community-listings.md)                       | 2026-11-02 | Accepted |
| 0013 | [Stripe is the payment ledger](0013-stripe-is-the-payment-ledger.md)                                                   | 2026-05-12 | Accepted |
| 0014 | [Recurring reservations clone a prototype](0014-recurring-reservations-clone-a-prototype.md)                           | 2026-05-15 | Accepted |
| 0015 | [Instructors rent the room](0015-instructors-rent-the-room.md)                                                         | 2026-08-31 | Accepted |
| 0016 | [A local financial record](0016-a-local-financial-record.md)                                                           | 2026-09-08 | Accepted |
| 0017 | [Payments run against a fake gateway](0017-payments-run-against-a-fake-gateway.md)                                     | 2026-09-11 | Accepted |
| 0018 | [Door sales on one Tap to Pay phone](0018-door-sales-on-one-tap-to-pay-phone.md)                                       | 2026-09-22 | Accepted |
| 0019 | [Sponsors and grants are two modules](0019-sponsors-and-grants-are-two-modules.md)                                     | 2026-09-23 | Accepted |
| 0020 | [Staff comp credits up to a ceiling](0020-staff-comp-credits-up-to-a-ceiling.md)                                       | 2026-09-23 | Accepted |
