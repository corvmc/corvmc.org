ALTER TABLE `production_slot` ADD `paid_cents` integer;--> statement-breakpoint
ALTER TABLE `production_slot` ADD `paid_at` integer;--> statement-breakpoint
ALTER TABLE `production_slot` ADD `paid_by_user_id` text REFERENCES user(id) ON DELETE SET NULL;