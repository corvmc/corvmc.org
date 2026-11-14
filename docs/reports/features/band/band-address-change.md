# Band address change

Status: ✅ Settings page

Owner-only slug/subdomain change (`band-address-service.ts`), limited to 3 per 30 days. Renaming a band no longer moves its address. Released slugs are recorded in `band_slug_history` and 302 to the band's current address from the subdomain, directory profile, dashboard and microsite — until another band claims the slug. See `docs/decisions/0025-every-band-gets-a-subdomain-premium-gets-a-domain.md`
