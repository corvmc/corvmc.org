# NNNN The audit log records intent, best-effort and append-only

- **Date:** 2026-08-03
- **Status:** Accepted
- **Issue:** [#1131](https://github.com/corvmc/corvmc.org/issues/1131)

## Context

Staff could grant roles, move credit balances, deactivate accounts and purge them, and nothing
recorded who did it. A member asking who cancelled a booking or took their free hours had no
answer, and a compromised staff account could not be traced. The panel already refused
unauthorised role grants (#162); an authorised one left no trace.

## Decision

1. **One row per action, naming its intent**: an action key such as `user.roles_changed` and a
   small `details` payload, not a before-and-after copy of the row.
2. **Append-only.** `recordAuditEntry` is the only insert, and there is no staff-facing edit or
   delete. The scheduled retention sweep is the one exception.
3. **The actor's name and email are copied onto the row.** `subject_id` is not a foreign key. A
   purged staffer's actions and a purged member's own purge row both survive.
4. **Writes are best-effort.** A failed write goes to Sentry and the action stands, because the
   staffer has already seen it succeed.
5. **Successes only, staff-only.** Reads and failed attempts are not recorded. Members do not
   see the log.
6. **A profile edit records field names, not values**, so phone numbers and pronouns are not
   copied into a table with a different retention. `user.purged` is the one row that keeps a
   name and email, since it is the only record the account existed.
7. **Retention is 24 months.** A `user.purged` row is kept past that, without the name, email and
   subject label (#1376).

## Alternatives rejected

- **Change-data capture over every table.** A larger build, and its output answers "what changed
  in this table" rather than "what happened to this member".
- **A foreign key on the actor with `set null`.** Purging a staff account would leave rows
  attributed to nobody.
- **Failing the action when the audit write fails.** The log is for accountability and
  reconstruction, not regulatory non-repudiation. Rolling back a deactivation the staffer saw
  succeed costs more than a missing row.
- **Logging reads.** With a handful of staff, a read log buries the writes.

## Consequences

- Every new write path on an audited record has to call `recordAuditEntry` itself. Nothing
  catches one that does not.
- A payload over 4 KB is dropped, not truncated.
- The log does not resist tampering by someone with database access. It records what the
  application did.
