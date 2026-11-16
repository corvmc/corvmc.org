ALTER TABLE `production` ADD `door_cash_counted_by_user_id` text REFERENCES user(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `production` ADD `door_cash_counted_at` integer;--> statement-breakpoint
ALTER TABLE `production` ADD `door_cash_recount_cents` integer;--> statement-breakpoint
ALTER TABLE `production` ADD `door_cash_recounted_by_user_id` text REFERENCES user(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `production` ADD `door_cash_recounted_at` integer;