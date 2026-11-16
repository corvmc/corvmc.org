CREATE INDEX `work_order_group_idx` ON `work_order` (`group_id`);--> statement-breakpoint
CREATE INDEX `work_order_schedule_idx` ON `work_order` (`maintenance_schedule_id`);