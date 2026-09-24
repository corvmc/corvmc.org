CREATE TABLE `wishlist_pledge` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`expires_at` integer NOT NULL,
	`closed_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_wishlist_pledge_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `idx_wishlist_pledge_subject` ON `wishlist_pledge` (`subject_type`,`subject_id`);--> statement-breakpoint
CREATE INDEX `idx_wishlist_pledge_user` ON `wishlist_pledge` (`user_id`);