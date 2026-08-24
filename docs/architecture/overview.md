# System Architecture Overview

This document explains how the CorvMC app is wired, for a developer who knows web
development but may be new to SvelteKit remote functions or Cloudflare Workers. Everything
here is traced from source — file paths are given so you can read the real thing.

Companion documents:

- [Local dev quickstart](../development/local-dev-quickstart.md) — get it running first
- [Business workflows](../development/business-workflows.md) — what the app _does_, traced through code
- [Operations manual](operations-manual.md) — deploys, secrets, integrations, cron
- [Deployment checklist](deployment-checklist.md) — first-time production provisioning

## Big picture

The whole app is **one Cloudflare Worker** (named `corvmc`) running a SvelteKit 2 / Svelte 5
server build. There is no separate API server, no queue worker, no VM.

```
                    ┌──────────────────────────────────────────────┐
  Browser ────────▶ │  Cloudflare Worker "corvmc"                  │
                    │  (SvelteKit app, .svelte-kit/cloudflare)     │
  Stripe webhooks ─▶│                                              │──▶ Stripe API
  Postmark inbound ▶│  Bindings:                                   │──▶ Postmark (email)
  Twilio inbound ──▶│   DB        → D1 (SQLite database)           │──▶ Twilio (SMS)
                    │   R2_BUCKET → R2 (media/file storage)        │──▶ U-Tec API (door locks)
  Cron triggers ───▶│   KV        → KV (site config cache)         │──▶ Sentry (errors/traces)
  (wrangler.toml)   │   ASSETS    → static files                   │──▶ Legacy Laravel app
  (POST /api/cron/*)└──────────────────────────────────────────────┘    (bcrypt verify, pre-cutover)
```

The bindings (`DB`, `R2_BUCKET`, `KV`, `ASSETS`) are declared in `wrangler.toml` and arrive
on every request as `event.platform.env.*`. The first thing the server hook does is hand
them to the module-level singletons:

```ts
// src/hooks.server.ts
const handleBetterAuth: Handle = async ({ event, resolve }) => {
	if (event.platform?.env?.DB) {
		initDb(event.platform.env.DB);
	}
	if (event.platform?.env?.R2_BUCKET) {
		initStorage(event.platform.env.R2_BUCKET);
	}
	if (event.platform?.env?.KV) {
		initKv(event.platform.env.KV);
	}
```

Everywhere else in server code, `db`, storage, and KV are imported directly (e.g.
`import { db } from '$lib/server/db'`). Those imports are lazy proxies — if you use them
before `hooks.server.ts` ran (say, in a standalone script), you get an explicit error from
`src/lib/server/db/index.ts`: `Database not initialized — call initDb(d1) in hooks.server.ts first`.

## The data layer: remote functions, not load functions

This is the part most likely to surprise a SvelteKit developer: **the app has essentially no
`+page.server.ts` load functions and no hand-rolled JSON API routes for its own UI.** All
reads and writes go through SvelteKit **remote functions** — `query()` and `form()` from
`$app/server` — defined in the 21 files under `src/lib/remote/*.remote.ts`.

A remote function is a server function you can import and call directly from a Svelte
component; SvelteKit turns the call into an HTTP request automatically. Docs:
<https://svelte.dev/docs/kit/remote-functions>.

### Reads: `query()`

```ts
// src/lib/remote/reservations.remote.ts
export const getReservationPayment = query(z.string(), async (id) => {
	const currentUser = requireUser();

	const [row] = await db.select().from(reservation).where(eq(reservation.id, id)).limit(1);

	if (!row) throw error(404, 'Reservation not found');
	if (row.createdByUserId !== currentUser.id) throw error(403, 'Not your reservation');
	if (row.status !== 'scheduled') throw error(400, 'This reservation is not awaiting payment');

	const hourlyRateCents = await config<number>('reservation.hourlyRateCents');
	// ... compute duration, total, credit balance ...
});
```

The anatomy repeats across every query in the codebase:

1. **Zod schema** as the first argument validates the input (`z.string()` here).
2. **Auth guard** as the first statement (`requireUser()` — see the auth section below).
3. **Authorization check** against the loaded row (owner or staff).
4. Business logic / DB reads.

And the component side — note there is no load function; the page awaits the query
directly in `$derived`:

```ts
// src/routes/member/reservations/[id]/pay/+page.svelte (inside <script lang="ts">)
import { payReservation, getReservationPayment } from '$lib/remote/reservations.remote';
import { page } from '$app/state';

let data = $derived(await getReservationPayment(page.params.id!));
```

### Writes: `form()`

Mutations are `form()` remote functions. The Svelte side wires them up through the shared
`<Form>` component (see [ui-patterns.md](../development/ui-patterns.md) — this is mandatory,
enforced by a custom ESLint rule):

```svelte
<!-- src/routes/member/reservations/[id]/pay/+page.svelte -->
<Form remote={payReservation}>
	<Field name="coverFees" type="checkbox" ... />
	<SubmitButton class="btn-primary w-full mt-4">Pay</SubmitButton>
</Form>
```

```ts
// src/lib/remote/reservations.remote.ts — a short staff mutation
export const createReservation = form(staffCreateSchema, async (data, _issue) => {
	await requireStaff();
	const startsAt = buildDateInTz(data.date, data.startTime, DEFAULT_TIMEZONE);
	const endsAt = buildDateInTz(data.date, data.endTime, DEFAULT_TIMEZONE);

	const res = await staffCreate({
		userId: data.memberId,
		bookerType: 'user',
		bookerId: data.memberId,
		startsAt,
		endsAt,
		notes: data.notes,
		status: 'confirmed'
	});

	return { reservationId: res.id };
});
```

### The layering rule

```
+page.svelte  ──calls──▶  src/lib/remote/<area>.remote.ts  ──calls──▶  src/lib/server/<domain>/<service>.ts  ──▶  db
   (UI only)                (guard + zod validation +                     (business logic, DB access,
                             thin orchestration)                           input limits, domain errors)
```

- **Remote files** (`src/lib/remote/`) hold the auth guard, the Zod input schema, and thin
  orchestration. They may do simple reads inline, but anything with rules lives in a service.
- **Services** (`src/lib/server/<domain>/`) hold business logic. Domains: `reservation`,
  `finance`, `band`, `event`, `ticket`, `equipment`, `marketing`, `notification`, `inbox`,
  `lock`, `directory`, `user`, `help`, `flag`, `site-config`.
- Services throw typed domain errors (e.g. `ReservationConflictError`); remotes translate
  them to HTTP responses via `mapDomainError()` in `src/lib/server/errors.ts`.

The only plain API routes under `src/routes/api/` are the ones that must speak HTTP to the
outside world: Stripe/Postmark/Twilio webhooks, cron endpoints, the SSE notification
stream, media uploads, and the U-Tec OAuth handshake.

## Authentication and authorization

### Sessions (better-auth)

Auth is [better-auth](https://better-auth.com) configured in `src/lib/server/auth.ts`
(email + password only). `src/hooks.server.ts` resolves the session on every request into
`event.locals.user` / `event.locals.session`. Two details worth knowing:

- **Deactivated users**: a user row with `deletedAt` set is treated as anonymous on every
  request — the session row stays in the DB but is inert (see the comment at
  `src/hooks.server.ts:46`). Sign-in for deactivated accounts is also rejected with the same
  generic message as a wrong password, to avoid account enumeration.
- **`ORIGIN` is required**: better-auth uses it as its `baseURL` and `createAuth()` throws at
  startup if it's unset.

### Password hashing (three formats coexist)

The `account.password` column holds hashes in three formats, distinguished by prefix, all
handled by the custom `verify` callback in `src/lib/server/auth.ts`:

| Prefix    | What it is                          | Path                                                                                                                                                         |
| --------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `scrypt:` | Current format (node:crypto scrypt) | Verified locally. All new hashes are written in this format.                                                                                                 |
| `$2...`   | Legacy bcrypt from the Laravel app  | Proxied to the legacy Laravel server (`LARAVEL_URL` + `MIGRATION_SECRET`) for verification; on success the hash is **rewritten to scrypt**. Dies at cutover. |
| `pbkdf2:` | Brief interim format                | Verified locally via Web Crypto; still accepted.                                                                                                             |

Why scrypt via `node:crypto` and not a JS library: the pure-JS scrypt implementations
better-auth falls back to are silently broken on Cloudflare Workers. The `nodejs_compat`
flag in `wrangler.toml` exposes the native implementation. Note from the source: scrypt
costs ~80ms CPU per hash and **requires the Workers Paid plan** — the Free plan's
per-request CPU cap kills it.

Public sign-up is additionally gated by **Cloudflare Turnstile** (bot protection): the
before-hook in `auth.ts` rejects `/sign-up/email` unless the `x-turnstile-token` header
verifies (`src/lib/server/turnstile.ts`).

### Roles

Site-wide roles live in the `roles` / `model_has_roles` tables (names inherited from the
Laravel app). Priority order, from `primaryRoleFor()` in `src/lib/server/authorization.ts`:

```
admin > staff > sustaining > member
```

- `admin` / `staff` — can use the `/staff` console; checked together everywhere
  (`hasAnyRole(userId, ['admin', 'staff'])`).
- `sustaining` — paying member (monthly Stripe subscription). Note that most sustaining
  checks actually look at the `user.subscription` JSON column, not the role — see
  `isSustainingMember` in `src/lib/server/finance/subscription-service.ts`.
- `member` — the default for everyone.

Bands have their own **separate, per-band role hierarchy**: `owner > admin > member`,
stored on the `bandMember` table.

### Guards — where authorization actually happens

There are **no `+layout.server.ts` guards and no route middleware**. Every protected remote
function starts with a guard call. The guards:

| Guard                                                                | Defined in                            | What it does                                                                                                      |
| -------------------------------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `requireUser()`                                                      | `src/lib/server/authorization.ts`     | 401 unless logged in; returns the user                                                                            |
| `requireStaff()`                                                     | `src/lib/server/authorization.ts`     | 401/403 unless the user has `admin` or `staff` role                                                               |
| `requireStaffOrOwner(userId, ownerId)`                               | `src/lib/server/authorization.ts`     | Allows the resource owner or staff; returns which one matched                                                     |
| `requireStaffRole(userId)`                                           | `src/lib/server/authorization.ts`     | Staff check for plain API route handlers (where `locals.user` is passed in)                                       |
| `requireBandMember()`                                                | `src/lib/server/band/band-context.ts` | Resolves the band from the route's `params.slug`, 403 unless the user is a member; returns `{ user, band, role }` |
| `requireBandRole(min)` / `requireBandAdmin()` / `requireBandOwner()` | `src/lib/server/band/band-context.ts` | Band-scoped role floor (`owner > admin > member`)                                                                 |
| `requireFeature(flag)`                                               | `src/lib/server/feature-flags.ts`     | 404 unless the feature flag is enabled (see Configuration below)                                                  |

Each of the three logged-in areas also has a **layout guard remote** in
`src/lib/remote/layout.remote.ts` that the layout component awaits: `getMemberLayout()`
(redirects to `/login` if anonymous), `getStaffLayout()` (redirects `/` unless staff), and
`getBandLayout(slug)` (403 unless band member or staff). These return the nav data (user,
bands, feature flags) in the same call.

**Important:** the layout guard only protects the page shell. The real security boundary is
the guard inside each remote function — a new remote function without a guard is publicly
callable regardless of which page uses it.

### Route groups

| Route group                    | Audience                     | Layout guard            |
| ------------------------------ | ---------------------------- | ----------------------- |
| `src/routes/(public)/`         | Anonymous visitors           | none                    |
| `src/routes/member/`           | Any logged-in user           | `getMemberLayout()`     |
| `src/routes/band/[slug]/`      | Members of that band         | `getBandLayout(slug)`   |
| `src/routes/staff/`            | `admin` / `staff` roles      | `getStaffLayout()`      |
| `src/routes/band-site/[slug]/` | Public premium band pages    | none (feature-gated)    |
| `src/routes/api/`              | Webhooks, cron, SSE, uploads | shared secrets / tokens |

## The domain event bus

Side effects are decoupled from mutations through a single typed
[emittery](https://github.com/sindresorhus/emittery) instance in
`src/lib/server/events/event-bus.ts`. Services `emit`; listeners subscribe.

```ts
// src/lib/server/events/event-bus.ts
export type DomainEvents = {
	'checkout.completed': CheckoutCompletedEvent;
	'reservation.confirmed': ReservationConfirmedEvent;
	'reservation.cancelled': ReservationCancelledEvent;
	// ... 20 more event names, all defined in this one file ...
};

export const domainEvents = new Emittery<DomainEvents>();
```

Listeners are registered once per Worker isolate by `registerListeners()` in
`src/lib/server/events/register-listeners.ts`, which is called from `hooks.server.ts`
inside the request handler (it must run there, not at module load, because
`$env/dynamic/private` isn't available earlier on Cloudflare). The registrations:

| Event                    | Listener(s)                                                                                         | Effect                                                                                     |
| ------------------------ | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `checkout.completed`     | `reservation/checkout-listener.ts`, `ticket/checkout-listener.ts`, `band/band-checkout-listener.ts` | Each inspects the Stripe session metadata and fulfills its own kind of purchase            |
| `inbox.message_received` | inline in `register-listeners.ts`                                                                   | Notifies every staff user about a new support-inbox message                                |
| `reservation.cancelled`  | inline in `register-listeners.ts`                                                                   | Promotes the next waitlisted reservation into the freed slot                               |
| (most others)            | `notification/notification-listeners.ts`                                                            | Emails/in-app notifications, routed through the dispatcher with per-user preference checks |

**Failure mode to understand:** this is an in-process event emitter, not a queue. Listeners
run best-effort inside the same request; there is no persistence, retry, or dead-letter. If
a listener throws or the isolate dies mid-listener, that side effect is lost. The one place
this matters most — Stripe checkout fulfillment — is protected by Stripe's own webhook
retries: the webhook route returns 500 on listener failure so Stripe re-delivers.

## Database

- **Engine:** Cloudflare D1, which is SQLite. Timestamps are stored as integers, JSON
  columns are TEXT.
- **ORM:** Drizzle. The schema lives in `src/lib/server/db/schema/` (one file per domain,
  re-exported by `index.ts`). Table names/shapes are the single source of truth — there are
  no model classes.
- **Migrations:** generated, never hand-written. Change the schema files, then run
  `pnpm db:generate` (drizzle-kit) to produce `migrations/<timestamp>_<name>/migration.sql`.
  Applying: `pnpm db:migrate` (remote D1, via the `d1-http` driver configured in
  `drizzle.config.ts`) or `pnpm db:migrate:local` (local dev DB). Migrations are
  **forward-only** — there is no down migration; you fix mistakes with another forward
  migration. Details in the [operations manual](operations-manual.md).

### No transactions — use `db.batch()`

`db.transaction()` **does not work on D1** and is banned by the custom ESLint rule
`eslint-rules/no-db-transaction.js`. When multiple writes must succeed together, use
`db.batch([...])`, which D1 executes atomically:

```ts
// src/lib/server/band/band-service.ts — create a band + its owner membership atomically
await db.batch([
	db.insert(band).values({
		id: bandId,
		name: data.name,
		slug,
		bio: data.bio ? sanitizeBio(data.bio) : null,
		ownerId
	}),
	db.insert(bandMember).values({
		bandId,
		userId: ownerId,
		role: 'owner',
		status: 'active'
	})
]);
```

`db.batch()` can't express read-then-write transactions, so check-then-write races are
handled with explicit re-checks — see the comment "no transactions on D1" in
`confirmWaitlisted` (`src/lib/remote/reservations.remote.ts`) for the canonical example of
the pattern: write, re-check for a race, back out if one landed.

## Scheduled work (cron)

Scheduled work runs on **native Cloudflare cron triggers**. The `[triggers]` block in
`wrangler.toml` defines three cron expressions; the `scheduled` handler in `worker.js`
(the wrangler `main` entry, a thin wrapper around the adapter-generated SvelteKit worker)
maps each firing to plain HTTP endpoints under `src/routes/api/cron/*/+server.ts` via
`CRON_SCHEDULE` in `src/lib/server/cron/schedule.ts`, and calls them **in-process**
through the generated worker's own `fetch` export — the full hooks chain (Sentry, auth)
runs, and nothing leaves the Worker. Each endpoint requires:

```
POST /api/cron/<name>
Authorization: Bearer <CRON_SECRET>
```

The eight endpoints and their schedule (cron expressions are UTC — Pacific wall-clock
times shift an hour with DST):

| Endpoint                                    | Purpose                                                                                | Cron (UTC)     |
| ------------------------------------------- | -------------------------------------------------------------------------------------- | -------------- |
| `/api/cron/auto-complete`                   | Mark paid reservations past their end time as `completed`                              | `*/15 * * * *` |
| `/api/cron/cancel-unconfirmed`              | Cancel `scheduled` (never confirmed) reservations at their start time; frees the slot  | `*/15 * * * *` |
| `/api/cron/expire-waitlisted`               | Expire waitlist offers past their 24h window; promotes the next in line                | `*/15 * * * *` |
| `/api/cron/confirmation-reminders`          | Emit confirmation-reminder events for unconfirmed reservations starting within 24h     | `0 16 * * *`   |
| `/api/cron/reservation-reminders`           | Emit reminder events for confirmed reservations starting within 24h                    | `0 16 * * *`   |
| `/api/cron/generate-recurring-reservations` | Expand active recurring series into concrete reservation/event rows (2.5-week window)  | `0 16 * * *`   |
| `/api/cron/lock-access`                     | Provision/clean up U-Tec door lock access for the day's reservations                   | `0 16 * * *`   |
| `/api/cron/send-campaigns`                  | Send email campaigns whose `scheduledFor` has arrived (gated by `emailMarketing` flag) | `*/5 * * * *`  |

The `0 16 * * *` batch (8am PST / 9am PDT) runs its four jobs sequentially, generation
first, so freshly generated occurrences are visible to lock provisioning and the reminder
sweeps. Each job is bracketed with Sentry Crons check-ins (plain HTTP,
`src/lib/server/cron/sentry-check-in.ts`), so Sentry alerts on failed and missed runs.
See the cron section of the [operations manual](operations-manual.md) for the runbook.

## Configuration: three tiers

1. **`wrangler.toml [vars]`** — non-secret deploy-time config: `ORIGIN`, public URLs, email
   sender identity, the public Turnstile site key, `LARAVEL_URL`. Changing these requires a
   deploy. (`wrangler.toml` also carries the cron `[triggers]` and points `main` at
   `worker.js`, the cron-aware wrapper; `wrangler.adapter.toml` is a build-only config read
   by the SvelteKit adapter — see the comments in both files.)
2. **Worker secrets** — everything sensitive (Stripe keys, Postmark tokens, `CRON_SECRET`,
   `BETTER_AUTH_SECRET`, ...). Managed with `wrangler secret`; the full inventory is
   `secrets.template.json` and the table in the [operations manual](operations-manual.md).
   Read in code via `$env/dynamic/private`.
3. **Runtime site config in KV** — settings staff can change without a deploy, via
   `src/lib/server/site-config/site-config-service.ts`. Keys are namespaced strings with
   code-side defaults:

```ts
// src/lib/server/site-config/site-config-service.ts (excerpt of DEFAULTS)
const DEFAULTS: Record<string, string | number | boolean> = {
	'reservation.operatingHoursStart': '09:00',
	'reservation.operatingHoursEnd': '22:00',
	'reservation.hourlyRateCents': 1500,
	'org.timezone': 'America/Los_Angeles',
	'feature.staffInbox': false,
	'feature.emailMarketing': false
	// ...
};
```

`config('reservation.hourlyRateCents')` returns the KV value if staff have set one,
otherwise the default. **Feature flags** are just `feature.*` config keys, wrapped by
`src/lib/server/feature-flags.ts` (`isFeatureEnabled`, `getAllFeatureFlags`,
`requireFeature` — the latter 404s so a disabled feature is indistinguishable from a
missing page). Current flags: `staffInbox`, `bandPremium`,
`emailMarketing`, `equipment`, `helpArticles`, `contentFlags`.

A flag gates the **member, band and public** surfaces only. The staff panel ignores flags
entirely — `getStaffLayout` does not read them, the staff nav is unconditional, and staff
remote functions are guarded by `requireStaff()` rather than `requireFeature()` — so a
feature can be configured and run by staff before (and after) it is switched on for
everyone else.

## Money (orientation)

All payments run through Stripe; the app never touches card data. The moving parts, all in
`src/lib/server/finance/`:

- `payment-service.ts` — one-off charges via Stripe Checkout Sessions (`checkout()`), plus
  `recordCashPayment` / `refund`.
- `subscription-service.ts` — the sustaining-membership subscription (checkout, billing
  portal, quantity updates, cancel/resume).
- `credit-service.ts` — the internal credit ledger (`creditTransaction` table). Sustaining
  members get monthly "free hours" credits; reservations and equipment loans spend them.
- `webhook-handlers.ts` — the single Stripe webhook entry point
  (`src/routes/api/stripe/webhook/+server.ts`) dispatches by event type:
  `checkout.session.completed` (emits `checkout.completed` on the event bus),
  `invoice.paid` (allocates monthly credits), `customer.subscription.updated/deleted`
  (syncs subscription state).

The full money flows, including the reservation confirmation window and credit settlement,
are traced step-by-step in [business-workflows.md](../development/business-workflows.md).

## Observability

- **Sentry** is initialized per-request in `src/hooks.server.ts` via
  `Sentry.initCloudflareSentryHandle` (a Node-style `Sentry.init()` breaks the Workers
  bundle — see the comment there). Manual captures go through `captureException` in
  `src/lib/server/sentry.ts`. 404-probe noise and 4xx errors are deliberately filtered.
- **Release tagging** comes from the `[version_metadata]` binding in `wrangler.toml`.
- **Platform-level traces/logs** (D1 queries, KV/R2 ops) are exported to Sentry by
  Cloudflare's native OTLP observability, configured under `[observability.traces]` /
  `[observability.logs]` in `wrangler.toml`. The destination names (`sentry-traces`,
  `sentry-logs`) must exist in the Cloudflare dashboard — see the operations manual.

## Migration status (pre-cutover)

This app is a rewrite of a legacy Laravel/Postgres system. Until cutover:

- The legacy app is still canonical for production data; this app's D1 database is
  refreshed from Postgres with `pnpm db:sync` (see the operations manual).
- Sign-in for un-migrated users proxies bcrypt verification to the Laravel server.
- `LARAVEL_URL` (wrangler var), `MIGRATION_SECRET` and `DATABASE_URL` (secrets), and the
  bridge scripts under `scripts/` all exist only for this window and are slated for
  deletion — the teardown list is in the deployment checklist §10a.
