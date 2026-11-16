CREATE TABLE `account_removal` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`actor_user_id` text,
	`kind` text NOT NULL,
	`reason` text NOT NULL,
	`flag_id` text NOT NULL,
	`ends_at` integer,
	`ledger` text,
	`lifted_at` integer,
	`lifted_by_user_id` text,
	`lift_reason` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_account_removal_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_account_removal_actor_user_id_user_id_fk` FOREIGN KEY (`actor_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_account_removal_flag_id_content_flag_id_fk` FOREIGN KEY (`flag_id`) REFERENCES `content_flag`(`id`),
	CONSTRAINT `fk_account_removal_lifted_by_user_id_user_id_fk` FOREIGN KEY (`lifted_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `email_blocklist` (
	`id` text PRIMARY KEY,
	`email` text NOT NULL UNIQUE,
	`source` text NOT NULL,
	`note` text,
	`removal_id` text,
	`added_by_user_id` text,
	`refused_count` integer DEFAULT 0 NOT NULL,
	`last_refused_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_email_blocklist_removal_id_account_removal_id_fk` FOREIGN KEY (`removal_id`) REFERENCES `account_removal`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_email_blocklist_added_by_user_id_user_id_fk` FOREIGN KEY (`added_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
ALTER TABLE `moderation_appeal` ADD `account_outcome` text;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_account_removal_open` ON `account_removal` (`user_id`) WHERE lifted_at IS NULL;--> statement-breakpoint
CREATE INDEX `idx_account_removal_flag` ON `account_removal` (`flag_id`);--> statement-breakpoint
CREATE INDEX `idx_account_removal_ends_at` ON `account_removal` (`ends_at`);