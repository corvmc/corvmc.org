-- Phase 2 of docs/specs/groups-spec.md. The roster follows the table it belongs
-- to: `band_member` becomes `group_member` and `band_slug_history` becomes
-- `group_slug_history`, both keeping every row. `group.id` is `band.id`, so
-- `group_id` holds exactly what `band_id` held and nothing is repointed.
--
-- Six ALTERs and nothing else is the whole point. `drizzle-kit generate` defaults
-- every one of its six prompts to "create", which here would emit
-- DROP TABLE `band_member` and lose the roster — and unlike phase 1, nothing
-- downstream would catch it: `d1-safe-rebuild.mjs --check` only fails a DROP on a
-- table that has foreign-key children, and nothing references band_member.id.
-- The prompts were driven through a pty and answered by matching the option text.
--
-- Index and constraint names keep their `band` prefix (idx_band_member_user,
-- band_member_band_user_unique, ...). SQLite carries indexes through RENAME TO
-- untouched and rewrites their column references through RENAME COLUMN, so
-- renaming them would turn these free ALTERs into a table rebuild for no gain.
--
-- `updated_at` is nullable, unlike every other `updated_at` in the schema:
-- SQLite refuses `ADD COLUMN` with a non-constant default, so `(unixepoch())` is
-- unavailable here. Null means "no update recorded since the rename".
ALTER TABLE `band_member` RENAME TO `group_member`;--> statement-breakpoint
ALTER TABLE `band_slug_history` RENAME TO `group_slug_history`;--> statement-breakpoint
ALTER TABLE `group_member` RENAME COLUMN `band_id` TO `group_id`;--> statement-breakpoint
ALTER TABLE `group_slug_history` RENAME COLUMN `band_id` TO `group_id`;--> statement-breakpoint
ALTER TABLE `group_member` ADD `notify_announcements` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `group_member` ADD `updated_at` integer;