-- Phase 6 of docs/specs/groups-spec.md. `platform_invite` becomes `group_invite`,
-- keeping every row. The old name promised a platform-level invitation it never
-- was: `band_id` was NOT NULL and the role was a group role, so each row already
-- invited one person to one roster.
--
-- Both `drizzle-kit generate` prompts default to "create", which here would emit
-- DROP TABLE `platform_invite` and lose every outstanding invitation. Nothing
-- downstream would catch it — `d1-safe-rebuild.mjs --check` only fails a DROP on
-- a table with foreign-key children, and nothing references platform_invite.id.
-- The prompts were driven through a pty and answered by matching the option text.
--
-- The rebuild that follows the two ALTERs is `invited_by_id` becoming nullable,
-- which SQLite cannot do in place. It is also the fix for a live defect: the
-- column was declared NOT NULL *and* ON DELETE SET NULL, so deleting a user who
-- had ever sent an invite failed on a NOT NULL violation. The INSERT ... SELECT
-- carries the rows across.
--
-- `idx_group_invite_pending` is new: one live invitation per address per roster,
-- partial on `status = 'pending'` so accepted and revoked rows accumulate freely.
-- It replaces a SELECT-then-INSERT in `createInvite` that two admins inviting the
-- same person could interleave.
--
-- The two `DROP INDEX IF EXISTS` below are already no-ops by the time they run —
-- SQLite drops a table's indexes with the table, and the rebuild dropped it.
ALTER TABLE `platform_invite` RENAME TO `group_invite`;--> statement-breakpoint
ALTER TABLE `group_invite` RENAME COLUMN `band_id` TO `group_id`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_group_invite` (
	`id` text PRIMARY KEY,
	`email` text NOT NULL,
	`token` text NOT NULL UNIQUE,
	`group_id` text NOT NULL,
	`role` text NOT NULL,
	`position` text,
	`invited_by_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`accepted_at` integer,
	CONSTRAINT `fk_platform_invite_band_id_band_id_fk` FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_platform_invite_invited_by_id_user_id_fk` FOREIGN KEY (`invited_by_id`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
INSERT INTO `__new_group_invite`(`id`, `email`, `token`, `group_id`, `role`, `position`, `invited_by_id`, `status`, `expires_at`, `created_at`, `accepted_at`) SELECT `id`, `email`, `token`, `group_id`, `role`, `position`, `invited_by_id`, `status`, `expires_at`, `created_at`, `accepted_at` FROM `group_invite`;--> statement-breakpoint
DROP TABLE `group_invite`;--> statement-breakpoint
ALTER TABLE `__new_group_invite` RENAME TO `group_invite`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
DROP INDEX IF EXISTS `idx_platform_invite_email`;--> statement-breakpoint
DROP INDEX IF EXISTS `idx_platform_invite_band`;--> statement-breakpoint
CREATE INDEX `idx_group_invite_email` ON `group_invite` (`email`);--> statement-breakpoint
CREATE INDEX `idx_group_invite_group` ON `group_invite` (`group_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_group_invite_pending` ON `group_invite` (`group_id`,`email`) WHERE status = 'pending';