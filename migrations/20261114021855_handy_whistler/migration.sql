CREATE TABLE `campaign_send` (
	`id` text PRIMARY KEY,
	`campaign_id` text NOT NULL,
	`subscriber_id` text,
	`audience_id` text,
	`email` text NOT NULL,
	`status` text NOT NULL,
	`provider_message_id` text,
	`error` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_campaign_send_campaign_id_campaign_id_fk` FOREIGN KEY (`campaign_id`) REFERENCES `campaign`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_campaign_send_subscriber_id_subscriber_id_fk` FOREIGN KEY (`subscriber_id`) REFERENCES `subscriber`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_campaign_send_audience_id_audience_id_fk` FOREIGN KEY (`audience_id`) REFERENCES `audience`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX `idx_campaign_send_campaign` ON `campaign_send` (`campaign_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_campaign_send_message` ON `campaign_send` (`provider_message_id`);--> statement-breakpoint
CREATE INDEX `idx_campaign_send_subscriber` ON `campaign_send` (`subscriber_id`);