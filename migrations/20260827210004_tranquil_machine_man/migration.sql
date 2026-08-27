CREATE TABLE `acquisition` (
	`id` text PRIMARY KEY,
	`kind` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`source_name` text,
	`donor_user_id` text,
	`reference` text,
	`total_cents` integer,
	`fair_value_cents` integer,
	`fair_value_basis` text,
	`intended_use` text,
	`monetized` integer DEFAULT false NOT NULL,
	`acknowledged_at` integer,
	`appraisal_ref` text,
	`recorded_by_user_id` text,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_acquisition_donor_user_id_user_id_fk` FOREIGN KEY (`donor_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_acquisition_recorded_by_user_id_user_id_fk` FOREIGN KEY (`recorded_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `acquisition_line` (
	`id` text PRIMARY KEY,
	`acquisition_id` text NOT NULL,
	`item_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`unit_value_cents` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_acquisition_line_acquisition_id_acquisition_id_fk` FOREIGN KEY (`acquisition_id`) REFERENCES `acquisition`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_acquisition_line_item_id_inventory_item_id_fk` FOREIGN KEY (`item_id`) REFERENCES `inventory_item`(`id`) ON DELETE RESTRICT,
	CONSTRAINT "acq_line_qty_positive" CHECK(quantity > 0)
);
--> statement-breakpoint
CREATE TABLE `inventory_asset` (
	`id` text PRIMARY KEY,
	`item_id` text NOT NULL,
	`asset_tag` text CONSTRAINT `uniq_asset_tag` UNIQUE,
	`serial_number` text,
	`condition` text NOT NULL,
	`status` text DEFAULT 'in_service' NOT NULL,
	`location_id` text,
	`acquisition_id` text,
	`retired_at` integer,
	`retired_reason` text,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_inventory_asset_item_id_inventory_item_id_fk` FOREIGN KEY (`item_id`) REFERENCES `inventory_item`(`id`) ON DELETE RESTRICT,
	CONSTRAINT `fk_inventory_asset_location_id_inventory_location_id_fk` FOREIGN KEY (`location_id`) REFERENCES `inventory_location`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `inventory_item` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`description` text,
	`category_id` text NOT NULL,
	`kind` text NOT NULL,
	`unit_of_measure` text DEFAULT 'each' NOT NULL,
	`gtin` text,
	`is_loanable` integer DEFAULT true NOT NULL,
	`reorder_point` integer,
	`reorder_quantity` integer,
	`resource_id` text,
	`image_url` text,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`deleted_at` integer,
	CONSTRAINT `fk_inventory_item_category_id_equipment_category_id_fk` FOREIGN KEY (`category_id`) REFERENCES `equipment_category`(`id`) ON DELETE RESTRICT,
	CONSTRAINT "item_reorder_bulk_only" CHECK(reorder_point IS NULL OR kind = 'bulk')
);
--> statement-breakpoint
CREATE TABLE `inventory_loan` (
	`id` text PRIMARY KEY,
	`item_id` text,
	`asset_id` text,
	`user_id` text NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`requested_pickup_date` integer NOT NULL,
	`estimated_return_date` integer,
	`scheduled_pickup_date` integer,
	`due_date` integer,
	`checked_out_at` integer,
	`returned_at` integer,
	`status` text DEFAULT 'requested' NOT NULL,
	`daily_rate_cents` integer,
	`estimated_cost_cents` integer,
	`total_charge_cents` integer,
	`credits_cents` integer,
	`cash_cents` integer,
	`member_notes` text,
	`staff_notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_inventory_loan_item_id_inventory_item_id_fk` FOREIGN KEY (`item_id`) REFERENCES `inventory_item`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_inventory_loan_asset_id_inventory_asset_id_fk` FOREIGN KEY (`asset_id`) REFERENCES `inventory_asset`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_inventory_loan_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE,
	CONSTRAINT "loan_qty_positive" CHECK(quantity > 0)
);
--> statement-breakpoint
CREATE TABLE `inventory_location` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`parent_id` text,
	`display_order` integer DEFAULT 0 NOT NULL,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `stock_movement` (
	`id` text PRIMARY KEY,
	`item_id` text NOT NULL,
	`asset_id` text,
	`quantity` integer NOT NULL,
	`reason` text NOT NULL,
	`location_id` text,
	`to_location_id` text,
	`actor_id` text,
	`occurred_at` integer DEFAULT (unixepoch()) NOT NULL,
	`loan_id` text,
	`acquisition_id` text,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_stock_movement_item_id_inventory_item_id_fk` FOREIGN KEY (`item_id`) REFERENCES `inventory_item`(`id`) ON DELETE RESTRICT,
	CONSTRAINT `fk_stock_movement_asset_id_inventory_asset_id_fk` FOREIGN KEY (`asset_id`) REFERENCES `inventory_asset`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_stock_movement_location_id_inventory_location_id_fk` FOREIGN KEY (`location_id`) REFERENCES `inventory_location`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_stock_movement_to_location_id_inventory_location_id_fk` FOREIGN KEY (`to_location_id`) REFERENCES `inventory_location`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_stock_movement_actor_id_user_id_fk` FOREIGN KEY (`actor_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT "movement_qty_nonzero" CHECK(quantity != 0)
);
--> statement-breakpoint
CREATE INDEX `idx_acquisition_kind` ON `acquisition` (`kind`);--> statement-breakpoint
CREATE INDEX `idx_acquisition_occurred` ON `acquisition` (`occurred_at`);--> statement-breakpoint
CREATE INDEX `idx_acquisition_donor` ON `acquisition` (`donor_user_id`);--> statement-breakpoint
CREATE INDEX `idx_acq_line_acquisition` ON `acquisition_line` (`acquisition_id`);--> statement-breakpoint
CREATE INDEX `idx_acq_line_item` ON `acquisition_line` (`item_id`);--> statement-breakpoint
CREATE INDEX `idx_asset_item` ON `inventory_asset` (`item_id`);--> statement-breakpoint
CREATE INDEX `idx_asset_status` ON `inventory_asset` (`status`);--> statement-breakpoint
CREATE INDEX `idx_asset_location` ON `inventory_asset` (`location_id`);--> statement-breakpoint
CREATE INDEX `idx_asset_acquisition` ON `inventory_asset` (`acquisition_id`);--> statement-breakpoint
CREATE INDEX `idx_item_category` ON `inventory_item` (`category_id`);--> statement-breakpoint
CREATE INDEX `idx_item_kind` ON `inventory_item` (`kind`);--> statement-breakpoint
CREATE INDEX `idx_item_gtin` ON `inventory_item` (`gtin`) WHERE gtin IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_item_resource_id` ON `inventory_item` (`resource_id`) WHERE resource_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_loan_item` ON `inventory_loan` (`item_id`);--> statement-breakpoint
CREATE INDEX `idx_loan_asset` ON `inventory_loan` (`asset_id`);--> statement-breakpoint
CREATE INDEX `idx_loan_user` ON `inventory_loan` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_loan_status` ON `inventory_loan` (`status`);--> statement-breakpoint
CREATE INDEX `idx_location_parent` ON `inventory_location` (`parent_id`);--> statement-breakpoint
CREATE INDEX `idx_movement_item` ON `stock_movement` (`item_id`);--> statement-breakpoint
CREATE INDEX `idx_movement_asset` ON `stock_movement` (`asset_id`);--> statement-breakpoint
CREATE INDEX `idx_movement_occurred` ON `stock_movement` (`occurred_at`);--> statement-breakpoint
CREATE INDEX `idx_movement_reason` ON `stock_movement` (`reason`);--> statement-breakpoint
CREATE INDEX `idx_movement_loan` ON `stock_movement` (`loan_id`);--> statement-breakpoint
CREATE INDEX `idx_movement_acquisition` ON `stock_movement` (`acquisition_id`);