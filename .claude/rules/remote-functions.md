---
paths:
  - 'src/lib/remote/**'
---

# Remote functions

`+page.svelte` → `src/lib/remote/*.remote.ts` → `src/lib/server/<domain>/` → db.

**This file is the security boundary.** Remote functions bypass route and layout loads entirely,
and they take their params from a client-supplied header. A guard in `+layout.server.ts` guards
nothing here.

- Guard first (`requireUser`, `requireStaff`, `requireFeature`, … from
  `src/lib/server/authorization.ts`; `requireGroupRole` from
  `src/lib/server/group/group-context.ts`), then validate with a Zod schema, then orchestrate.
  Never key a mutation on a route param.
- `requireGroupRole(ref, minRole, opts?)` takes the group as an explicit `{ slug }` or `{ id }`
  ref — a field on the form, or the query's own argument. That is a lookup key, not a
  capability: the guard resolves the group from it and then checks the caller's role on the
  _resolved_ group.
- Keep them thin. Business logic lives in the service; remotes guard, validate, and delegate.
- Services throw typed domain errors; map them with `mapDomainError()` from
  `src/lib/server/errors.ts`.
- Return DTO-shaped values. Never hand a raw row or a string-indexed grab-bag to the UI.
- Side effects (email, notifications, cascades) go through the event bus in
  `src/lib/server/event-bus/` and must be idempotent.

## `form()` gotchas

- A number field that the user clears is **dropped** from the payload — cleared is
  indistinguishable from untouched. Handle the missing key, don't expect `null`.
- `.transform()` and `z.null()` inside a `form()` schema break the `fields` type inference the
  `<Form>` component relies on.
