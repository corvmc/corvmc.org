ALTER TABLE `band_site` ADD `theme` text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE `band_site` ADD `custom_css` text;--> statement-breakpoint
ALTER TABLE `band_site` ADD `blocks` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `band_site` ADD `epk` text;--> statement-breakpoint
-- Carry the microsite across before the table holding it goes. Deliberately in
-- the same file as the ADDs and the DROP, so the columns, their contents and the
-- old table change together — the same reasoning as the `booker_type` update in
-- 20260823195623_band_to_group. Production holds no `band_page_config` rows, so
-- this is a no-op there; it is here so a local or preview database with rows in
-- it does not silently lose them.
UPDATE `band_site`
   SET `theme` = coalesce((SELECT c.`theme` FROM `band_page_config` c WHERE c.`band_site_id` = `band_site`.`id`), `theme`),
       `custom_css` = (SELECT c.`custom_css` FROM `band_page_config` c WHERE c.`band_site_id` = `band_site`.`id`),
       `blocks` = coalesce((SELECT c.`blocks` FROM `band_page_config` c WHERE c.`band_site_id` = `band_site`.`id`), `blocks`),
       `epk` = (SELECT c.`epk` FROM `band_page_config` c WHERE c.`band_site_id` = `band_site`.`id`)
 WHERE EXISTS (SELECT 1 FROM `band_page_config` c WHERE c.`band_site_id` = `band_site`.`id`);--> statement-breakpoint
DROP INDEX IF EXISTS `idx_band_page_config_band`;--> statement-breakpoint
DROP INDEX IF EXISTS `idx_band_page_config_site`;--> statement-breakpoint
DROP TABLE `band_page_config`;