# Staff Audit Log — Spec

## Purpose

Nothing in the app records **who did what** to a member's account. Staff can
grant `admin`, move credit balances, deactivate accounts and permanently purge
them, and every one of those actions leaves the database looking exactly as if
it had always been that way. When a member asks "who cancelled my booking?" or
"why do I have 3 fewer free hours?", there is no answer to give — and if a staff
account is ever compromised, there is no way to establish what it touched.

The privilege-escalation hole closed in #162 made this the highest-value
remaining gap: the panel now refuses unauthorised role grants, but an authorised
one is still invisible. See `docs/reports/staff-user-management-audit.md`.

## Decisions

- **Append-only, never edited or deleted by application code.** An audit row is
  a fact about the past. The only writer is `recordAuditEntry`; there is no
  update path and no staff-facing delete. Retention pruning is the single
  exception (see below) and runs as a scheduled job, not a UI action.
- **Records the actor, not just the change.** Every row carries the acting user
  id **and** a denormalised copy of their name and email at the time of the
  action. Denormalisation is deliberate: purging a staff account must not erase
  the trail of what that account did, and an FK with `onDelete: 'set null'`
  would leave rows attributing changes to nobody.
- **Records intent, not diffs.** The row names a specific action
  (`user.roles_changed`) plus a small structured `details` JSON payload, rather
  than a generic before/after column dump. A change-data-capture layer over
  every table is a much larger project with much worse ergonomics for the one
  question staff actually ask ("what happened to this member?").
- **Writes are best-effort and never block the action.** An audit write that
  fails must not roll back a deactivation the operator already saw succeed.
  Failures are reported to Sentry and swallowed. This is a deliberate trade:
  the log is for accountability and reconstruction, not for regulatory
  non-repudiation.
- **Rides the existing event bus where an event already exists**, and is called
  directly where one does not. `src/lib/server/event-bus/event-bus.ts` already
  carries `ReservationCancelledEvent` and friends with a `cancelledBy` field; a
  listener in `register-listeners.ts` can turn those into audit rows for free.
  Role and credit changes have no events today and get direct calls in the
  remote handlers.
- **Staff-visible, not member-visible.** Members do not get an activity feed in
  this iteration. Exposing "staff member X looked at your account" is a
  different product decision with its own privacy considerations.

## What gets recorded

Scoped to the actions that change authority, money, or account existence. Reads
are **not** recorded — a read log for a five-person volunteer staff is noise
that would bury the writes.

| Action key                              | Emitted from                             | `details` payload                                                                  |
| --------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------- |
| `user.roles_changed`                    | `updateUser` (users.remote.ts)           | `{ added: string[], removed: string[] }`                                           |
| `user.profile_updated`                  | `updateUser`                             | `{ fields: string[] }` (names only, not values)                                    |
| `user.deactivated`                      | `deactivateUser` / `bulkDeactivateUsers` | `{ reservationsCancelled: number, subscriptionCancelled: boolean, bulk: boolean }` |
| `user.reactivated`                      | `reactivateUser`                         | `{}`                                                                               |
| `user.purged`                           | `purgeUser`                              | `{ name: string, email: string }` (the only surviving record of the account)       |
| `credits.adjusted`                      | `adjustCredits`                          | `{ creditType, delta, balanceAfter, description }`                                 |
| `reservation.cancelled_by_staff`        | event-bus listener                       | `{ reservationId, reason }`                                                        |
| `band.deactivated` / `band.reactivated` | staff band actions                       | `{ bandId, bandName }`                                                             |

`user.profile_updated` deliberately stores **field names only**. Storing old and
new values would copy phone numbers and pronouns into a second table with a
different retention policy, which is a privacy regression, and the current value
is already on the user row.

`user.purged` is the exception that stores identifying values, because after a
purge the user row is gone and the audit entry is the only evidence the account
existed. This is also the row most likely to be subject to an erasure request —
see Open questions.

## Schema delta

New table in a new schema file, `src/lib/server/db/schema/audit.ts`:

```
audit_log
  id            text primary key         -- crypto.randomUUID()
  action        text not null            -- 'user.roles_changed', …
  actor_user_id text null                -- FK user.id, onDelete: 'set null'
  actor_name    text not null            -- denormalised at write time
  actor_email   text not null            -- denormalised at write time
  subject_type  text not null            -- 'user' | 'band' | 'reservation'
  subject_id    text not null            -- not an FK: subjects get purged
  subject_label text null                -- denormalised display name
  details       text json                -- action-specific payload
  created_at    integer timestamp not null default (unixepoch())

  index audit_log_subject_idx  on (subject_type, subject_id, created_at)
  index audit_log_actor_idx    on (actor_user_id, created_at)
  index audit_log_created_idx  on (created_at)
```

`subject_id` is intentionally **not** a foreign key. A purge deletes the user
row, and the audit entry recording that purge must survive it. The same is true
for reservations hard-deleted by any future cleanup.

Relations go in `src/lib/server/db/schema/relations.ts` (actor → user only).

> **Migration:** schema only. The maintainer generates the migration with
> `pnpm db:generate` (which runs `drizzle-kit generate` plus the D1 safe-rebuild
> pass). Do not hand-write migration SQL.

## Service surface

`src/lib/server/audit/audit-service.ts`, following the query/mutation split used
elsewhere in `src/lib/server/`:

```ts
// mutation
recordAuditEntry(input: AuditEntryInput): Promise<void>   // never throws
// queries
listAuditEntriesForSubject(type, id, { limit }): Promise<AuditEntry[]>
listAuditEntries(filters: { action?, actorUserId?, from?, to?, page? }): Promise<Paginated<AuditEntry>>
```

`recordAuditEntry` resolves the actor from `getRequestEvent().locals.user` when
not passed one explicitly, so call sites stay one line. It wraps its own body in
try/catch and reports to `captureException` on failure.

Input validation in the service, per CLAUDE.md: `action` against a closed union,
`details` capped at 4 KB serialised, `subject_label` at 200 chars.

## Where it surfaces in the UI

1. **User detail page** (`/staff/users/[id]`) — a collapsed "History" `InfoCard`
   listing the most recent 20 entries for that user as subject, newest first:
   timestamp, actor, and a rendered one-line summary per action key. This is the
   view that answers "why was my booking cancelled?" at the point of asking, and
   it fits the sidebar/reference slot described in the user-detail-context spec.
2. **Global log** (`/staff/audit`) — a `DataTable` with `Filter.Select` on
   action, `Filter.Search` on actor, and `Filter.Date` from/to. Paginated
   server-side. Linked from the staff dashboard, not from the main nav — it is a
   reference tool, not a daily destination.
3. **No inline badges elsewhere.** Resisting the urge to sprinkle "last changed
   by" onto every card keeps the write path and the read path in one place.

Rendering the summary line is pure display logic and belongs in
`src/lib/utils/audit-display.ts` with unit tests, matching the
`directory-display.ts` precedent — no DB or Svelte concerns.

## Retention

- **Default: 24 months.** Long enough to cover a full membership year plus a
  dispute window, short enough that the table stays small on D1.
- **`user.purged` entries are kept indefinitely** — they are the only record
  that the account ever existed, and they are what a future "did we actually
  delete this person?" question is answered from.
- Pruning runs from the existing scheduled-job path, deleting non-purge entries
  older than the window in batches. It is the only code permitted to delete from
  `audit_log`.

## Open questions

1. **Does an erasure request cover the audit log?** A member asking to be
   deleted arguably wants the `user.purged` row gone too, but that row is the
   evidence the deletion happened. Likely answer: keep the row, drop the
   `details` payload's name/email after the retention window. Needs a decision
   before the retention job is written.
2. **Bulk actions: one row or N?** `bulkDeactivateUsers` over 20 users could
   write 20 rows (queryable per subject) or 1 (readable as an operator action).
   Leaning N rows with a shared `details.batchId` so both views are possible,
   but that adds a column.
3. **Do we record failed attempts?** A staff member trying and failing to demote
   the last admin is arguably interesting. Recording only successes keeps the
   table honest as a record of state changes; recording failures turns it into a
   partial access log. Suggest: successes only for now, revisit if abuse ever
   becomes a real concern.
4. **Actor for system-initiated changes.** Cron-driven cancellations and Stripe
   webhook effects have no `locals.user`. Proposal: a reserved sentinel actor
   (`actor_user_id = null`, `actor_name = 'System'`) with the trigger named in
   `details.source`. Needs confirming against the webhook handlers.
5. **Does this need to survive the D1 rebuild?** Production D1 is currently
   disposable and rebuilt from `~/corvmc.pgsql`
   (`docs/reports/` migration notes). An audit log that vanishes on rebuild is
   worth little, so either the cutover has to happen first or the migrator needs
   an export/import path for this table.

## What this does not cover

- Member-facing activity history.
- Read/access logging.
- Tamper-evidence (hash chaining, append-only storage). If the threat model ever
  includes a malicious staff member with database access, this design does not
  stop them — it only records well-behaved application writes.
- Alerting. No notification fires on a role grant; that is a natural follow-up
  once the data exists.
