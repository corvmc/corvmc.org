CREATE TABLE `audio_release` (
	`id` text PRIMARY KEY,
	`group_id` text NOT NULL,
	`title` text NOT NULL,
	`slug` text NOT NULL,
	`kind` text DEFAULT 'single' NOT NULL,
	`description` text,
	`released_at` integer,
	`status` text DEFAULT 'draft' NOT NULL,
	`price_min_cents` integer DEFAULT 0 NOT NULL,
	`allow_pay_more` integer DEFAULT true NOT NULL,
	`radio_opt_in` integer DEFAULT false NOT NULL,
	`radio_excluded_at` integer,
	`radio_excluded_reason` text,
	`published_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`deleted_at` integer,
	CONSTRAINT `fk_audio_release_group_id_group_id_fk` FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `audio_track` (
	`id` text PRIMARY KEY,
	`release_id` text NOT NULL,
	`title` text NOT NULL,
	`track_number` integer NOT NULL,
	`duration_ms` integer NOT NULL,
	`object_key` text NOT NULL,
	`content_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`original_filename` text,
	`isrc` text,
	`radio_excluded_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_audio_track_release_id_audio_release_id_fk` FOREIGN KEY (`release_id`) REFERENCES `audio_release`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `band_stripe_account` (
	`group_id` text PRIMARY KEY,
	`stripe_account_id` text NOT NULL,
	`charges_enabled` integer DEFAULT false NOT NULL,
	`payouts_enabled` integer DEFAULT false NOT NULL,
	`details_submitted` integer DEFAULT false NOT NULL,
	`requirements_json` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_band_stripe_account_group_id_group_id_fk` FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `radio_play` (
	`id` text PRIMARY KEY,
	`track_id` text NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_radio_play_track_id_audio_track_id_fk` FOREIGN KEY (`track_id`) REFERENCES `audio_track`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `release_purchase` (
	`id` text PRIMARY KEY,
	`release_id` text NOT NULL,
	`user_id` text,
	`buyer_email` text NOT NULL,
	`purchase_id` text NOT NULL,
	`amount_paid_cents` integer NOT NULL,
	`platform_fee_cents` integer NOT NULL,
	`band_net_cents` integer NOT NULL,
	`fee_covered_cents` integer DEFAULT 0 NOT NULL,
	`stripe_payment_intent_id` text,
	`stripe_payment_record_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`download_token` text NOT NULL,
	`download_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`paid_at` integer,
	CONSTRAINT `fk_release_purchase_release_id_audio_release_id_fk` FOREIGN KEY (`release_id`) REFERENCES `audio_release`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_release_purchase_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_audio_release_group_slug` ON `audio_release` (`group_id`,`slug`);--> statement-breakpoint
CREATE INDEX `idx_audio_release_group` ON `audio_release` (`group_id`);--> statement-breakpoint
CREATE INDEX `idx_audio_release_status` ON `audio_release` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_audio_track_release_number` ON `audio_track` (`release_id`,`track_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_audio_track_key` ON `audio_track` (`object_key`);--> statement-breakpoint
CREATE INDEX `idx_radio_play_starts` ON `radio_play` (`starts_at`);--> statement-breakpoint
CREATE INDEX `idx_radio_play_track` ON `radio_play` (`track_id`,`starts_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_release_purchase_token` ON `release_purchase` (`download_token`);--> statement-breakpoint
CREATE INDEX `idx_release_purchase_release` ON `release_purchase` (`release_id`);--> statement-breakpoint
CREATE INDEX `idx_release_purchase_user` ON `release_purchase` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_release_purchase_email` ON `release_purchase` (`buyer_email`);--> statement-breakpoint
CREATE INDEX `idx_release_purchase_status` ON `release_purchase` (`status`,`created_at`);