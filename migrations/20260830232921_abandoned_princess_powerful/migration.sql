-- Phase 10 of docs/specs/groups-spec.md. A lineup credit stops naming a band
-- and starts naming a *party*.
--
-- `event_band` is a credit on one bill — a display name, a billing order, a
-- consent status — and says nothing about the act beyond how it appeared that
-- night. A `directory_entry` is the persistent record of a party, reusable
-- across every event they ever play. Pointing at the entry is what lets one
-- lineup mix bands, solo members and external acts uniformly: no fake band row,
-- and no slug for an act that has no CMC page.
--
-- Additive on purpose. `band_id` stays, still written by every path, read by
-- none — so a mistake in the backfill below is recoverable from a column that is
-- still being maintained. The drop is its own migration, the same shape phase 3a
-- and 3c used and the reason only 3c was irreversible.
ALTER TABLE `event_band` ADD `directory_entry_id` text REFERENCES directory_entry(id) ON DELETE CASCADE;--> statement-breakpoint
-- Every credit that names a CMC band now names that band's entry. This resolves
-- through a lookup rather than carrying the value across, because `band_id`
-- holds a `group.id` and the entry has its own — one of the two re-keys in this
-- spec that is not value-preserving.
--
-- Every group has an entry: phase 3a backfilled one per band and `create()` has
-- written one for every group since. A credit left with a NULL entry here would
-- be a band whose entry went missing, which `event-band-rekey.spec.ts` asserts
-- against on the migrated schema.
UPDATE `event_band`
SET `directory_entry_id` = (
	SELECT `id` FROM `directory_entry` WHERE `directory_entry`.`group_id` = `event_band`.`band_id`
)
WHERE `band_id` IS NOT NULL;--> statement-breakpoint
-- drizzle-kit records these against the new column in its snapshot but emits no
-- statements for them, so without this the database would keep both indexes
-- keyed to `band_id` while the snapshot claimed otherwise. The unique one is
-- what stops a party appearing twice on one bill, so pointing it at the column
-- that is actually read is not cosmetic.
DROP INDEX IF EXISTS `uq_event_band_event_band`;--> statement-breakpoint
DROP INDEX IF EXISTS `idx_event_band_band_status`;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_event_band_event_band` ON `event_band` (`event_id`,`directory_entry_id`) WHERE directory_entry_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_event_band_band_status` ON `event_band` (`directory_entry_id`,`status`);
