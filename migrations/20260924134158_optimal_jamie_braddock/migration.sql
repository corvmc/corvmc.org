CREATE TABLE `renewal` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`issuer` text,
	`reference` text,
	`expires_on` text NOT NULL,
	`responsible_user_id` text,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_renewal_responsible_user_id_user_id_fk` FOREIGN KEY (`responsible_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX `renewal_expires_on_idx` ON `renewal` (`expires_on`);