# `admin` vs `staff` — Spec

## Purpose

The app has two elevated roles and no difference between them.

`requireStaff()` (`src/lib/server/authorization.ts`) is
`hasAnyRole(userId, ['admin', 'staff'])`. So is `isStaff()`, so is `requireStaffRole()`, so is
`listStaffUsers()`, and so are all three checks in `layout.remote.ts` and both in
`account.remote.ts`. A grep for `'admin'` across `src/lib/server` and `src/lib/remote` finds it
only ever paired with `'staff'` in the same array — never on its own.

The one place the two are distinguished is cosmetic: `primaryRoleFor()` orders `admin` above
`staff` so the users list can show a different icon.

**Holding `admin` conveys no authority that `staff` does not already have.** A staff member can
grant themselves `admin`; the only thing stopping the reverse is the last-admin guard added in
#162, which protects a role that does nothing.

This is not currently exploitable — it is a _misleading_ model, not a hole. But it means the
panel's most dangerous capabilities (purging accounts, moving credit balances, granting elevated
roles) are all available to anyone who is handed panel access for a mundane reason, and there is
no way to express "let this volunteer take payments but not delete members."

**An earlier draft of this spec asked how many generic tiers there should be, and offered two
answers: collapse to one, or split into two. Both are answers to the wrong question.** They are
kept below as rejected alternatives, because the reasoning in them is still worth having.

---

## The question this spec actually has to answer

Two things changed since the first draft.

**`staff` was always a stopgap.** It stands in for role names that were never written —
volunteer coordinator, site moderator, technology coordinator. The intent was never a tier. It
was a **position**, and `staff` is what got shipped instead because naming them all was more
work than the moment justified.

**The committee structure arrived and needs the same thing from the other direction.** See
[committees-and-roles-spec.md](committees-and-roles-spec.md): committee members are to act
within their own domain, which means granting authority to people who should never hold the
whole panel. That document originally called this spec a hard prerequisite. **It is not** — a
committee guard reads `group_member`, not the role table, and the two are independent. What is
true is stronger and more useful: committees _relieve the pressure that motivated this spec_,
because they stop panel access being the thing you hand someone for a mundane reason. Which was
the failure mode in the first place.

So the question is not "one tier or two". It is:

> **What is the thing a guard names, what is the thing a person holds, and how are the two
> associated?**

---

## Three layers, and only one of them is runtime data

**A capability is what a guard names. A position is what a person holds. The association
between them is configuration.**

| Layer          | Example                              | Where it lives                    | Changes when           |
| -------------- | ------------------------------------ | --------------------------------- | ---------------------- |
| **Capability** | `user.purge`, `credit.adjust`        | Named at the call site of a guard | The code changes       |
| **Position**   | `volunteer_coordinator`, `treasurer` | A matrix in `src/lib/config.ts`   | The org chart changes  |
| **Assignment** | Jordan holds `volunteer_coordinator` | `model_has_roles` (already live)  | Somebody takes the job |

**The indirection that matters is at the call site, not in the database.** The actual mistake in
the code today is not that roles are hardcoded — it is that _policy_ is hardcoded, inline, in
every handler. `requireStaff()` appears at hundreds of call sites, and each one is an
independent assertion about who should be allowed to do that thing. Changing the answer means
finding all of them.

Guarding on a capability fixes that without a database table:

```ts
// today — the handler asserts a role, so re-mapping means editing the handler
requireStaff();

// instead — the handler asserts what it is, and the matrix says who has it
requireCapability('credit.adjust');
```

Positions can then be added, renamed, split or re-mapped in one file, and no handler moves. This
is the same discipline spatie's model got right — _guard on the permission, not the role_ — with
none of the machinery, because the mapping is a typed literal rather than three join tables.

**Assignment stays in the database, because assignment is the part that genuinely changes at
runtime.** Somebody takes over as volunteer coordinator on a Tuesday and nobody should deploy
for that.

---

## Prior art

This is a solved problem and worth not re-deriving.

**The dead tables in this repo are the cautionary tale.** `permissions`,
`model_has_permissions` and `role_has_permissions` are
[spatie/laravel-permission](https://spatie.be/docs/laravel-permission)'s model, carried over by
the deleted Postgres ETL and read by no application code. That model is roles-as-data:
permissions are rows, roles are rows, the mapping is a join table, and an admin edits it at
runtime. It is a good design and it rotted here within one migration, because a mapping that
lives only in a database is a mapping nobody reviews. **This repo has already run the
roles-as-data experiment and has the corpse to prove how it went.**

**`better-auth` — already a dependency — ships the exact shape proposed above.**
[`createAccessControl`](https://better-auth.com/docs/plugins/admin) takes a `statement` object
of resource → actions and produces roles composed from it:

```ts
const statement = { project: ['create', 'share', 'update', 'delete'] } as const;
const ac = createAccessControl(statement);
const admin = ac.newRole({ project: ['create', 'update'] });
```

Roles are **defined in code and assigned in data**, which is precisely the split this spec
argues for, arrived at independently by a library we already run. Server-side checking is
`auth.api.userHasPermission()`.

**Verified: `better-auth/plugins/access` imports standalone.** The documentation only covers use
_through_ the admin and organization plugins, so this was run against the installed copy
(1.6.30) rather than assumed. It is its own subpath export, it exports exactly
`createAccessControl` and `role`, a role exposes `authorize()` and `statements`, and none of it
touches a plugin, an auth instance, or the database:

```
vol_coord {"volunteer":["reviewHours"]}                  -> {"success":true}
vol_coord {"credit":["adjust"]}                          -> {"success":false, "error":"..."}
vol_coord {"volunteer":["reviewHours"],"user":["purge"]} -> {"success":false, "error":"..."}
```

Multi-resource checks AND-compose, as the last line shows. The module is 4KB. **Adopt it**: it
is zero new dependencies for a primitive that would otherwise be hand-rolled, and the admin
plugin — whose ban, impersonate and delete endpoints are not wanted here, and which this app
avoids by running `better-auth/minimal` — does not have to come with it.

Two mechanical notes that follow from it being a library rather than local code. `authorize()`
returns `{ success, error }` rather than a boolean, so the guard wraps it. And the statement must
be a plain `as const` literal in `src/lib/config.ts` with the access controller built in
`src/lib/server/authorization.ts` — calling `createAccessControl` in `config.ts` would pull
better-auth into the client bundle, since that file is client-importable by convention.

**The heavyweight end of the market is real and is not for us.**
[OpenFGA](https://openfga.dev/docs/authorization-concepts) and SpiceDB implement Google's
Zanzibar model — relationship-based access control, where "Alice can edit Project X" is stored
as a relationship tuple rather than derived from a role. Cedar (AWS) and Casbin and Oso are the
embedded-policy-language alternatives. The reported threshold for reaching for fine-grained
authorization is a **role count crossing roughly twenty**, or resource sharing becoming a
first-class product feature. This organization has about eight positions and does not share
resources between tenants. An external authorization service would also mean a network hop per
check inside a Cloudflare Worker, which is the wrong shape for this app regardless of role
count.

**The hybrid this lands on is the common one.** The prevailing pattern is RBAC for coarse policy
plus relationship checks for per-resource permissions. That is exactly what this app needs and
already half has: named positions are the RBAC half, and `group_member` — committee and band
membership — is the relationship half. It is **one** relationship type, which is why it stays a
hand-rolled guard (`requireGroupRole`, already designed in
[groups-spec.md](groups-spec.md)) rather than a policy engine.

---

## Decisions

- **Guards name capabilities, not roles.** A handler asserts what it is doing; the matrix
  decides who may. This is the change that makes every later question cheap.
- **Positions come from the org chart, not from the codebase.** A named role exists when a real
  person holds that title —
  [committees-and-roles-spec.md](committees-and-roles-spec.md) and the CMC Committees and Roles
  proposal are the registry. This is the rule that keeps the list at eight rather than eighty,
  and it is the rule whose absence produced `staff`.
- **A committee is not a position.** Committee membership is plural, rotating and domain-scoped,
  and it already has a table, a lifecycle and a chair who administers it. Positions are singular
  and cross-cutting — the volunteer coordinator serves every committee, which is exactly why
  they cannot be on one. Expressing a committee as an auth role would be the same name in two
  places again.
- **The capability matrix is code; assignment is data.** `src/lib/config.ts` already holds the
  vocabularies this app shares between client and server, and this is one.
- **The spatie tables are dropped, not kept.** They are the roles-as-data model this spec
  declines, they hold Laravel grants from a system that no longer exists, and leaving them is an
  invitation to build the second authorization mechanism this spec exists to avoid.
- **`admin` survives under its own name.** Nobody's title is "admin"; it is a systems concept,
  and dressing it as an org position would be less honest rather than more. Per §5.1 of the
  proposal it is held by the Technology Coordinator plus a board officer — which is also where
  the two-admin requirement below comes from.

---

## The shape

Illustrative, not the final matrix — the full one is derived during implementation by reading
the existing guards.

```ts
// src/lib/config.ts
export const capabilities = {
	user: ['list', 'read', 'update', 'deactivate', 'purge', 'setRole', 'setEmail'],
	credit: ['adjust'],
	settings: ['read', 'update'],
	audit: ['read'],
	volunteer: ['reviewHours', 'manageRoles', 'manageCertifications', 'report'],
	moderation: ['reviewFlags', 'setStanding', 'decideAppeal'],
	finance: ['read', 'refund']
} as const;

export const positions = {
	admin: 'all',
	technology_coordinator: { settings: ['read', 'update'], audit: ['read'], user: ['list', 'read'] },
	volunteer_coordinator: {
		volunteer: ['reviewHours', 'manageRoles', 'manageCertifications', 'report'],
		user: ['list', 'read']
	},
	site_moderator: {
		moderation: ['reviewFlags', 'setStanding', 'decideAppeal'],
		user: ['list', 'read']
	},
	treasurer: { finance: ['read', 'refund'] }
} as const;
```

`staff` stays in the table as a position meaning "elevated, function not yet named", so that
nothing has to be renamed on day one and the migration can proceed one handler at a time.

### What stays `admin`

Unchanged from the first draft, and now with a cleaner definition behind it: **the admin-only
set is the complement of every position's and every committee's domain** — the actions that
belong to no one's job description.

| Action                     | Capability        |
| -------------------------- | ----------------- |
| Grant or remove a position | `user.setRole`    |
| Purge a user               | `user.purge`      |
| Change site settings       | `settings.update` |
| Change a user's email      | `user.setEmail`   |
| View the global audit log  | `audit.read`      |

Two judgement calls, one of them changed since the first draft:

- **Deactivation is not admin.** It is the routine front-desk action and it is reversible. Purge
  is not.
- **Credit adjustment is no longer admin.** The first draft put it here and then argued against
  itself: comping an hour for a member whose session was interrupted is a front-desk kindness,
  and routing it through an admin means it does not happen. It is bounded — practice-room credit,
  not money — and if it needs a ceiling, that is an amount, not a role. See open questions.

---

## Implementation

**Additive, and there is no flag day.** `requireStaff()` survives as a function; its definition
becomes "holds any elevated position". Nothing that works stops working. Then handlers narrow
one at a time.

The surface is smaller than it sounds. `requireStaff()` has **266 call sites in 22 files, 18 of
them under `src/lib/remote/`** — so the narrowing is roughly one PR per remote module, each
independently revertible. Around them sit `isStaff(` ×11, `hasAnyRole(` ×11, `listStaffUsers(`
×7 and `primaryRoleFor(` ×3, which are the ones that need thought rather than a swap.

Defining the matrix and the guard while changing no handler is a complete, shippable step with
**no behavioral change at all** — which is what makes the rest safe to do slowly.

```ts
export async function requireCapability(cap: Capability) {
	const { locals } = getRequestEvent();
	if (!locals.user) throw error(401, 'Not authenticated');
	if (!(await can(locals.user.id, cap))) throw error(403, 'Not permitted');
	return locals.user;
}
```

Per the rule #162 established — **a remote function is only as guarded as its own first line** —
this is a first-statement swap per handler. Route and layout guards do not protect remote
functions; there is nothing else to change.

`updateUser` still needs finer treatment than a whole-handler swap: it is one form that edits
profile fields _and_ roles. Keep the broad guard at the top and reject only when the submitted
role set differs from the current one and the caller lacks `user.setRole`. That keeps a
volunteer able to fix a phone number on an admin's account, which they should be able to do.

UI follows the guards rather than leading them: controls the viewer cannot use are hidden, and
nav rows drop out. Hiding a control is not a guard — it just stops someone walking into a 403.
`layout.remote.ts` returns the viewer's capability set rather than a pair of booleans.

### Three costs this creates

- **`help-service.ts` breaks further, and it is already broken.** Six call sites filter
  `inArray(minRole, roles)` — an exact membership test, not a hierarchy — so an article with
  `minRole: 'staff'` is **invisible today** to a user holding only `admin`. Add positions and it
  is invisible to every one of them. This is a live bug independent of this spec, it should ship
  on its own before any of this, and it is a hard blocker for the rest.
- **"Primary role" stops being well-defined.** `primaryRoleFor()` is a fixed SQL `CASE` ladder
  rendered as one badge in the users list. Unranked positions have no top one; it becomes a set
  of chips or an explicit display order.
- **Assignment lookup wants a per-request cache.** `authorize()` is pure and synchronous, but
  resolving which positions a user holds is a database read. That is no worse than today —
  `requireStaff()` already reads through `hasAnyRole` — but capability checks invite more of
  them, and `layout.remote.ts` already does three. `App.Locals` is `{ user, session }` today and
  `hooks.server.ts` populates it from the session; resolving positions there once per request
  makes this cheaper than the status quo rather than more expensive.
- **"Notify all staff" needs a referent.** `listStaffUsers()` backs notifications like the
  volunteer hour-log queue. Those become "notify whoever holds `volunteer.reviewHours`" — a
  better outcome, and real work at every call site.

---

## Migration and rollout

- **No schema change**, and one deletion: `roles` and `model_has_roles` carry the assignments
  already; `permissions`, `model_has_permissions` and `role_has_permissions` are dropped.
- **Two people hold `admin` in production** — confirmed. Per §5.1 of the proposal the intended
  pair is the Technology Coordinator plus a board officer.
- **The dead seeded roles go.** `volunteer` is checked by no code path, and `sustaining` is
  computed from Stripe via `isSustainingMemberSql` rather than read from the role. Volunteering
  is expressed by `volunteer_profile` and shifts; committee membership by `group_member`.
  Neither needs a role row. This closes an open question from the first draft.

### Break-glass

If the only reachable admin is unavailable and a setting has to change, the answer is a
**documented `wrangler d1 execute` runbook in
[operations-manual.md](../architecture/operations-manual.md)**, not a second shared account.

A standing shared credential is a permanent risk to defend; a documented procedure is an
occasional one. It requires infrastructure access, which is already a smaller circle than staff;
it leaves a trail; and it needs no application code. The first draft left this open and said it
needed an answer before shipping. This is the answer.

---

## Rejected alternatives

**Option A — collapse to one role.** Delete `admin` as an authorization concept; existing
holders get `staff`. It matches today's reality exactly and is the least code. Rejected because
"everyone with panel access can permanently delete a member and move money" should be a chosen
policy rather than an accident, and because it throws away the migrated role assignments, which
encode somebody's earlier judgement about who was trusted with what. Worth noting that
committees make this **more** viable than when it was written, not less — if committees absorb
the reasons access gets handed out, the residual population is small and trusted, which was
Option A's whole premise. Two-person integrity on purge and role-granting is still cheap enough
to keep.

**Option B as originally drawn — keep two roles, give `admin` a small exclusive set.** This was
the first draft's recommendation and it is not wrong so much as too small. It fixes the
dangerous end and leaves the stopgap in place: `staff` still means "everything else", which is
the thing that made the model misleading. Its admin-only table survives above almost unchanged —
it turns out to be the complement set — but as an output of the capability matrix rather than
the whole design.

**Roles as runtime data (spatie's model, Keycloak, an admin-editable matrix).** Rejected on this
repo's own evidence: those tables exist, hold stale Laravel grants, and are read by nothing. A
mapping that lives only in a database is a mapping nobody reviews, and it buys runtime editing
that an organization changing its org chart a few times a year does not need. It also needs a
UI and a lockout guard, both of which are real work.

**`better-auth`'s organization plugin, for the committee half.** The obvious question, since the
access-control primitive above comes from the same library and the plugin exists in the
installed copy — `organization`, `member`, `invitation`, `team`, `teamMember` and
`organizationRole` are all present. Rejected on a specific finding rather than on taste:
**teams follow the organization's permission system and there are no per-team permission
checks.** `hasPermission` is organization-scoped only, which forces a choice between two bad
mappings.

- _CMC is the organization, a committee is a team._ Semantically right — one organization with
  internal groupings — and it delivers nothing, because per-team scope is the entire
  requirement.
- _A committee is an organization._ Now the check works, but `group` is one table holding bands,
  clubs and committees, so every band becomes an organization too; `activeOrganizationId` lands
  on the session, which is tenant-switching state this app has no use for (somebody on both
  Programming and Production does not switch between them); and the cross-cutting positions are
  not organization-scoped at all, so `createAccessControl` is still needed beside it. Two
  mechanisms rather than one.

Timing seals it. Schema mapping is supported (`modelName`, `fields`, `additionalFields`), so
pointing `member` at `group_member` is mechanically possible — but `group_member` carries
`status`, `position`, `alias`, `notifyAnnouncements` and a partial unique owner index that
better-auth's `member` does not, several of them load-bearing in
[groups-spec.md](groups-spec.md), and **groups is mid-migration at phase 3c of ten**.
Retargeting those tables onto a plugin's expectations while the `band` → `group` rename is still
in flight would put group bugs and migration bugs in one diff, which is the hazard that spec
spends a page warning about for the phases it already has.

What is actually being declined is small: the relationship check is _"is this user an active
member of the group owning this resource, at role ≥ X"_ — one query, already designed as
`requireGroupRole`. The plugin's value is the surrounding machinery (invitations, member CRUD,
active-organization session state), which this app already has or is deliberately building
differently.

**Worth stealing, though, and recorded so it is not reinvented badly:** `organizationRole` is a
role row scoped to one organization with its permissions stored as JSON, created at runtime.
That is the shape to copy as a `group_role` table _if_ committees ever want their own internal
positions — "Programming has a booker with these capabilities" — which is the one place
roles-as-data is right, because the people maintaining it are the committee itself. Not needed
now: today's positions are cross-cutting and belong in the code matrix.

One trap if the client side looks tempting: `checkRolePermission` is client-only, synchronous,
and explicitly excludes dynamic roles, so it cannot be the source of truth for UI gating.

**An external authorization service (OpenFGA, SpiceDB, Cedar, Casbin, Oso).** Rejected on scale
and on shape. The threshold where fine-grained authorization pays for itself is roughly twenty
roles or resource sharing as a product feature; this is eight positions and one relationship
type. Inside a Cloudflare Worker it would also mean a network hop per check. Revisit only if the
position count triples or per-resource sharing becomes a real feature.

---

## Open questions

1. **Do board offices become positions?** Treasurer receives every event's signed count and
   presents financials; Youth Safety and Complaints are both squarely app-touching. All three
   pass the singular-and-cross-cutting test. Part 3 of the proposal was scoped out of
   [committees-and-roles-spec.md](committees-and-roles-spec.md), so this is the first thing to
   pull back in — and it is the difference between a five-position list and an eleven-position
   one.
2. **Is `credit.adjust` bounded by an amount?** The decision above moves it out of admin. If
   that is too loose, the bound is a ceiling — "up to N hours without escalation" — which is the
   same threshold model the committee spending limit needs. Neither exists, and building one
   mechanism for both is the cheap version.
3. **Does `requireCapability` compose with committee scope, or sit beside it?** A capability
   like `event.publish` is unqualified; a committee member holds it _for their own domain_. The
   likely answer is that committee-scoped guards take the resource and resolve the committee
   from it, and the two guards stay separate rather than merging into one call that has to know
   both. Worth settling before the first committee surface, not after.
