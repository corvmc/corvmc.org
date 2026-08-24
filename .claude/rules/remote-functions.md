---
paths:
  - 'src/lib/remote/**'
---

# Remote functions

`+page.svelte` → `src/lib/remote/*.remote.ts` → `src/lib/server/<domain>/` → db.

**This file is the security boundary.** Remote functions bypass route and layout loads entirely,
and they take their params from a client-supplied header. A guard in `+layout.server.ts` guards
nothing here.

- Guard first (`requireUser`, `requireStaff`, `requireBandMember`, `requireBandAdmin`,
  `requireFeature`, … from `src/lib/server/authorization.ts`), then validate with a Zod schema,
  then orchestrate. Never key a mutation on a route param.
- Keep them thin. Business logic lives in the service; remotes guard, validate, and delegate.
- Services throw typed domain errors; map them with `mapDomainError()` from
  `src/lib/server/errors.ts`.
- Return DTO-shaped values. Never hand a raw row or a string-indexed grab-bag to the UI.
- Side effects (email, notifications, cascades) go through the event bus in
  `src/lib/server/events/` and must be idempotent.

## `form()` gotchas

- A number field that the user clears is **dropped** from the payload — cleared is
  indistinguishable from untouched. Handle the missing key, don't expect `null`.
- `.transform()` and `z.null()` inside a `form()` schema break the `fields` type inference the
  `<Form>` component relies on.
