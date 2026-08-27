# Sentry Triage — 2026-08-25

All issues in
[corvallis-music-collective/javascript-sveltekit](https://corvallis-music-collective.sentry.io/issues/?project=javascript-sveltekit&query=is%3Aunresolved)
collected via the Sentry MCP and traced to root cause. Supersedes the 2026-08-15
pass (see git history of this file). Environment: production only. Short IDs link
to Sentry; timestamps UTC.

Eleven unresolved issues, **three** causes. One of them was breaking production
while this pass was being written. §5 is a later addendum: two issues that first
arrived on 08-26, after this pass was written, sharing one session replay.

## Summary

| Sentry issue                                                                      | Title                                      | Events/Users | Cause                                                | Action                        |
| --------------------------------------------------------------------------------- | ------------------------------------------ | ------------ | ---------------------------------------------------- | ----------------------------- |
| [2P](https://corvallis-music-collective.sentry.io/issues/JAVASCRIPT-SVELTEKIT-2P) | `no such table: group` — `/directory`      | 1/1          | **Migration never applied to production**            | Deploy fix + apply migrate    |
| [2R](https://corvallis-music-collective.sentry.io/issues/JAVASCRIPT-SVELTEKIT-2R) | `no such table: group` — band subdomain    | 5/2          | same                                                 | same                          |
| [2M](https://corvallis-music-collective.sentry.io/issues/JAVASCRIPT-SVELTEKIT-2M) | `no such table: group` — `/member`         | 4/2          | same                                                 | same                          |
| [2N](https://corvallis-music-collective.sentry.io/issues/JAVASCRIPT-SVELTEKIT-2N) | `no such table: group` — `/member/account` | 1/1          | same                                                 | same                          |
| [2Q](https://corvallis-music-collective.sentry.io/issues/JAVASCRIPT-SVELTEKIT-2Q) | `no such table: group` — `/events`         | 1/1          | same                                                 | same                          |
| [3](https://corvallis-music-collective.sentry.io/issues/JAVASCRIPT-SVELTEKIT-3)   | UnhandledRejection `{body, status}` 500    | 33/19        | Duplicate of a 500 the server already captured       | Filtered client-side          |
| [2F](https://corvallis-music-collective.sentry.io/issues/JAVASCRIPT-SVELTEKIT-2F) | `no such table: messaging_standing`        | 8/5          | Stale Worker, 08-18→08-19; table dropped by #224     | **No code change**            |
| [2G](https://corvallis-music-collective.sentry.io/issues/JAVASCRIPT-SVELTEKIT-2G) | `no such table: messaging_standing`        | 6/4          | same                                                 | **No code change**            |
| [1V](https://corvallis-music-collective.sentry.io/issues/JAVASCRIPT-SVELTEKIT-1V) | `null is not an object (evaluating 'W.f')` | 2/2          | Three remote queries in flight in one component      | One load-bearing query        |
| [2H](https://corvallis-music-collective.sentry.io/issues/JAVASCRIPT-SVELTEKIT-2H) | `url with embedded credentials`            | 1/1          | Two queries in `SiteFooter`, outside every boundary  | One query + its boundary      |
| [2K](https://corvallis-music-collective.sentry.io/issues/JAVASCRIPT-SVELTEKIT-2K) | `JSON Parse error: Unexpected identifier`  | 1/1          | Deploy skew; Safari wording the filter missed        | Filter widened                |
| [2T](https://corvallis-music-collective.sentry.io/issues/JAVASCRIPT-SVELTEKIT-2T) | `D1_TYPE_ERROR` — `getBandUpcoming`        | 3/1          | Remote query raced a navigation off `band/[slug]`    | Guard answers a null slug     |
| [2S](https://corvallis-music-collective.sentry.io/issues/JAVASCRIPT-SVELTEKIT-2S) | `undefined is not an object ('e.f')`       | 1/1          | Window listener live before async-gated state exists | Declare state above the await |

## 1. The schema and the code deployed separately

Five issues, one fact: production D1 still had `band` and no `group`.
`__drizzle_migrations` ended at `20260820190614_fearless_mindworm`;
`20260823195623_band_to_group` had never run. The Worker that queries `group`
(#267, merged 08-24 23:05:17, deployed 23:07:48) published anyway, and from
23:32 every route touching a band 500ed.

**The migrate step had not run at all.** It was half of the build command
configured in the Cloudflare dashboard — `pnpm ci:migrate && pnpm build` — and
that command was recreated without the first half when the repo moved to
`corvmc/corvmc.org`. Builds kept publishing while migrations silently stopped
applying. Nothing in the repo could have caught it, because
`scripts/ci-migrate.mjs` never executed; the branch gate and the fail-closed
behaviour inside it were both unreachable.

Note the asymmetry with **2F/2G** below, which are the same class in the other
direction: there the database was ahead of the Worker. Both are the schema and
the code moving independently.

**Fixed:** `build` is now `node scripts/ci-migrate.mjs && vite build`, so the
dashboard field stops being load-bearing — any command ending in `pnpm build`
migrates. `scripts/ci-migrate.spec.ts` pins the wiring and fails if it is
removed. The production-branch gate is unchanged, which is what keeps local and
CI builds no-ops.

**Then the build failed anyway**, on `Please provide required params for D1 HTTP
driver: [x] databaseId [x] token`. The same recreation had dropped the build
environment variables. `drizzle.config.ts` now falls back to the `database_id`
in `wrangler.toml`, so the migrate targets whatever database the Worker binds
`DB` to and a non-secret value this repo already commits no longer depends on a
dashboard field surviving.

**Operator action:** `CLOUDFLARE_D1_TOKEN` is a secret and still has to be a
build environment variable — Cloudflare → My Profile → API Tokens → Custom →
Account / D1 / Edit. Until it exists the build fails closed and the migration
stays unapplied.

## 2. One component, several remote queries — 1V and 2H

Past kit 2.64 (kit#15991, "dedupe remote data") a component holding more than
one remote query in flight does not render: it drives Svelte into
`effect_update_depth_exceeded` and the boundary shows a minified internals frame
instead. `-1V` is that, from Mobile Safari, on
`member/directory/bands/[slug]` — three queries, the profile, the shows, and
`getMemberLayout()` for two booleans. `getDirectoryBand` cannot return a null
`band` (it redirects or `throw error(404)`), so the `TypeError` was never a data
problem.

`-2H` is the same shape in `SiteFooter` — two queries reading the _same_ `org`
config — and worse placed. The footer is a sibling of `<main>` in
`(public)/+layout.svelte`, so it sits outside the `ErrorToastBoundary` that
wraps only the page children: anything it throws replaces the entire route with
`+error.svelte`. The literal `TypeError: Window.fetch: … is an url with embedded
credentials` is Firefox refusing a relative fetch from a page whose
`document.baseURI` carried `user:pass@` — an external cause, not a bug. The
boundary is what stops it taking the page down.

**Fixed:** `getDirectoryBand`, `getDirectoryMember` and a new `getFooterInfo`
assemble their pages server-side; the permission flags are decided there rather
than pulled off the layout query. The footer has its own
`ErrorToastBoundary showPending={false}`. `getOrgAddress` stays exported because
`/contact` reads it directly, so the org settings form refreshes both it and the
wrapper.

**This is not just two pages.** The rule that was supposed to prevent it,
`custom/no-concurrent-remote-queries`, only matched
`Promise.all([call(), call()])` with literal call expressions — a shape no
offender in the repo actually uses. 50 components fan out and pass lint today.
The widened rule and the conversion backlog are tracked in
[checklists/remote-query-fanout.md](../checklists/remote-query-fanout.md).

## 3. Sentry reporting the same fault twice — 3 and 2K

**Correction to the 08-15 pass.** That pass recorded `-3` as "Fixed in this
branch" — a blank page for members with an unaccepted invite, fixed by filtering
`userBands` to `status === 'active'` and adding `band/+layout.svelte`. That fix
is correct and still in place. `-3` is an aggregate keyed on a title, not a
cause: it has refilled with a different one. "Object captured as promise
rejection with keys: body, status" is what Sentry calls _any_ `HttpError`
reaching `onunhandledrejection`, because `HttpError` is not an `Error` subclass
and so carries no message and no stack.

The current occupants are 5xx. Every one is a duplicate: `-3` and `-2F` are the
same 500 under one trace id (`f621892409b6416aad1b93e24b21d810`), captured once
server-side by `hooks.server.ts`'s `handleError` with a stack, the request and
the user, and once here with `{status, body}` and nothing else. They escape
every boundary because a remote function's rejection outlives its consumer —
`staff/reservations` recreates four query promises on every filter keystroke,
and a superseded one that rejects has nothing left to catch it.

**Fixed:** `isFrameworkControlFlow` drops HttpErrors at every status rather than
stopping below 500. That is what `report-error.ts` already did for the sink it
controls, for the same stated reason; the two sinks now agree. If a 5xx is
missing from Sentry, the bug is in the server capture, not the filter.

`-2K` is `devalue.parse` handed a body of literally `undefined` — deploy skew,
from a tab still on release `82a4999` minutes after a redeploy.
`isStaleRemoteResponse` matched Firefox's, Chrome's and one of Safari's
wordings, but Safari words this case `JSON Parse error: Unexpected identifier`.
Added.

## 4. Already fixed in code — 2F and 2G

`messaging_standing` was created 08-16 and dropped a day later by
`20260817220046_kind_ultimatum`, consolidated into `user.acceptsDirectMessages`
by #224. The database applied that drop; the Worker serving 08-18→08-19 was
still built from code that queried the table. Nothing in `src/` references it
now — only comments and a spec assertion that it stays gone.

**No code change.** Resolve both by hand; there is no commit to attach them to.
The deploy fix in §1 is what addresses them, from the other direction.

## 5. Addendum, 2026-08-26 — 2T and 2S

Both first seen 00:22 UTC on release `7bc49e1`, one user, one minute, one
session replay (`3cfe11d4…`), iPhone / Chrome Mobile iOS. They are two halves of
the same gesture: a tap on a link, on a phone, while the page was still loading.

### 2T — a remote query outlived the page it was mounted on

`getBandUpcoming` has exactly one caller, `routes/band/[slug]/+page.svelte`, yet
the crash arrived on a `GET /member/reservations` transaction. That is the whole
diagnosis. Remote functions are their own endpoint under `/_app/remote/…`; they
do not run inside a route load, and the pathname their params resolve against
comes from a client-supplied header. A query issued on the band page that lands
after the browser has navigated away is resolved against the _new_ pathname, so
`params.slug` is simply absent.

`requireBandBySlug` asserted it non-null — `getBySlug(params.slug!)` — and handed
`undefined` to drizzle, which D1 rejected with `D1_TYPE_ERROR: Type 'undefined'
not supported`. The reported SQL has an empty `params:` array, which is the tell.
A raced navigation became a 500.

**Fixed:** the guard answers a missing slug itself, with a 400, before any query
is built. Every band-context guard funnels through it, so
`requireBandMember`, `requireBandMemberOrStaff` and `requireBandRole` are all
covered. `band-context.spec.ts` pins it, with the `getBySlug` mock rejecting the
way D1 does rather than returning a tidy `null` — otherwise the bug reads as a
404 and the test proves nothing.

The same `params.x!` shape survives in `bands.remote.ts`, `marketing.remote.ts`
and `reservations.remote.ts`. Those are all `requireStaff`-guarded staff detail
pages, so they are far less exposed than a member-facing dashboard, but they are
the same latent 500 and none of them is asserted safely.

### 2S — a window listener attached before the state it reads exists

`TypeError: undefined is not an object (evaluating 'e.f')`, from a document-level
`addEventListener`, the click target an `a.btn` — the user tapped a link.

The hypothesis on the ticket was a read _after_ teardown. It is the opposite: a
read _before_ initialisation. Under `experimental.async`, every declaration after
a top-level await is async-gated. `NotificationBell` compiles to

```js
var open, destroyed, …;
var $$promises = $.run([
  async () => data = await $.async_derived(getNotifications),
  () => { open = $.state(false); … destroyed = false; }
]);
…
$.event('click', $.window, handleClickOutside);   // ← not gated
```

The listener is attached synchronously during setup; `open` and `destroyed` are
assigned only once `getNotifications()` settles. For the length of one round trip
the handler is live and its state does not exist. `destroyed` reads `undefined`,
which is falsy, so the guard that was added for JAVASCRIPT-SVELTEKIT-Q/1A waved
the click straight through; `open` reads `undefined`, and `$.get(undefined)`
dereferences `.f`.

That window is invisible to the existing spec because its mock resolves before
anyone can click. It is wide open on a phone on a slow connection.

`AccountDropdown` had the identical shape and had simply not been caught yet —
the two components `AppTopbar` mounts on every authenticated page, which is the
same tree-level concurrency `docs/checklists/remote-query-fanout.md` records as
out of scope for the per-component lint rule.

**Fixed:** state the listener reads is declared _above_ the awaited derived in
both components, leaving only genuinely `data`-derived values gated. Hoisting
also registers `onMount`/`onDestroy` at setup rather than one round trip late.
Two tests: `NotificationBell.pending.svelte.spec.ts` holds the query pending and
clicks into the gap (it reproduces the exact `TypeError`), and
`src/async-gated-listener.spec.ts` compiles the tree and fails on any component
where a synchronously-attached `$.event` handler can reach an async-gated
binding. The static guard carries its own canaries, since a detector that
silently stops detecting is worse than none.

## Sentry housekeeping

- The code mapping still points at `DevonCash/corvmc-svelte`, which is why
  `-2R`'s "Code Location" links a `worker.js` line in a repo that no longer
  exists. The repo is `corvmc/corvmc.org`.
- Worth an alert rule: `D1_ERROR: no such table`. It is the signal that went
  unnoticed for two hours on 08-24, and it catches every version of §1's failure
  — reset build command, branch-gate skip, hand-rolled deploy — because it
  watches the outcome rather than the mechanism.
