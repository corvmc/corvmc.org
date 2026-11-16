ALTER TABLE `work_order_link` ADD `incident_id` text REFERENCES incident(id) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `work_order_link` ADD `inbox_thread_id` text REFERENCES inbox_thread(id) ON DELETE CASCADE;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_work_order_link` (
	`id` text PRIMARY KEY,
	`work_order_id` text NOT NULL,
	`organization_id` text,
	`contact_id` text,
	`asset_id` text,
	`reservation_id` text,
	`item_id` text,
	`incident_id` text,
	`inbox_thread_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_work_order_link_work_order_id_work_order_id_fk` FOREIGN KEY (`work_order_id`) REFERENCES `work_order`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_work_order_link_organization_id_organization_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_work_order_link_contact_id_contact_id_fk` FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_work_order_link_asset_id_inventory_asset_id_fk` FOREIGN KEY (`asset_id`) REFERENCES `inventory_asset`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_work_order_link_reservation_id_reservation_id_fk` FOREIGN KEY (`reservation_id`) REFERENCES `reservation`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_work_order_link_item_id_inventory_item_id_fk` FOREIGN KEY (`item_id`) REFERENCES `inventory_item`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_work_order_link_incident_id_incident_id_fk` FOREIGN KEY (`incident_id`) REFERENCES `incident`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_work_order_link_inbox_thread_id_inbox_thread_id_fk` FOREIGN KEY (`inbox_thread_id`) REFERENCES `inbox_thread`(`id`) ON DELETE CASCADE,
	CONSTRAINT "work_order_link_one_target" CHECK((organization_id is not null) + (contact_id is not null) + (asset_id is not null) + (reservation_id is not null) + (item_id is not null) + (incident_id is not null) + (inbox_thread_id is not null) = 1)
);
--> statement-breakpoint
INSERT INTO `__new_work_order_link`(`id`, `work_order_id`, `organization_id`, `contact_id`, `asset_id`, `reservation_id`, `item_id`, `created_at`) SELECT `id`, `work_order_id`, `organization_id`, `contact_id`, `asset_id`, `reservation_id`, `item_id`, `created_at` FROM `work_order_link`;--> statement-breakpoint
DROP TABLE `work_order_link`;--> statement-breakpoint
ALTER TABLE `__new_work_order_link` RENAME TO `work_order_link`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_work_order_link_work_order` ON `work_order_link` (`work_order_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_work_order_link_organization` ON `work_order_link` (`organization_id`,`work_order_id`) WHERE organization_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_work_order_link_contact` ON `work_order_link` (`contact_id`,`work_order_id`) WHERE contact_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_work_order_link_asset` ON `work_order_link` (`asset_id`,`work_order_id`) WHERE asset_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_work_order_link_reservation` ON `work_order_link` (`reservation_id`,`work_order_id`) WHERE reservation_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_work_order_link_item` ON `work_order_link` (`item_id`,`work_order_id`) WHERE item_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_work_order_link_incident` ON `work_order_link` (`incident_id`,`work_order_id`) WHERE incident_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_work_order_link_inbox_thread` ON `work_order_link` (`inbox_thread_id`,`work_order_id`) WHERE inbox_thread_id is not null;