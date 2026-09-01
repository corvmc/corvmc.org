# Proposal: Universal Data Layer for Web + Kiosk

> **📦 Not adopted — kept for the reasoning.** The problem this proposal names is real and was
> solved a different way: SvelteKit remote functions (`query()`/`form()` in `src/lib/remote/`) give
> one definition that serves SSR and client navigation alike, without an API layer or a second set
> of load functions to keep in step. The convention that came out of it is in
> [conventions.md](../development/conventions.md) and
> [overview.md](overview.md); the project rule is now that remote functions are the security
> boundary and `+page.ts` loaders and API routes are not how data is fetched.
>
> The response types this document specifies were written — `src/lib/server/db/schema/api.ts`,
> 297 lines of them — and never imported by anything. They were deleted three months later. Read
> below for why an API layer looked necessary at the time; the kiosk it was for has not been built.

## Context

CorvMC is 7 days old with 40 server load functions, 13 form actions, and a clean service layer in `src/lib/server/<domain>/`. A kiosk app (Capacitor + Stripe Terminal) is already planned. Right now every page fetches data via direct Drizzle calls in `+page.server.ts`, which locks the app to SSR-only. By introducing an API layer and switching load functions to `fetch()`, the same Svelte templates can serve both an SSR web app and an SPA kiosk app with zero branching.

## How it works

SvelteKit's `fetch` in universal load functions (`+page.ts`) has special behavior:

- **During SSR**: calls to your own API routes resolve internally — no HTTP roundtrip, cookies pass through automatically
- **During CSR/SPA**: same calls go over the network as real HTTP requests

This means one set of load functions works identically for SSR and SPA. The only build-time difference is the adapter.

## Architecture

```
src/
  lib/server/<domain>/       ← service layer (unchanged)
  routes/
    api/<domain>/+server.ts  ← NEW: thin REST endpoints wrapping services
    (app)/
      +page.svelte           ← unchanged
      +page.ts               ← CHANGED: universal load via fetch()
```

Web build: `adapter-auto` → SSR, internal fetch
Kiosk build: `adapter-static` with fallback → SPA, real HTTP fetch

## Migration per route (mechanical)

**Before** — `src/routes/member/reservations/+page.server.ts`:

```ts
export const load = async ({ locals }) => {
	const upcoming = await reservationService.listUpcoming(locals.user.id);
	return { upcoming };
};
```

**After** — `src/routes/api/reservations/+server.ts`:

```ts
export const GET = async ({ locals, url }) => {
	if (!locals.user) return error(401);
	const upcoming = await reservationService.listUpcoming(locals.user.id);
	return json({ upcoming });
};
```

**After** — `src/routes/member/reservations/+page.ts`:

```ts
export const load = async ({ fetch }) => {
	const res = await fetch('/api/reservations');
	return await res.json();
};
```

The `.svelte` files don't change at all.

## Scope

| Category            | Count         | Migration effort                                                 |
| ------------------- | ------------- | ---------------------------------------------------------------- |
| Page load functions | 40            | Mechanical — extract query to API route, replace load with fetch |
| Form actions        | 13            | Convert to `POST /api/<resource>/<action>` endpoints             |
| Existing API routes | 13            | Already done — no changes needed                                 |
| Service layer       | 25+ functions | No changes — API routes call them directly                       |
| Svelte components   | all           | No changes                                                       |

## Auth strategy

- **Web (SSR)**: SvelteKit passes cookies through internal fetch automatically. `hooks.server.ts` sets `locals.user` as today. API routes check `locals.user`.
- **Kiosk (SPA)**: Better Auth supports bearer tokens. The kiosk authenticates once, stores a token, sends it via `Authorization` header. API routes check either cookies or bearer token.
- **Cron**: Unchanged — bearer token via `CRON_SECRET`.

## Form actions → API mutations

SvelteKit form actions (`+page.server.ts` `actions`) only work with SSR. Replace with:

- `POST /api/<resource>/<action>` endpoints
- Client-side form submission via fetch (the app already uses a `Form` component from `docs/development/ui-patterns.md` that can be adapted)

## What this enables

1. **Kiosk app** — Capacitor wrapping the SPA build, with Stripe Terminal native plugin
2. **Mobile app** — same SPA build in Capacitor with push notifications
3. **Third-party integrations** — the API layer is a real API, usable by anything
4. **Cloudflare Workers** — the API server deploys to Workers via Hyperdrive with no additional work

## What doesn't change

- Svelte components, layouts, styling
- Service layer and business logic
- Database schema
- Stripe webhooks, cron jobs, file uploads
- SSE notifications (web-only; kiosk uses polling or native push)

## Execution order

1. **Add API routes** for each domain, starting with the most-used (reservations, bands, members, events)
2. **Convert load functions** from `+page.server.ts` to `+page.ts` with fetch, one route group at a time
3. **Convert form actions** to POST API endpoints + client-side submission
4. **Add bearer token auth** path to API routes for kiosk/SPA use
5. **Verify** — run the web app, confirm SSR still works identically
6. **Set up kiosk build** — `adapter-static` config, Capacitor project

## Estimated effort

~2-3 days for the API extraction and load function conversion (mechanical, low risk). The kiosk app itself (Capacitor setup, Stripe Terminal, native features) is separate work on top.
