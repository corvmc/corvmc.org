# NNNN Productions are projects

- **Date:** 2026-09-29
- **Status:** Accepted
- **Issue:** [#1673](https://github.com/corvmc/corvmc.org/issues/1673)

## Context

The domain model already said a show is a project, but the schema never joined `project` and
`production`. A production had no budget or burn, no owning committee, and one guard for every
write: `event.manage`, a staff-wide power. Booking and Production both work on a show, and neither
could be handed its own half.

## Decision

1. **Every production is a project, specialised.** `project.kind` is `'general' | 'production'`, and
   `production.project_id` is required and unique. Creating a production creates its project in the
   same `db.batch`. The project carries what every body of work has (name, budget, dates,
   committees, attached work); the production keeps what only a show has.
2. **The two status machines stay separate.** A production reaching `completed` moves its project
   to `done`, and `cancelled` moves it to `declined`. A project status change never drives the show.
3. **Several committees take part in one project** through `project_committee`, keyed
   `(project_id, group_id)` with a role. A show gets Booking as `booking` and Production as
   `production`.
4. **Capabilities divide the show, not the role column.** `production.book` (acts, offers, deals,
   billing, poster art), `production.run` (run of show, advance, crew, door, expenses, settlement)
   and `production.create` (org-wide, since no project exists yet). `requireProjectCommittee`
   passes a member of a committee taking part whose grants carry the capability, and otherwise
   falls back to staff. Paying an act stays `finance.refund`.
5. **A show's money rolls up into its project's burn.** Show expenses and guarantee top-ups count as
   spend. The acts' pool passes through and is shown, never counted as spend.
6. **Crew shifts follow the show's clock.** When a production time moves, live work orders anchored
   to it move by the same delta, so a shift moved by hand keeps its adjustment.

## Alternatives rejected

- **A single owner column on `project`.** A show has two committees doing different halves of it.
  `project.group_id` was dropped in #1752.
- **Guarding by the committee's role on the project.** The role says why a committee is there; the
  committee's grant list says what it may do.
- **Recomputing shift times from the template offset.** `work_order` does not record which template
  item made it, and a recomputation would undo a coordinator's manual change.

## Consequences

- Staff keep full access through the derived staff capabilities.
- Festivals, a parent project over several shows, are not built.
