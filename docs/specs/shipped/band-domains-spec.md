# Band Domains

Reworks who gets a web address. Supersedes the "subdomains are a premium feature"
model in `band-sites-launch.md`.

## Model

| Address                       | Who gets it      | What it serves                                                                        |
| ----------------------------- | ---------------- | ------------------------------------------------------------------------------------- |
| `{slug}.corvmc.org`           | **every band**   | Premium band: the block-editor microsite. Otherwise: 302 to `/directory/bands/{slug}` |
| `theband.com` (custom domain) | **premium only** | The block-editor microsite, at the band's own domain                                  |

The subdomain is free because it costs nothing — one wildcard DNS record covers all
of them. A custom domain is the paid feature: it needs a Cloudflare for SaaS custom
hostname per band (100 free on the account, $0.10/mo each after), plus support load.

## Part 1 — Free subdomains

`src/hooks.ts` already maps `{slug}.corvmc.org/x` → `/band-site/{slug}/x` for any
non-reserved single-level subdomain. It stays DB-free (it is a universal hook, and
runs on the client too).

The tier decision goes in a new `handle` in `src/hooks.server.ts`, which has the DB:

- Not a band subdomain (base domain, `www`, reserved slug) → pass through.
- Band is `tier = 'premium'` and `bandPremium` is on → pass through to `/band-site/{slug}`.
- Anything else — free tier, unknown slug, flag off → `302` to
  `{PUBLIC_SITE_URL}/directory/bands/{slug}`, preserving nothing else (the band-site
  subpaths `/events`, `/epk` have no directory equivalent, so they all land on the
  profile).

Deliberate consequences:

- A band whose `directoryVisibility` is not `public` redirects to a profile that 404s.
  That is the correct outcome — one visibility rule, enforced in one place
  (`getPublicBandProfile`), not duplicated per host.
- A band that lapses from premium stops serving its microsite and falls back to the
  profile automatically. No cleanup job.

## Part 2 — Custom domains (Cloudflare for SaaS)

### Schema — `src/lib/server/db/schema/band.ts`

```
customDomain            text unique      -- 'theband.com', null when unset
customDomainStatus      text             -- 'pending' | 'active' | 'failed'
customDomainHostnameId  text             -- Cloudflare custom_hostname id, for status polls + delete
customDomainVerification text (json)     -- DNS records the band must add (see below)
customDomainAddedAt     integer(ts)
```

No migration in this change — the user generates it with `drizzle-kit`.

### Cloudflare API

`POST /zones/{zone_id}/custom_hostnames` with `{hostname, ssl: {method: 'txt', type: 'dv'}}`.
TXT validation rather than HTTP, so the band can verify _before_ cutting DNS over and
never has a window where their live site is broken.

The response carries the two records the band must create:

- `ownership_verification` → `{name, type: 'txt', value}`
- `ssl.validation_records[0]` → `{txt_name, txt_value}`

Both get stored in `customDomainVerification` and rendered as copy-paste rows.
The hostname is live when `status === 'active'` **and** `ssl.status === 'active'`
(`GET /zones/{zone_id}/custom_hostnames/{id}`); removal is a `DELETE` on the same path.

New secrets — `CLOUDFLARE_API_TOKEN` (Zone → SSL and Certificates → Edit) and
`CLOUDFLARE_ZONE_ID`. Add to `secrets.template.json` and `.env.example`. With either
unset the feature reports itself unavailable rather than throwing.

### Routing to a custom domain

`reroute` runs on both server and client and cannot import server code, so the
hostname → slug lookup goes through `GET /api/host-route?host=` called with the
`fetch` that `reroute` receives (the documented async-reroute pattern). SvelteKit
caches the result per URL on the client. This is the one place an API route is
correct rather than a remote function: it is routing, not data, and it must be
callable from a universal hook that has no request context.

The lookup only fires for hostnames that are neither the base domain nor one of its
subdomains, so ordinary traffic never pays for it. Responses are cached in KV
(5 min) keyed by hostname.

`bandSiteUrl()` gains a custom-domain override so canonical/OG URLs, the "View Live
Site" link and the sitemap all point at the custom domain once it is active.

### Service + UI

- `src/lib/server/band/custom-domain-service.ts` — validate, create, poll, delete.
  Rejects: malformed hostnames, anything under `corvmc.org`, a domain already
  claimed by another band, and any band that is not premium.
- `src/lib/remote/band-custom-domain.remote.ts` — `getCustomDomain` query,
  `setCustomDomain` / `refreshCustomDomain` / `removeCustomDomain` forms. Every one
  guards `requireFeature('bandPremium')` + owner role + premium tier in the handler
  (remote functions are the only guard — route params are attacker-controlled).
- UI on `/band/[slug]/settings` under a "Custom Domain" section: input, the two TXT
  rows with copy buttons, a status badge, a "Check status" button, and remove.

## Part 3 — Pricing copy

Premium no longer sells a subdomain. Update:

- `/band/[slug]/subscription` — "What's included" drops "Custom subdomain", gains
  "Your own domain"; the pitch notes every band already has `{slug}.corvmc.org`.
- `product-config-service.ts` — `band_premium` description.
- `src/content/help/band-pages/premium-band-pages.md`.

## Checklist

- [x] Schema columns on `band` (no migration — **must be generated before deploy**)
- [x] `handle` redirect for non-premium subdomains + unit tests
- [x] `custom-domain-service.ts` + validation tests
- [x] `/api/host-route` endpoint + async `reroute` branch
- [x] `band-custom-domain.remote.ts`
- [x] Settings UI section
- [x] `bandSiteUrl()` custom-domain override
- [x] Pricing/help copy
- [x] Seed data (`scripts/seed-dev.ts`): active + pending custom domains
- [x] e2e: free-band subdomain redirects; premium subdomain serves the site
- [x] `.env.example` + `secrets.template.json`
- [x] parity-report row

**Before this can deploy or run in CI:** generate the migration for the five new
`band` columns with `drizzle-kit`. `pnpm db:migrate:local` (the CI e2e path) has
nothing to apply until it exists.

## Notes from the build

- `static/robots.txt` shadowed `/band-site/[slug]/robots.txt`: static assets are
  served before hooks and routing, so the per-band robots.txt has never been
  reachable on a band address. Moved to `src/routes/robots.txt/+server.ts`, which
  reroute can override. `sitemap.xml` was always fine — no static file shadowed it.
- The async `reroute` must skip its own lookup endpoint. Without that guard the
  lookup request reroutes into another lookup and the request hangs.
- `getCustomDomain` needed an explicit owner check. The slug is a caller-supplied
  argument, so "only owners see the settings page" is not a guard — any logged-in
  user could read another band's domain config, verification tokens included.

## Ops (manual, after deploy)

1. Wildcard `*.corvmc.org` proxied DNS record — still the prerequisite for Part 1.
2. Enable Cloudflare for SaaS on the `corvmc.org` zone.
3. Create a proxied fallback-origin record and designate it as the fallback origin.
4. Publish the CNAME target bands point at (e.g. `domains.corvmc.org`).
5. Mint the API token, `wrangler secret put CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ZONE_ID`.

---

# Part 3 — Changing an address

Bands print `{slug}.corvmc.org` on one-sheets and hand it out; it is their public
identity. Two problems followed from Parts 1 and 2: they could not choose it, and
they could change it _by accident_ — `band-service.update()` re-derived the slug
from the name on every save that touched it, silently relocating the subdomain, the
directory profile and every bookmark.

## Renames no longer move the address

`update()` sets `name` and nothing else. `create()` still derives the initial slug
from the name via `ensureUniqueSlug`. This removed the hazard that
`saveBandProfile` used to work around: a slug-keyed query refreshed after a rename
resolved through the _old_ `params.slug` (remote functions take route params from
the client-sent `x-sveltekit-pathname` header) and 404'd the page that had just
saved. That refresh is now unconditional.

## The explicit flow

Owner-only, free and premium alike — `changeBandAddress`
(`src/lib/remote/band-address.remote.ts`) → `changeBandSlug`
(`src/lib/server/band/band-address-service.ts`). Owner-only matches custom domains;
admins can still rename the band and edit its profile.

- Input is normalized by `normalizeBandSlug` — the shared `generateSlug`, so an
  address a band picks and one derived from its name follow one rule. Slug
  generation never introduces a hyphen of its own: spaces and punctuation are
  dropped ("the velvets" → `thevelvets`), while hyphens already in the input
  survive, with runs collapsed and the ends trimmed.
- It is then checked against reserved slugs and current `band.slug` values, but
  deliberately **not** through `ensureUniqueSlug`: silently handing an owner
  `theneons-2` when they asked for `theneons` is worse than saying it is taken.
- Three changes per 30 days (`allowRateLimited`, keyed on band id), surfaced as an
  inline field issue rather than a 429 — a thrown `error()` reaches the Form
  component's `onfailure` without its message.
- The mutation refreshes nothing. Every band-scoped query is still keyed on the old
  slug at that moment, so the client navigates to `/band/{newSlug}/settings` and
  lets the new route param re-key them.

## Old addresses

`band_slug_history` (slug unique, band FK cascade) records each released slug. An
old address forwards to wherever the band lives now — **until another band claims
it**. A live `band.slug` always shadows history, and claiming a slug (whether via
`changeBandSlug` or `create`) deletes its history row, so at most one row exists
per slug. Uniqueness for a new address is therefore checked against current slugs
only, never against history.

`resolveBandSlug` is the one lookup behind all four redirect sites:

| Surface                                    | Where                                                                                                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `{old}.corvmc.org`                         | `handleBandSubdomain`, `src/hooks.server.ts` — forwards to the new _subdomain_, not a custom domain whose certificate may still be pending |
| `/directory/bands/{old}` (+ member mirror) | `loadBandProfile`, `src/lib/remote/directory.remote.ts`                                                                                    |
| `/band/{old}/*`                            | `getBandLayout`, `src/lib/remote/layout.remote.ts`                                                                                         |
| `/band-site/{old}`                         | `getBandSiteData`, `src/lib/remote/band-site.remote.ts`                                                                                    |

Three decisions worth keeping:

- **302, never 301.** A released address is claimable, so the redirect has to be
  revocable; a cached permanent redirect never could be.
- **The directory check runs only when no row is found**, before the visibility
  gate. Folding it into the combined condition would make a hidden band's old slug
  redirect to its new one, disclosing both its existence and its current address.
- **`requireBandBySlug` keeps 404ing.** It guards mutations, where a thrown
  redirect is applied as a client navigation and would silently discard the
  submitted form. Reads forward; writes fail loudly.

A soft-deleted band shadows its slug (so reactivation cannot collide) but is never
a redirect target (the history join filters `deletedAt`).

**Before this can deploy or run in CI:** generate the migration for
`band_slug_history` with `drizzle-kit`. Until the table exists, `resolveBandSlug`
turns every unresolved band subdomain and directory 404 into a 500.
