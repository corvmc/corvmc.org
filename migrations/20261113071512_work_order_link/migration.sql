CREATE TABLE `work_order_link` (
	`id` text PRIMARY KEY,
	`work_order_id` text NOT NULL,
	`organization_id` text,
	`contact_id` text,
	`asset_id` text,
	`reservation_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_work_order_link_work_order_id_work_order_id_fk` FOREIGN KEY (`work_order_id`) REFERENCES `work_order`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_work_order_link_organization_id_organization_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_work_order_link_contact_id_contact_id_fk` FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_work_order_link_asset_id_inventory_asset_id_fk` FOREIGN KEY (`asset_id`) REFERENCES `inventory_asset`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_work_order_link_reservation_id_reservation_id_fk` FOREIGN KEY (`reservation_id`) REFERENCES `reservation`(`id`) ON DELETE CASCADE,
	CONSTRAINT "work_order_link_one_target" CHECK((organization_id is not null) + (contact_id is not null) + (asset_id is not null) + (reservation_id is not null) = 1)
);
--> statement-breakpoint
CREATE INDEX `idx_work_order_link_work_order` ON `work_order_link` (`work_order_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_work_order_link_organization` ON `work_order_link` (`organization_id`,`work_order_id`) WHERE organization_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_work_order_link_contact` ON `work_order_link` (`contact_id`,`work_order_id`) WHERE contact_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_work_order_link_asset` ON `work_order_link` (`asset_id`,`work_order_id`) WHERE asset_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_work_order_link_reservation` ON `work_order_link` (`reservation_id`,`work_order_id`) WHERE reservation_id is not null;