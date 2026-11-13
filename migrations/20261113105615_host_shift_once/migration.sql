ALTER TABLE `work_order` ADD `is_host` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `work_order_event_host_idx` ON `work_order` (`event_id`) WHERE is_host = 1;