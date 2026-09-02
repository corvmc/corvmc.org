CREATE TABLE `inbox_thread_tag` (
	`id` text PRIMARY KEY,
	`thread_id` text NOT NULL,
	`tag` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_inbox_thread_tag_thread_id_inbox_thread_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `inbox_thread`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_inbox_thread_tag_unique` ON `inbox_thread_tag` (`thread_id`,`tag`);