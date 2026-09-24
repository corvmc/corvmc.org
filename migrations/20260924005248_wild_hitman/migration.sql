CREATE TABLE `moderation_appeal` (
	`id` text PRIMARY KEY,
	`flag_id` text NOT NULL,
	`appellant_user_id` text,
	`body` text NOT NULL,
	`content_outcome` text,
	`standing_outcome` text,
	`decision_notes` text,
	`decided_by_user_id` text,
	`decided_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_moderation_appeal_flag_id_content_flag_id_fk` FOREIGN KEY (`flag_id`) REFERENCES `content_flag`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_moderation_appeal_appellant_user_id_user_id_fk` FOREIGN KEY (`appellant_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_moderation_appeal_decided_by_user_id_user_id_fk` FOREIGN KEY (`decided_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
ALTER TABLE `content_flag` ADD `origin` text DEFAULT 'report' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_moderation_appeal_flag` ON `moderation_appeal` (`flag_id`);--> statement-breakpoint
CREATE INDEX `idx_moderation_appeal_decided_at` ON `moderation_appeal` (`decided_at`);--> statement-breakpoint
CREATE INDEX `idx_moderation_appeal_appellant` ON `moderation_appeal` (`appellant_user_id`);