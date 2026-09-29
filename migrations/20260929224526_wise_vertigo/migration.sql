ALTER TABLE `duty_list_item` ADD `title` text;--> statement-breakpoint
ALTER TABLE `duty_list_item` ADD `group_id` text REFERENCES `group`(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `duty_list_item` ADD `done_when` text;--> statement-breakpoint
ALTER TABLE `work_order` ADD `group_id` text REFERENCES `group`(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `work_order` ADD `done_when` text;--> statement-breakpoint
CREATE INDEX `work_order_group_open_idx` ON `work_order` (`group_id`,`due_at`) WHERE group_id is not null and resolved_at is null and cancelled_at is null;