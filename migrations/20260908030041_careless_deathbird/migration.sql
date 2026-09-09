CREATE TABLE `packing_item` (
	`id` text PRIMARY KEY,
	`list_id` text NOT NULL,
	`user_id` text,
	`assigned_user_id` text,
	`assigned_at` integer,
	`assigned_by_user_id` text,
	`category` text DEFAULT 'other' NOT NULL,
	`label` text NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`rider_kind` text,
	`notes` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`packed` integer DEFAULT false NOT NULL,
	`packed_at` integer,
	`packed_by_user_id` text,
	`promoted_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_packing_item_list_id_packing_list_id_fk` FOREIGN KEY (`list_id`) REFERENCES `packing_list`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_packing_item_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_packing_item_assigned_user_id_user_id_fk` FOREIGN KEY (`assigned_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_packing_item_assigned_by_user_id_user_id_fk` FOREIGN KEY (`assigned_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_packing_item_packed_by_user_id_user_id_fk` FOREIGN KEY (`packed_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT "packing_item_sort_nonneg" CHECK(sort_order >= 0),
	CONSTRAINT "packing_item_quantity_positive" CHECK(quantity >= 1),
	CONSTRAINT "packing_item_quantity_bounded" CHECK(quantity <= 99)
);
--> statement-breakpoint
CREATE TABLE `packing_list` (
	`id` text PRIMARY KEY,
	`group_id` text NOT NULL,
	`notes` text,
	`last_reset_at` integer,
	`last_reset_by_user_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_packing_list_group_id_group_id_fk` FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_packing_list_last_reset_by_user_id_user_id_fk` FOREIGN KEY (`last_reset_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX `idx_packing_item_list` ON `packing_item` (`list_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `idx_packing_item_user` ON `packing_item` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_packing_item_assigned` ON `packing_item` (`list_id`,`assigned_user_id`);--> statement-breakpoint
CREATE INDEX `idx_packing_item_packed` ON `packing_item` (`list_id`,`packed`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_packing_list_group` ON `packing_list` (`group_id`);