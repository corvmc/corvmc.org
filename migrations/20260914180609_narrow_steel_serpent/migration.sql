ALTER TABLE `volunteer_signup` ADD `invited_at` integer;--> statement-breakpoint
ALTER TABLE `volunteer_signup` ADD `invited_by_user_id` text REFERENCES user(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `volunteer_signup` ADD `declined_at` integer;