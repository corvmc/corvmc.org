ALTER TABLE `reservation` ADD `cancelled_by` text;--> statement-breakpoint
ALTER TABLE `reservation` ADD `cancelled_by_user_id` text REFERENCES user(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `reservation` ADD `cancelled_at` integer;