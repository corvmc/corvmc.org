# Incident & safety log

> **Status: ✅ shipped.** Tracking issue: #592.
>
> A staff record of what went wrong at the venue — a noise complaint, an injury, a fight at the
> door, a broken window — with what was done about it. Kept for liability, insurance and neighbour
> relations, and read back to see the same thing happening twice.

## The workflow

1. **Something happens.** Anyone on the crew of that show (holding a volunteer shift for it) can
   file it from their shift page, where it lands `reported` for staff to review (#1469). Otherwise
   whoever was in charge tells staff: at close-out, by message, or the next morning.
2. **A staffer records it** — when, where, what kind, and what happened, in their own words. If a
   member was involved they are linked, so the record can be found from the member's side later.
3. **Follow-ups accumulate.** The neighbour calls back; the insurer asks for a photo; the member is
   spoken to. Each is a dated note under the incident, by whoever wrote it.
4. **Staff close it** with a resolution, and reopen it if it comes back.
5. **Someone reads back** — "how many noise complaints since spring?", "has this happened with this
   member before?" — by filtering the log.

## Rules

- **Nothing is edited away.** The original account is written once. Corrections and new facts are
  follow-up notes, so the record reads the way it happened — which is what an insurer or a lawyer
  will ask for. Staff cannot delete a record; only the retention sweep does (below).
- **Every row carries its author's name as written at the time**, beside the user FK (`set null`).
  Purging a staff account must not turn their reports anonymous. The same reasoning as
  `audit_log` (`docs/specs/shipped/audit-log-spec.md`); the incident tables are their own trail, so they
  do not also write `audit_log` rows.
- **Recording an incident does nothing to a member.** It is a record, not an enforcement action:
  no standing change, no notification, no hidden content. Anything that does act on a member goes
  through the moderation surfaces, which have their own appeal path.
- **Staff-only, behind its own capability.** `incident.read` is held by `admin`, `staff`, the
  site moderator and the volunteer coordinator (#1466). `incident.record` (recording, notes,
  resolving) stays with `admin` and `staff`. A report naming a member is not visible to that
  member.

- **Kept seven years, unless marked `retain`** (#1468). The daily cron
  `/api/cron/sweep-incidents` deletes every incident whose `occurredAt` is more than seven years
  ago and whose `retain` is false; notes go by FK cascade. Each deletion writes an
  `incident.deleted` row to `audit_log` (actor System, the summary as the subject label), which is
  then the only trace it existed. Staff mark or release `retain` on the detail page, with a reason
  kept as a note. It is the same horizon the audit-log retention question (#1376) is asked against.

## Schema

`src/lib/server/db/schema/incident.ts`.

### `incident`

| Column                            | Notes                                                    |
| --------------------------------- | -------------------------------------------------------- |
| `id`                              | uuid                                                     |
| `occurredAt`                      | timestamp, not null — when it happened, not when written |
| `category`                        | `incidentCategories` in `config.ts`                      |
| `location`                        | free text, nullable — "main room", "the alley"           |
| `summary`                         | not null, ≤ 200 — the one line the list shows            |
| `description`                     | not null, ≤ 5000 — the account, written once             |
| `eventId`                         | → `event_listing`, `set null` — the show a crew filed at |
| `involvedUserId`                  | → `user`, `set null`, nullable                           |
| `reportedByUserId` / `…Name`      | FK `set null` plus the name as written                   |
| `status`                          | `reported` · `open` · `resolved`                         |
| `resolution`                      | text, set on resolve                                     |
| `resolvedByUserId` / `resolvedAt` |                                                          |
| `retain`                          | boolean, default false — exempt from the 7-year sweep    |
| `createdAt` / `updatedAt`         |                                                          |

Indexes: `(status, occurredAt)` for the queue, `(category, occurredAt)` for read-back,
`involvedUserId`, `(reportedByUserId, eventId)` for a filer's own list.

### `incident_note`

Append-only. `incidentId` (cascade — the retention sweep deletes an incident's notes with it), `authorUserId` (`set null`), `authorName`, `body` (≤ 2000), `createdAt`.

## Surfaces

| Route                   | What                                                                  |
| ----------------------- | --------------------------------------------------------------------- |
| `/staff/incidents`      | Table, newest first; status (default open), category and text filters |
| `/staff/incidents/[id]` | The account, the notes in order, add a note, resolve / reopen         |

Recording is a modal on the list page. Nav: under **Space**, beside Contractors. The list's
default filter is "Not resolved", which includes `reported` filings; staff accept one (to `open`)
or resolve it directly.

Crew file from `/member/volunteer/shifts/[signupId]`, guarded by
`requireCapability('incident.file', { eventId })`. That is a volunteer-role grant: a `confirmed`
or `completed` signup on a shift of that event that was not called off, in a role whose grants
include `incident.file`, from the shift's start until 2 days after it ends. The seed gives every
at-shows role the grant, and staff can untick it per role. A `claimed` signup no longer counts,
because staff have not accepted it yet. The same page lists what that member filed for the show,
and nothing else from the log: no staff notes, no other filings.

## Decisions filed

- #1466 — reversed: the site moderator and volunteer coordinator also hold `incident.read`.
- #1467 — a member cannot see a report naming them, and it changes nothing on their account.
- #1468 — reversed: deleted after seven years unless marked `retain`; each deletion is audited.
- #1469 — reversed: crew of a show file incidents for it as `reported`; filers see only their own.
