CREATE TABLE `directory_entry_link` (
	`id` text PRIMARY KEY,
	`entry_id` text NOT NULL,
	`token` text NOT NULL UNIQUE,
	`email` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_by_id` text,
	`last_used_at` integer,
	`revoked_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_directory_entry_link_entry_id_directory_entry_id_fk` FOREIGN KEY (`entry_id`) REFERENCES `directory_entry`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_directory_entry_link_created_by_id_user_id_fk` FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX `idx_directory_entry_link_entry` ON `directory_entry_link` (`entry_id`);--> statement-breakpoint
CREATE INDEX `idx_directory_entry_link_expires` ON `directory_entry_link` (`expires_at`);