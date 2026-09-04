CREATE TABLE `member_orientation` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL UNIQUE,
	`work_order_id` text,
	`reservation_id` text,
	`scheduled_for` integer,
	`completed_at` integer,
	`completed_by_user_id` text,
	`waived_at` integer,
	`waived_reason` text,
	`waived_by_user_id` text,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_member_orientation_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_member_orientation_work_order_id_work_order_id_fk` FOREIGN KEY (`work_order_id`) REFERENCES `work_order`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_member_orientation_reservation_id_reservation_id_fk` FOREIGN KEY (`reservation_id`) REFERENCES `reservation`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_member_orientation_completed_by_user_id_user_id_fk` FOREIGN KEY (`completed_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_member_orientation_waived_by_user_id_user_id_fk` FOREIGN KEY (`waived_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT "member_orientation_waived_has_reason" CHECK((waived_at is null) = (waived_reason is null))
);
--> statement-breakpoint
ALTER TABLE `duty_list` ADD `subject` text DEFAULT 'event' NOT NULL;--> statement-breakpoint
ALTER TABLE `duty_list` ADD `auto_apply_on` text;--> statement-breakpoint
ALTER TABLE `work_order` ADD `reservation_id` text REFERENCES reservation(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_duty_list_auto_apply` ON `duty_list` (`auto_apply_on`) WHERE auto_apply_on is not null;--> statement-breakpoint
CREATE INDEX `member_orientation_scheduled_idx` ON `member_orientation` (`scheduled_for`) WHERE completed_at is null;--> statement-breakpoint
CREATE INDEX `work_order_reservation_idx` ON `work_order` (`reservation_id`);