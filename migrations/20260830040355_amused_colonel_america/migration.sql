-- Phase 9 of docs/specs/groups-spec.md. Events learn that their owner is a
-- group, and gain a table for who else advertises them.
--
-- `event.band_id` becomes `event.group_id` — a rename, not a repoint: the column
-- already referenced `group.id`, and what changes is only that its name stops
-- naming the wrong table. `drizzle-kit generate` defaults its one prompt to
-- "create", which would have added an empty column beside the old one and
-- orphaned every event from its owner; answered through a pty, as in phases 2
-- and 6.
--
-- No rebuild of `event`, which matters: it has more children than any other
-- table in the schema (ticket, event_rsvp, recurring_series, reservation) and is
-- the riskiest rebuild here. `idx_event_band` keeps its name — SQLite carries an
-- index through RENAME COLUMN and rewrites its column reference, so renaming it
-- would turn a free ALTER into exactly the rebuild being avoided.
--
-- `event_group` is shared advertising, not credit. `event_band` answers "whose
-- name is on the poster"; this answers "whose page does this appear on". The
-- backfill at the end is what lets every read path assume the managing group has
-- a row rather than branching on "sometimes present, sometimes not".
CREATE TABLE `event_group` (
	`id` text PRIMARY KEY,
	`event_id` text NOT NULL,
	`group_id` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_event_group_event_id_event_id_fk` FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_event_group_group_id_group_id_fk` FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `event` RENAME COLUMN `band_id` TO `group_id`;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_event_group_event_group` ON `event_group` (`event_id`,`group_id`);--> statement-breakpoint
CREATE INDEX `idx_event_group_group` ON `event_group` (`group_id`,`sort_order`);
--> statement-breakpoint
-- Every event that already has a managing group gets its row, at sort_order 0.
-- `INSERT ... SELECT` rather than a script: it is one statement, it is
-- idempotent under the unique index, and it runs inside the same migration that
-- creates the invariant it establishes.
INSERT INTO `event_group` (`id`, `event_id`, `group_id`, `sort_order`)
SELECT lower(hex(randomblob(16))), `id`, `group_id`, 0
FROM `event`
WHERE `group_id` IS NOT NULL;
