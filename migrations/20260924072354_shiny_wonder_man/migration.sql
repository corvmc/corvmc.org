CREATE TABLE `classified_post` (
	`id` text PRIMARY KEY,
	`author_user_id` text NOT NULL,
	`group_id` text,
	`kind` text NOT NULL,
	`category` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`visibility` text DEFAULT 'visible' NOT NULL,
	`visibility_note` text,
	`visibility_changed_at` integer,
	`visibility_changed_by_user_id` text,
	`expires_at` integer NOT NULL,
	`closed_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_classified_post_author_user_id_user_id_fk` FOREIGN KEY (`author_user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_classified_post_group_id_group_id_fk` FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_classified_post_visibility_changed_by_user_id_user_id_fk` FOREIGN KEY (`visibility_changed_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `classified_post_tag` (
	`post_id` text NOT NULL,
	`kind` text NOT NULL,
	`value` text NOT NULL,
	CONSTRAINT `fk_classified_post_tag_post_id_classified_post_id_fk` FOREIGN KEY (`post_id`) REFERENCES `classified_post`(`id`) ON DELETE CASCADE,
	CONSTRAINT `classified_post_tag_post_kind_value_unique` UNIQUE(`post_id`,`kind`,`value`)
);
--> statement-breakpoint
CREATE INDEX `classified_post_board_idx` ON `classified_post` (`status`,`visibility`,`expires_at`);--> statement-breakpoint
CREATE INDEX `classified_post_author_idx` ON `classified_post` (`author_user_id`);--> statement-breakpoint
CREATE INDEX `classified_post_group_idx` ON `classified_post` (`group_id`);--> statement-breakpoint
CREATE INDEX `idx_classified_post_tag_kind_value` ON `classified_post_tag` (`kind`,`value`);