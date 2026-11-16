# 0032 Guards name capabilities, positions hold them

- **Date:** 2026-08-03
- **Status:** Accepted

## Context

The app had two elevated roles, `admin` and `staff`, and every guard accepted either one. Holding
`admin` granted nothing that `staff` lacked, so anyone given panel access could purge accounts,
move credit and grant roles. `staff` stood in for positions nobody had named: volunteer
coordinator, site moderator, technology coordinator. Each `requireStaff()` call site made its own
claim about who may act, so changing the answer meant editing every handler. The Laravel
`permissions`, `model_has_permissions` and `role_has_permissions` tables survived the port and no
code read them.

## Decision

1. **A guard names a capability**: `requireCapability('credit.adjust')`, never a role.
2. **The capability-to-position matrix is code**: `capabilities` and `positions` in
   `src/lib/config.ts`, checked through better-auth's standalone `better-auth/plugins/access`
   subpath. The access controller is built in `src/lib/server/authorization.ts`, so config stays
   free of better-auth and safe to import on the client.
3. **Assignment is data**: `roles` and `model_has_roles`. The Laravel permission tables are
   dropped.
4. **A position exists only when a real person holds that title.** A committee is not a
   position.
5. **`admin` holds the admin-only complement** (`adminOnlyCapabilities`): actions in no
   position's job. `staff` holds everything else, derived, so a new capability reaches `staff`
   unless it is named admin-only.
6. **Committee scope sits beside the capability check, not inside it.** `capabilitySet()` answers
   "could this person ever", which is what a nav row needs before any record is in hand.
   Ownership is a second guard in `src/lib/server/group/`, so the dependency runs from group to
   authorization and never back.
7. **When no admin is reachable, a documented `wrangler d1 execute` procedure** grants a position.
   There is no shared admin account.

## Alternatives rejected

- **Collapse to one role.** Least code, but purge and money movement would be open to everyone
  with panel access by default rather than by choice.
- **Two roles, with a small admin-only set.** Fixes the dangerous end and leaves `staff` meaning
  "everything else". Its admin-only list survives as the complement in decision 5.
- **Roles as runtime data** (spatie, Keycloak, an editable matrix). The repo already held those
  tables unread and stale. A mapping kept only in the database is not reviewed, and the org chart
  changes a few times a year.
- **better-auth's organization plugin for committees.** Its permissions are organization-scoped
  with no per-team check. Modelling each committee as an organization would make every band one
  too and add tenant-switching session state.
- **One guard that resolves committee scope itself.** The nav would need a record to answer, so
  it would either guess or resolve ownership per row on every page load.
- **An external authorization service** (OpenFGA, SpiceDB, Cedar, Casbin, Oso). The app has
  about eight positions and one relationship type, and each check would cost a network hop from
  the Worker.

## Consequences

- Re-mapping who may do what is a one-file diff in `src/lib/config.ts`. `config.spec.ts` fails
  when a named position holds an admin-only capability or a capability has no holder.
- A handler on a committee-owned record must pick the scoped guard. The unscoped one widens
  access without an error.
- Help visibility treats any role outside the non-elevated set as staff, so a new position
  widens access to the staff guide rather than hiding it.
- "Notify all staff" becomes "notify whoever holds the capability" (`listUsersWithCapability`).
- Later grants from committees and volunteer roles (#1624) add to positions through the same
  `can()`. `capabilitySet()` stays a function of positions alone.
