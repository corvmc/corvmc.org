ALTER TABLE `production` ADD `closed_at` integer;--> statement-breakpoint
ALTER TABLE `production` ADD `closed_by_user_id` text REFERENCES user(id) ON DELETE SET NULL;