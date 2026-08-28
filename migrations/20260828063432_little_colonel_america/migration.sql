DROP INDEX IF EXISTS `idx_band_custom_domain`;--> statement-breakpoint
ALTER TABLE `group` DROP COLUMN `tier`;--> statement-breakpoint
ALTER TABLE `group` DROP COLUMN `subscription`;--> statement-breakpoint
ALTER TABLE `group` DROP COLUMN `custom_domain`;--> statement-breakpoint
ALTER TABLE `group` DROP COLUMN `custom_domain_status`;--> statement-breakpoint
ALTER TABLE `group` DROP COLUMN `custom_domain_hostname_id`;--> statement-breakpoint
ALTER TABLE `group` DROP COLUMN `custom_domain_verification`;--> statement-breakpoint
ALTER TABLE `group` DROP COLUMN `custom_domain_added_at`;