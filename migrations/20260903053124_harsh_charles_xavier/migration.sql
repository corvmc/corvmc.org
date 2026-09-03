CREATE TABLE `rider` (
	`id` text PRIMARY KEY,
	`group_id` text NOT NULL,
	`tech_contact_user_id` text,
	`monitor_format` text,
	`notes` text,
	`confirmed_at` integer,
	`confirmed_by_user_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_rider_group_id_group_id_fk` FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_rider_tech_contact_user_id_user_id_fk` FOREIGN KEY (`tech_contact_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_rider_confirmed_by_user_id_user_id_fk` FOREIGN KEY (`confirmed_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `rider_element` (
	`id` text PRIMARY KEY,
	`rider_id` text NOT NULL,
	`user_id` text,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`provided_by` text DEFAULT 'band' NOT NULL,
	`notes` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_rider_element_rider_id_rider_id_fk` FOREIGN KEY (`rider_id`) REFERENCES `rider`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_rider_element_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT "rider_element_sort_nonneg" CHECK(sort_order >= 0)
);
--> statement-breakpoint
CREATE TABLE `rider_input` (
	`id` text PRIMARY KEY,
	`element_id` text NOT NULL,
	`label` text NOT NULL,
	`source` text DEFAULT 'mic' NOT NULL,
	`mic_pref` text,
	`phantom` integer DEFAULT false NOT NULL,
	`stand` text DEFAULT 'none' NOT NULL,
	`monitor_mix_user_id` text,
	`notes` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	CONSTRAINT `fk_rider_input_element_id_rider_element_id_fk` FOREIGN KEY (`element_id`) REFERENCES `rider_element`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_rider_input_monitor_mix_user_id_user_id_fk` FOREIGN KEY (`monitor_mix_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT "rider_input_sort_nonneg" CHECK(sort_order >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_rider_group` ON `rider` (`group_id`);--> statement-breakpoint
CREATE INDEX `idx_rider_element_rider` ON `rider_element` (`rider_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `idx_rider_element_user` ON `rider_element` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_rider_input_element` ON `rider_input` (`element_id`,`sort_order`);