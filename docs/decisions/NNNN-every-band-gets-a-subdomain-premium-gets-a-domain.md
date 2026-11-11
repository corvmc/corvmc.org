# NNNN Every band gets a subdomain; premium gets its own domain

- **Date:** 2026-08-10
- **Status:** Accepted

## Context

Band microsites launched at `{slug}.corvmc.org` as a premium feature. One wildcard DNS record covers
every subdomain, so a subdomain costs nothing to give away. A band's own domain needs a Cloudflare
for SaaS custom hostname per band, which is billed past the first 100, and brings support load.
Bands print their address on one-sheets, but `update()` re-derived the slug from the name on every
rename, so a rename moved the subdomain, the directory profile and every bookmark.

## Decision

1. **Every band has `{slug}.corvmc.org`.** A premium band's subdomain serves its microsite; any other
   302s to its public page. The tier check is a `handle` in `hooks.server.ts`, because `reroute`
   runs in the browser and has no database.
2. **A custom domain is the premium feature.** `custom-domain-service.ts` creates a Cloudflare custom
   hostname with TXT validation, so the band proves ownership and gets a certificate before cutting
   DNS over. `reroute` resolves custom hosts through `/api/host-route`, cached in KV for five
   minutes.
3. **A rename does not move the address.** The owner changes it explicitly with `changeBandSlug`,
   at most three times in 30 days. A taken address is refused rather than suffixed.
4. **Released addresses forward with a 302** through `group_slug_history`, until another group
   claims the slug. One lookup, `resolveBandSlug`, serves every redirect site.

## Alternatives rejected

- **Subdomains as the premium feature.** They cost nothing, and the free tier needs an address to
  hand out.
- **HTTP validation for custom hostnames.** The live site would be down between the DNS change and
  the certificate.
- **301 for a released address.** A cached permanent redirect cannot be taken back when another band
  claims the slug.
- **`ensureUniqueSlug` for a chosen address.** Handing an owner `theneons-2` when they asked for
  `theneons` is worse than saying it is taken.

## Consequences

- A band whose listing is not public redirects to a profile that 404s; visibility is enforced once,
  in `getPublicBandProfile`.
- A band that lapses from premium falls back to its profile with no cleanup job.
- Writes keyed on a slug still 404 on an old address, because a thrown redirect would discard the
  submitted form.
- `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ZONE_ID` are required for custom domains; without them the
  feature reports itself unavailable.
