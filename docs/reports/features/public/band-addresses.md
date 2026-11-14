# Band addresses

Status: ✅ {slug}.corvmc.org (all bands) + custom domains

**Every** band gets `{slug}.corvmc.org` free: premium bands serve their microsite there, everyone else is 302'd to `/directory/bands/{slug}` by the `handleBandSubdomain` gate in `src/hooks.server.ts`. Premium bands can also connect their own domain via Cloudflare for SaaS custom hostnames (`custom-domain-service.ts`, TXT validation, band-facing DNS records on `/band/[slug]/settings`); custom hosts resolve through `/api/host-route` from the async `reroute`. Needs `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ZONE_ID`, else the feature reports itself unavailable. See `docs/decisions/0025-every-band-gets-a-subdomain-premium-gets-a-domain.md`
