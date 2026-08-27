CREATE TABLE `directory_entry` (
	`id` text PRIMARY KEY,
	`user_id` text,
	`group_id` text,
	`name` text NOT NULL,
	`bio` text,
	`tagline` text,
	`hometown` text,
	`founded_year` text,
	`avatar_key` text,
	`links` text,
	`visibility` text DEFAULT 'public' NOT NULL,
	`contact` text,
	`looking_for` text,
	`available_for_hire` integer DEFAULT false NOT NULL,
	`teaches_lessons` integer DEFAULT false NOT NULL,
	`open_to_collaboration` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`deleted_at` integer,
	CONSTRAINT `fk_directory_entry_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_directory_entry_group_id_group_id_fk` FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `directory_tag` (
	`entry_id` text NOT NULL,
	`kind` text NOT NULL,
	`value` text NOT NULL,
	CONSTRAINT `fk_directory_tag_entry_id_directory_entry_id_fk` FOREIGN KEY (`entry_id`) REFERENCES `directory_entry`(`id`) ON DELETE CASCADE,
	CONSTRAINT `directory_tag_entry_kind_value_unique` UNIQUE(`entry_id`,`kind`,`value`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_directory_entry_user` ON `directory_entry` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_directory_entry_group` ON `directory_entry` (`group_id`);--> statement-breakpoint
CREATE INDEX `idx_directory_entry_visibility` ON `directory_entry` (`visibility`);--> statement-breakpoint
CREATE INDEX `idx_directory_tag_entry` ON `directory_tag` (`entry_id`);--> statement-breakpoint
CREATE INDEX `idx_directory_tag_kind_value` ON `directory_tag` (`kind`,`value`);