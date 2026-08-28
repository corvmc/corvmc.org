-- Backfill `band_site` from the premium columns on `group`, and point
-- `band_page_config` and `band_media` at it.
--
-- Run AFTER the migration that creates `band_site`, and BEFORE the phase-3b
-- readers deploy:
--
--   wrangler d1 execute corvmc-db --local  --file=scripts/db/backfill/band-site.sql
--   wrangler d1 execute corvmc-db --remote --file=scripts/db/backfill/band-site.sql
--
-- Not a migration, for the reason `scripts/db/backfill/member-standing.sql`
-- gives: migrations come from a schema diff and would drop the old columns in
-- the same breath as creating the new table. Create → backfill → drop across
-- phases is what makes the data survive. Nothing is dropped here.
--
-- D1 has no transactions, so idempotence is the safety property. The insert
-- skips groups that already have a site; the two updates only ever fill a NULL,
-- so re-running cannot move a row that has already been re-keyed.
-- `scripts/db/backfill/band-site.spec.ts` asserts both of those.
--
-- `group` is a SQL reserved word and is quoted throughout.

-- One site per band, carrying the columns it takes over.
--
-- `kind = 'band'` is deliberate, and the opposite of the choice
-- `directory-entry.sql` makes: a club or committee is a CMC program and cannot
-- buy a microsite, so it gets no row. Every group is a band today, so this
-- changes nothing yet — it is here so a re-run after phase 5 does not hand a
-- committee a site record.
--
-- The row is created for FREE bands too, not just premium. `tier` lives here
-- now and every band has one, so a row that only existed while a subscription
-- was live would mean every tier read needed a fallback — and, worse, deleting
-- it on cancellation would cascade `band_page_config` and `band_media` away,
-- destroying a band's blocks, theme, CSS, EPK and images because a card lapsed.
INSERT INTO band_site (
	id, group_id, tier, subscription, custom_domain, custom_domain_status,
	custom_domain_hostname_id, custom_domain_verification, custom_domain_added_at,
	created_at, updated_at
)
SELECT
	lower(
		hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' ||
		substr(hex(randomblob(2)), 2) || '-' ||
		substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) ||
		'-' || hex(randomblob(6))
	),
	g.id,
	g.tier,
	g.subscription,
	g.custom_domain,
	g.custom_domain_status,
	g.custom_domain_hostname_id,
	g.custom_domain_verification,
	g.custom_domain_added_at,
	g.created_at,
	g.updated_at
FROM "group" g
WHERE g.kind = 'band'
  AND NOT EXISTS (SELECT 1 FROM band_site s WHERE s.group_id = g.id);

-- Re-key the microsite's children through `group_id`, which is the mapping the
-- fresh `band_site.id` deliberately does not expose to the application. Both
-- updates fill a NULL only, so a second run is a no-op rather than a rewrite.
UPDATE band_page_config
   SET band_site_id = (SELECT s.id FROM band_site s WHERE s.group_id = band_page_config.band_id)
 WHERE band_site_id IS NULL;

UPDATE band_media
   SET band_site_id = (SELECT s.id FROM band_site s WHERE s.group_id = band_media.band_id)
 WHERE band_site_id IS NULL;
