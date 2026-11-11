# 0052 Secret ballots keep a counter, not a row per vote

- **Date:** 2026-09-24
- **Status:** Accepted
- **Issue:** [#577](https://github.com/corvmc/corvmc.org/issues/577), with the governance rulings
  [#1451](https://github.com/corvmc/corvmc.org/issues/1451) (who votes) and
  [#1452](https://github.com/corvmc/corvmc.org/issues/1452) (secrecy)

## Context

The suggestion board counts upvotes, and anyone can see who gave them. A ballot needs three things
the board cannot give: a defined electorate, secrecy on a member-wide vote, and a close date after
which the result is fixed and certified. A committee's vote is a matter of record, like minutes.

## Decision

1. **Two kinds.** A group ballot's electorate is the committee's active roster and each vote is
   recorded and can change until the close. A member-wide ballot's electorate is the members of
   record plus staff overrides, and each vote is secret and final.
2. **The roll is frozen at open**, written to `ballot_elector` in the same `db.batch` that opens
   the ballot.
3. **A secret vote writes two unlinked rows.** `ballot_participation` records that a member voted,
   with no option and no timestamp. `ballot_choice` is a per-option counter created at open and
   only ever incremented. The cast is one `db.batch`.
4. **Tallies are hidden from everyone until `closes_at`**, staff included, checked on the server.
5. **A named certifier fixes the result** in `ballot.certified_result` and records whether it
   passed. The app never infers passing from the tally.
6. **An open ballot refuses to exclude an elector who has voted.** A secret vote cannot be
   withdrawn.

## Alternatives rejected

- **A row per vote with no user id and no timestamp.** SQLite's implicit `rowid` grows with each
  insert, so ordering both tables by `rowid` pairs voters with choices. A random primary key does
  not remove the `rowid`. Rounding timestamps does not either.
- **Cryptographic secrecy.** The design is secret from the app, its UI and anyone reading a table.
  It is not secret from a Cloudflare account holder comparing D1 Time Travel restores, or from
  whoever deploys the Worker. An election that needs that protection should use a managed service
  (#1452).
- **Proxies.** Only the elector's own session casts their vote.

## Consequences

- `ballot-secrecy.spec.ts` fails if either secret table gains a timestamp, or a column that would
  join it to the other.
- The cast path must never log its payload, in errors, Sentry context or the audit log.
- A small or unanimous result reveals votes, as publishing any tally does.
