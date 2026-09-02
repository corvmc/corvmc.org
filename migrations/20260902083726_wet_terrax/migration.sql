CREATE TABLE `duty_list` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL UNIQUE,
	`description` text,
	`anchor` text DEFAULT 'doors' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_by_user_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_duty_list_created_by_user_id_user_id_fk` FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `duty_list_item` (
	`id` text PRIMARY KEY,
	`duty_list_id` text NOT NULL,
	`volunteer_role_id` text NOT NULL,
	`offset_minutes` integer,
	`duration_minutes` integer,
	`due_offset_minutes` integer,
	`capacity` integer DEFAULT 1 NOT NULL,
	`notes` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`tasks` text DEFAULT '[]' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_duty_list_item_duty_list_id_duty_list_id_fk` FOREIGN KEY (`duty_list_id`) REFERENCES `duty_list`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_duty_list_item_volunteer_role_id_volunteer_role_id_fk` FOREIGN KEY (`volunteer_role_id`) REFERENCES `volunteer_role`(`id`) ON DELETE RESTRICT,
	CONSTRAINT "duty_list_item_window_paired" CHECK((offset_minutes is null) = (duration_minutes is null)),
	CONSTRAINT "duty_list_item_one_shape" CHECK((offset_minutes is null) != (due_offset_minutes is null)),
	CONSTRAINT "duty_list_item_duration_positive" CHECK(duration_minutes is null or duration_minutes > 0),
	CONSTRAINT "duty_list_item_capacity_positive" CHECK(capacity > 0)
);
--> statement-breakpoint
CREATE TABLE `work_task` (
	`id` text PRIMARY KEY,
	`work_order_id` text NOT NULL,
	`label` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`done` integer DEFAULT false NOT NULL,
	`done_at` integer,
	`done_by_user_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_work_task_work_order_id_volunteer_shift_id_fk` FOREIGN KEY (`work_order_id`) REFERENCES `volunteer_shift`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_work_task_done_by_user_id_user_id_fk` FOREIGN KEY (`done_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT "work_task_done_has_time" CHECK((done = 0 and done_at is null) or (done = 1 and done_at is not null))
);
--> statement-breakpoint
ALTER TABLE `volunteer_shift` ADD `duty_list_id` text REFERENCES duty_list(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX `duty_list_active_idx` ON `duty_list` (`is_active`,`name`);--> statement-breakpoint
CREATE INDEX `duty_list_item_list_idx` ON `duty_list_item` (`duty_list_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `work_task_order_idx` ON `work_task` (`work_order_id`,`sort_order`);