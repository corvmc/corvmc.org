ALTER TABLE `inbox_thread` ADD `pinned` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `inbox_thread` ADD `published_at` integer;--> statement-breakpoint
ALTER TABLE `inbox_thread` ADD `deleted_at` integer;--> statement-breakpoint
ALTER TABLE `inbox_thread` ADD `notified_at` integer;--> statement-breakpoint
ALTER TABLE `inbox_thread` ADD `recipient_count` integer;--> statement-breakpoint
ALTER TABLE `inbox_thread` ADD `post_policy` text DEFAULT 'members' NOT NULL;--> statement-breakpoint
ALTER TABLE `inbox_thread` ADD `notify_policy` text DEFAULT 'in_app' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_inbox_thread_group_pinned` ON `inbox_thread` (`group_id`,`pinned`,`published_at`);--> statement-breakpoint
CREATE INDEX `idx_inbox_thread_notified` ON `inbox_thread` (`notified_at`);