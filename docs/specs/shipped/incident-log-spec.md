# Incident & safety log

> **Status: ✅ shipped.** Tracking issue: #592.
>
> A staff record of what went wrong at the venue — a noise complaint, an injury, a fight at the
> door, a broken window — with what was done about it. Kept for liability, insurance and neighbour
> relations, and read back to see the same thing happening twice.

## The workflow

1. **Something happens.** Whoever was in charge that night tells staff: at close-out, by message,
   or the next morning.
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
  will ask for. There is no delete path in the application.
- **Every row carries its author's name as written at the time**, beside the user FK (`set null`).
  Purging a staff account must not turn their reports anonymous. The same reasoning as
  `audit_log` (`docs/specs/audit-log-spec.md`); the incident tables are their own trail, so they
  do not also write `audit_log` rows.
- **Recording an incident does nothing to a member.** It is a record, not an enforcement action:
  no standing change, no notification, no hidden content. Anything that does act on a member goes
  through the moderation surfaces, which have their own appeal path.
- **Staff-only, behind its own capability.** `incident.read` is held by `admin`, `staff`, the
  site moderator and the volunteer coordinator (#1466). `incident.record` (recording, notes,
  resolving) stays with `admin` and `staff`. A report naming a member is not visible to that
  member.

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
| `involvedUserId`                  | → `user`, `set null`, nullable                           |
| `reportedByUserId` / `…Name`      | FK `set null` plus the name as written                   |
| `status`                          | `open` · `resolved`                                      |
| `resolution`                      | text, set on resolve                                     |
| `resolvedByUserId` / `resolvedAt` |                                                          |
| `createdAt` / `updatedAt`         |                                                          |

Indexes: `(status, occurredAt)` for the queue, `(category, occurredAt)` for read-back,
`involvedUserId`.

### `incident_note`

Append-only. `incidentId` (cascade — there is no delete path, so this only matters to a manual
repair), `authorUserId` (`set null`), `authorName`, `body` (≤ 2000), `createdAt`.

## Surfaces

| Route                   | What                                                                  |
| ----------------------- | --------------------------------------------------------------------- |
| `/staff/incidents`      | Table, newest first; status (default open), category and text filters |
| `/staff/incidents/[id]` | The account, the notes in order, add a note, resolve / reopen         |

Recording is a modal on the list page. Nav: under **Space**, beside Contractors.

## Decisions filed

- #1466 — reversed: the site moderator and volunteer coordinator also hold `incident.read`.
- #1467 — a member cannot see a report naming them, and it changes nothing on their account.
- #1468 — no delete path, kept indefinitely; purging a member only unlinks them.
- #1469 — only staff record; volunteers report to staff. Linking to a show is unbuilt.
