ALTER TABLE `acquisition` ADD `paid_by_user_id` text REFERENCES user(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `acquisition` ADD `reimbursed_at` integer;--> statement-breakpoint
CREATE INDEX `idx_acquisition_paid_by` ON `acquisition` (`paid_by_user_id`);