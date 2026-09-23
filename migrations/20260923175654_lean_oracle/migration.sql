ALTER TABLE `user` ADD `banned_at` integer;--> statement-breakpoint
ALTER TABLE `user` ADD `banned_by_id` text;--> statement-breakpoint
ALTER TABLE `user` ADD `ban_reason` text;