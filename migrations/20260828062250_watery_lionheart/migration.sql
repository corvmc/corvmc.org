CREATE TABLE `inventory_item_article` (
	`id` text PRIMARY KEY,
	`item_id` text NOT NULL,
	`article_id` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_inventory_item_article_item_id_inventory_item_id_fk` FOREIGN KEY (`item_id`) REFERENCES `inventory_item`(`id`) ON DELETE CASCADE,
	CONSTRAINT `uniq_item_article` UNIQUE(`item_id`,`article_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_item_article_item` ON `inventory_item_article` (`item_id`);