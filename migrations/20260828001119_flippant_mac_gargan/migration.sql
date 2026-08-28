CREATE TABLE `media` (
	`id` text PRIMARY KEY,
	`key` text NOT NULL,
	`content_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`filename` text,
	`alt_text` text,
	`caption` text,
	`uploaded_by_user_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_media_uploaded_by_user_id_user_id_fk` FOREIGN KEY (`uploaded_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `media_attachment` (
	`id` text PRIMARY KEY,
	`media_id` text NOT NULL,
	`attachable_type` text NOT NULL,
	`attachable_id` text NOT NULL,
	`slot` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_media_attachment_media_id_media_id_fk` FOREIGN KEY (`media_id`) REFERENCES `media`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_media_key` ON `media` (`key`);--> statement-breakpoint
CREATE INDEX `idx_media_attachment_parent` ON `media_attachment` (`attachable_type`,`attachable_id`,`slot`);--> statement-breakpoint
CREATE INDEX `idx_media_attachment_media` ON `media_attachment` (`media_id`);