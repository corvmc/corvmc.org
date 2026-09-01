# Feature flag retirement

Feature flags did one job here — let a half-built feature sit on `main` without members seeing it.
[Long-lived feature branches](../development/conventions.md#long-lived-feature-branches) do that job
now, so the flags come out. This is the per-flag ledger; it outlives any one session.

**Removing a flag is not a cleanup for most of these.** Five were never switchable at all, so
deleting their guards is the moment the feature goes live. Those are launch decisions, and they
belong to staff, not to whoever is doing the deletion.

## Why five flags were never switchable

`updateFeatureFlag` (`src/lib/remote/settings.remote.ts`) is the only write path to
`site-config:feature.*` in the codebase, and the staff Features tab drives it by iterating
`featureMeta` (`src/routes/staff/settings/+page.svelte`), which lists six of the eleven. The other
five have no toggle anywhere. Unless someone wrote the KV key by hand, they sit at their `DEFAULTS`
value of `false` — which means the entire groups module and member↔member DMs have been dark in
production since they shipped.

## The posture: unlink, don't launch

Decided Sep 1 2026. A flag comes out and the feature does **not** go live with it: the nav entry
points are removed in the same change, so the routes answer only by direct URL. That ships the
cleanup without shipping the feature, and relaunching later is a small, obvious PR putting the nav
entries back rather than a flag flip nobody can see.

The three flags with no toggle and no ambiguity — `groups`, `groupEvents`, `announcements` — went
first, since they were provably off in production and unlinking them changed nothing a member could
see. `helpArticles` followed once probing showed it off too.

**A flag whose feature is already live is the other case, and it is not an unlink.** `emailMarketing`
was on in production, so removing its guards is pure cleanup: the `/subscribe` surfaces, the campaign
cron and the Postmark webhook keep working exactly as they did, and nothing is unlinked. Unlinking a
live feature would be a regression, not a deferral.

### `bandPremium` is held, for the opposite reason

Confirmed off in production Sep 1 2026, and staying off — but not because it is unfinished. The
upsell is complete and priced: `/band/[slug]/subscription` renders monthly and yearly cards, the
page editor and EPK editor both link to it, and `createBandPremiumCheckout` builds a real Stripe
subscription. Nobody has bought it because the flag has never been on.

That makes it the one flag where unlinking may be the wrong move: the launch is a pricing decision
rather than a build, so a flag flip is a cheaper launch than restoring a nav row in a PR. Held
pending that call. The launch price moved to **$5/mo** (`product-config-service.ts`), which yearly
derives as $50 — ten months, two free.

### `directMessages` is held

It is the one case where unlinking **increases** exposure rather than leaving it flat. Today the
guard 404s every member↔member endpoint. Remove it and the DM lifecycle answers to anyone who
constructs the URL — while `contentFlags`, which gates reporting a message, may itself still be off.
That combination is a working messaging system with no reporting path: a moderation decision, not a
cleanup. It waits for the `contentFlags` value below.

## Reading production flag values

**Not through wrangler.** `pnpm exec wrangler login` completes and `whoami` works, but KV and D1
API calls are still rejected with `Authentication error [code: 10000]` while
`/accounts/<id>/workers/scripts` on the same bearer succeeds — the OAuth grant claims scopes it was
not issued. Don't diagnose this with `/user/tokens/verify` either: that endpoint is for API tokens
and calls a perfectly good OAuth bearer invalid. Either read the value from the app, or make a
scoped API token in the dashboard (Account → Workers KV Storage → Read) and set
`CLOUDFLARE_API_TOKEN`.

Two ways to read a value without any of that:

1. **Staff Settings → Features**, which shows every flag with a `featureMeta` entry.
2. **Probe production.** `requireFeature` throws `error(404, 'Not found')`, and a handler-thrown
   404 is distinguishable from an unmatched route: the handler returns
   `content-type: application/json` with `{"message":"Not found"}`, while an unmatched route
   returns an HTML page carrying `x-sveltekit-page: true`. That is how `helpArticles` was settled.
   A guard placed _before_ an auth check gives an even cleaner reading — `/api/help` returns 404
   when the flag is off and 401 when it is on.

   The trap is a surface where both branches 404 identically. `/band-site/[slug]/robots.txt` checks
   the flag and then the tier, and throws the same 404 either way, so it proves nothing.

A flag with no `featureMeta` entry needs no reading at all: `updateFeatureFlag` is the only write
path in the codebase, so it is provably at its `DEFAULTS` value of `false`.

## The ledger

Counts are non-spec call sites in `src/`, taken at `63e5890`.

| Flag             | `requireFeature` | `isFeatureEnabled` | Toggle? | Prod                  | Decision                                             | PR   |
| ---------------- | ---------------- | ------------------ | ------- | --------------------- | ---------------------------------------------------- | ---- |
| `staffInbox`     | 0                | 0                  | yes     | n/a                   | ✅ Deleted — gated nothing                           | #373 |
| `groupFiles`     | 0                | 0                  | **no**  | false                 | ✅ Deleted — gated nothing                           | #373 |
| `groups`         | 9                | 0                  | **no**  | false                 | ✅ **Unlinked** — nav entry removed, routes URL-only | #375 |
| `groupEvents`    | 1                | 1                  | **no**  | false                 | ✅ **Unlinked**                                      | #375 |
| `announcements`  | 3                | 1                  | **no**  | false                 | ✅ **Unlinked** — band nav row removed               | #375 |
| `helpArticles`   | 5                | 0                  | yes     | **false** (probed)    | ✅ **Unlinked** — footer row removed                 | #376 |
| `emailMarketing` | 6                | 2                  | yes     | **true** (probed)     | ✅ Flag deleted, feature **stays live**              | #376 |
| `directMessages` | 7                | 0                  | **no**  | false                 | Unlink — **held** on `contentFlags`                  |      |
| `bandPremium`    | 8                | 1                  | yes     | **false** (confirmed) | Unlink — **held**, launch is imminent                |      |
| `contentFlags`   | 4                | 1                  | yes     | ?                     | needs the staff page                                 |      |
| `volunteering`   | 19               | 0                  | yes     | **true** (confirmed)  | ✅ Flag deleted, feature **stays live**              | #380 |

### The two that gate nothing

`staffInbox` has no guard anywhere — the inbox is staff-only and the staff panel never consulted
flags. `groupFiles` was registered for groups-spec phase 8 (Documents), which is deferred pending a
second R2 bucket. Both are pure registration: delete the union member, the `ALL_FLAGS` entry, the
`DEFAULTS` key, and for `staffInbox` the `featureMeta` entry. When Documents is built it gets a
feature branch, not a flag.

### What goes live if the guard is removed

| Flag             | Surfaces                                                                                               | Where the guards are                                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bandPremium`    | `/band/[slug]/page-editor`, `/band/[slug]/subscription`, `/band-site/**` and its custom-domain routing | `band-page-editor`, `band-subscription`, `band-custom-domain`, `band-site` remotes; `hooks.server.ts`; the band-site `robots.txt` and `sitemap.xml` endpoints |
| `emailMarketing` | `/subscribe/[slug]`, campaign sends                                                                    | `marketing.remote.ts`; the Postmark event webhook; the `send-campaigns` cron                                                                                  |
| `helpArticles`   | `/member/help/**` and its nav entry, `/api/help/**`                                                    | `help.remote.ts`; three `api/help` endpoints                                                                                                                  |
| `contentFlags`   | Report actions on directory profiles, events, DMs and suggestions                                      | `events`, `flags`, `direct-messages`, `suggestions` remotes                                                                                                   |
| `volunteering`   | `/member/volunteer/**` and its nav entry                                                               | `volunteer.remote.ts` — 19 guards, the largest single surface                                                                                                 |
| `directMessages` | The member↔member half of `/member/messages`; member↔staff portal chat in the same UI is **not** gated | `direct-messages.remote.ts`, `directory.remote.ts`                                                                                                            |
| `groups`         | `/member/groups`, `/(public)/groups`, club and committee pages                                         | `groups.remote.ts`                                                                                                                                            |
| `groupEvents`    | Group-authored events reaching the gig guide                                                           | `group-events.remote.ts`, `groups.remote.ts`                                                                                                                  |
| `announcements`  | Band and group announcements, incl. the band nav entry                                                 | `announcements.remote.ts`, `groups.remote.ts`                                                                                                                 |

Specs: `bandPremium`, `emailMarketing`, `contentFlags`, `directMessages` and `volunteering` all have
specs in `docs/specs/shipped/`. `groups`, `groupEvents`, `announcements` and `groupFiles` belong to
`docs/specs/groups-spec.md`, whose phase table shows 0–10 complete and only phase 8 deferred.
`helpArticles` has no spec.

### If a feature is not ready to launch

Two options, both cheaper and safer than reverting merged work off `main`:

1. **Finish it** — on a feature branch, now that there is one.
2. **Remove its member-facing entry points** in the same PR — the nav item and any links — leaving
   the routes unlinked. That is the flag's actual protection, minus the machinery.

Reverting a merged feature is not proposed for any of these.

## Removal mechanics

63 files reference the flag system. One PR per flag; the four group flags go together because their
guards interleave in `groups.remote.ts`.

Per flag: delete its `requireFeature`/`isFeatureEnabled` calls and fold the derived booleans
(`canReport`, `canMessage`, `announcementsEnabled`, `sessionsEnabled`) to their true value; drop the
entry from `FeatureFlag`, `ALL_FLAGS`, `DEFAULTS` and `featureMeta`; drop it from `ENABLED_FLAGS` in
`e2e/fixtures/seed-feature-flags.ts`; strip the `vi.mock('$lib/server/feature-flags', …)` stub from
specs that mocked it only for that module.

Then one final PR deletes the machinery: `src/lib/server/feature-flags.ts` and its spec,
`getAllFeatureFlags` and the `features` key from the layout payloads (`layout.remote.ts`,
`directory.remote.ts`, `settings.remote.ts`), the `nav-items.ts` signatures and their specs,
`updateFeatureFlag` and the staff Features tab, `e2e/fixtures/seed-feature-flags.ts` and its call in
`e2e/prepare.ts`, the `feature.volunteering` write in `seed-volunteering.ts`, the `feature.*` block
in `DEFAULTS`, and the docs that describe the system —
`docs/reports/feature-catalog.md` §Feature flags, `docs/architecture/overview.md`,
`docs/specs/groups-spec.md` §Feature flags and rollout, `docs/checklists/staff-feature-enablement.md`
(which exists only to explain the flag boundary), `docs/development/business-workflows.md`,
`docs/architecture/operations-manual.md`, `docs/development/local-dev-quickstart.md`, `CLAUDE.md`
and `.claude/rules/remote-functions.md`. Run `pnpm docs:check`.

Afterwards, delete the orphaned `site-config:feature.*` keys from production KV.

**The e2e suite is the proof.** It seeds five flags on today (`bandPremium`, `directMessages`,
`groups`, `announcements`, `groupEvents`); with the flags gone those routes must still render, which
is what demonstrates the guard was the only thing between the route and the user.
