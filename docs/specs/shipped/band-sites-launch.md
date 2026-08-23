# Band Sites Launch

Finishes and hardens the standalone band-website feature so premium bands get a
public microsite at `{slug}.corvmc.org` (reference: churchladies.band — bio,
member roster, shows, contact form, streaming/social links).

## Scope decisions

- **Subdomains only.** Custom domains (Cloudflare for SaaS custom hostnames, a
  `band.customDomain` column, verification flow) are deferred.
- **Real contact form** on band sites, not just `mailto:` links.
- **Multi-band event lineups deferred.** `event.bandId` stays a single FK; a
  co-billed show appears only on the owning band's site.
- **`custom_html` block stays**, sanitized (not removed).

## What already existed

Premium tier + Stripe billing (`band.tier`, $15/mo, yearly = 10 months), block
page editor (14 block types, 7 themes, custom CSS sanitizer), EPK editor +
printable EPK page, `/band-site/[slug]` renderer, subdomain reroute hook, R2
media upload — all behind the `bandPremium` feature flag (off by default).

## What this change adds/fixes

### Security

- **Server-side sanitizer was a silent no-op.** DOMPurify driven by linkedom
  reports `isSupported: undefined` and returns input unchanged, so every
  server-side `sanitizeBio`/`sanitizeHtml`/`renderMarkdown` call did nothing.
  Replaced the engine in `src/lib/utils/markdown.ts` with `js-xss`
  (allowlist-based, pure JS, Workers-safe). Regression specs in
  `src/lib/utils/markdown.spec.ts`.
- `bio`/`custom_html` blocks are sanitized at save
  (`band-page-editor.remote.ts`) **and** at render
  (`src/lib/server/band/band-site-blocks.ts` via `getBandSiteData`).
- Reserved-slug list centralized and expanded (`src/lib/reserved-slugs.ts`),
  enforced in both the reroute hook and band slug generation
  (`ensureUniqueSlug` gained an `isDisallowed` predicate).

### Correctness

- Hero/merch/gallery image keys now resolve to public URLs server-side
  (`prepareBlocksForRender`); gallery blocks honor per-block `imageKeys`
  curation with all-media fallback.
- Internal band-site links work in all three serving modes (real subdomain,
  `?__band_subdomain=` dev override, path-based) via `bandSiteHref` in
  `src/lib/utils/band-site-url.ts`; the dev-only query param no longer leaks
  into production UI.
- Base domain derives from `PUBLIC_SITE_URL` (staging/preview-safe) instead of
  a hardcoded constant.
- Rider/stage-plot uploads accept PDF (per-media-type MIME allowlist); the
  "Download Full Tech Rider (PDF)" link can now actually have a PDF behind it.

### New

- **Contact form** (`contact` block, `showForm` toggle, default on):
  `BandContactForm.svelte` → `submitBandContactForm` in
  `band-site.remote.ts`. Turnstile-verified, KV rate-limited (5/hr per
  band+IP, `src/lib/server/rate-limit.ts`), delivered via the generic
  `notification` Postmark template to the EPK booking contact (fallback: band
  owner). Email-only — submissions are not stored.
- **SEO**: OG/canonical/description meta in the band-site layout; per-band
  `robots.txt` and `sitemap.xml` served on subdomains.
- **Infra**: wildcard zone routes in `wrangler.toml`
  (`corvmc.org/*`, `www.corvmc.org/*`, `*.corvmc.org/*`).

## Rollout checklist (manual ops)

1. Add a proxied wildcard DNS record `*.corvmc.org` in the Cloudflare zone.
2. Deploy (zone routes ship with `wrangler deploy`).
3. Verify `media.corvmc.org` still serves R2 objects (R2 custom-domain routes
   take precedence over Worker routes, but confirm).
4. Enable the `bandPremium` feature flag (site config).
5. Smoke-test a premium band's subdomain: images, nav, EPK, contact form,
   robots.txt, sitemap.xml.

## Deferred / future work

- Custom domains (Cloudflare for SaaS).
- Multi-band event lineups (event↔band junction with billing order).
- Gallery `downloadable` option (cross-origin `download` attribute doesn't
  work; needs a proxied download endpoint).
- Robust media management (see parity-report enhancements).
