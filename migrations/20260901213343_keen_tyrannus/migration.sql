CREATE TABLE `purchase_order` (
	`id` text PRIMARY KEY,
	`status` text DEFAULT 'draft' NOT NULL,
	`supplier_name` text,
	`reference` text,
	`placed_at` integer,
	`expected_at` integer,
	`created_by_user_id` text,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_purchase_order_created_by_user_id_user_id_fk` FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `purchase_order_line` (
	`id` text PRIMARY KEY,
	`order_id` text NOT NULL,
	`item_id` text NOT NULL,
	`quantity_ordered` integer NOT NULL,
	`unit_cost_cents` integer,
	`quantity_received` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_purchase_order_line_order_id_purchase_order_id_fk` FOREIGN KEY (`order_id`) REFERENCES `purchase_order`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_purchase_order_line_item_id_inventory_item_id_fk` FOREIGN KEY (`item_id`) REFERENCES `inventory_item`(`id`) ON DELETE RESTRICT,
	CONSTRAINT "po_line_qty_positive" CHECK(quantity_ordered > 0),
	CONSTRAINT "po_line_received_sane" CHECK(quantity_received >= 0)
);
--> statement-breakpoint
ALTER TABLE `acquisition` ADD `purchase_order_id` text;--> statement-breakpoint
CREATE INDEX `idx_purchase_order_status` ON `purchase_order` (`status`);--> statement-breakpoint
CREATE INDEX `idx_purchase_order_expected` ON `purchase_order` (`expected_at`);--> statement-breakpoint
CREATE INDEX `idx_po_line_order` ON `purchase_order_line` (`order_id`);--> statement-breakpoint
CREATE INDEX `idx_po_line_item` ON `purchase_order_line` (`item_id`);