ALTER TABLE `volunteer_shift` ADD `cancelled_by_user_id` text REFERENCES user(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `volunteer_signup` ADD `notified_at` integer;