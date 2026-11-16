CREATE TABLE `vendor_detail` (
	`organization_id` text PRIMARY KEY,
	`offering` text,
	`tables_needed` integer DEFAULT 1 NOT NULL,
	`needs_power` integer DEFAULT false NOT NULL,
	`brings_own_table` integer DEFAULT false NOT NULL,
	`brings_tent` integer DEFAULT false NOT NULL,
	`setup_notes` text,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_vendor_detail_organization_id_organization_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `market_vendor` ADD `organization_id` text REFERENCES organization(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `market_vendor` ADD `brings_own_table` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `market_vendor` ADD `brings_tent` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_market_vendor_organization` ON `market_vendor` (`organization_id`);