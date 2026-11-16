ALTER TABLE `work_order` ADD `position_id` text REFERENCES group_position(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX `work_order_position_idx` ON `work_order` (`position_id`);