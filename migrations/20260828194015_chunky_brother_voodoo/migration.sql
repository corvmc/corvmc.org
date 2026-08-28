-- d1-safe-rebuild: rewritten for Cloudflare D1.
-- D1 ignores PRAGMA foreign_keys=OFF inside its migration transaction, so
-- drizzle's generated DROP TABLE would cascade-delete these children:
--   event_band, ticket, event_rsvp, volunteer_hour_log, volunteer_shift_feedback, volunteer_signup, volunteer_shift, event, group_member, group_slug_history, directory_tag, directory_entry, band_site, platform_invite
-- Each is rebuilt with its FK demoted to NO ACTION, then restored below.
PRAGMA defer_foreign_keys=ON;
--> statement-breakpoint
-- detach event_band
CREATE TABLE `__detach_event_band` (
	`id` text PRIMARY KEY,
	`event_id` text NOT NULL,
	`name` text NOT NULL,
	`band_id` text,
	`billing_order` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'unlinked' NOT NULL,
	`note` text,
	`added_by_band_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_event_band_event_id_event_id_fk` FOREIGN KEY (`event_id`) REFERENCES `event`(`id`),
	CONSTRAINT `fk_event_band_band_id_band_id_fk` FOREIGN KEY (`band_id`) REFERENCES `group`(`id`),
	CONSTRAINT `fk_event_band_added_by_band_id_band_id_fk` FOREIGN KEY (`added_by_band_id`) REFERENCES `group`(`id`)
);
--> statement-breakpoint
INSERT INTO `__detach_event_band`(`id`, `event_id`, `name`, `band_id`, `billing_order`, `status`, `note`, `added_by_band_id`, `created_at`) SELECT `id`, `event_id`, `name`, `band_id`, `billing_order`, `status`, `note`, `added_by_band_id`, `created_at` FROM `event_band`;
--> statement-breakpoint
DROP TABLE `event_band`;
--> statement-breakpoint
ALTER TABLE `__detach_event_band` RENAME TO `event_band`;
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_event_band_event_band` ON `event_band` (`event_id`,`band_id`) WHERE band_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX `idx_event_band_band_status` ON `event_band` (`band_id`,`status`);
--> statement-breakpoint
CREATE INDEX `idx_event_band_event_order` ON `event_band` (`event_id`,`billing_order`);
--> statement-breakpoint
-- detach ticket
CREATE TABLE `__detach_ticket` (
	`id` text PRIMARY KEY,
	`event_id` text NOT NULL,
	`purchase_id` text NOT NULL,
	`user_id` text,
	`attendee_name` text NOT NULL,
	`attendee_email` text NOT NULL,
	`code` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`stripe_payment_record_id` text,
	`checked_in_at` integer,
	`checked_in_by_user_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `ticket_code_unique` UNIQUE(`code`),
	CONSTRAINT `fk_ticket_event_id_event_id_fk` FOREIGN KEY (`event_id`) REFERENCES `event`(`id`),
	CONSTRAINT `fk_ticket_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_ticket_checked_in_by_user_id_user_id_fk` FOREIGN KEY (`checked_in_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
INSERT INTO `__detach_ticket`(`id`, `event_id`, `purchase_id`, `user_id`, `attendee_name`, `attendee_email`, `code`, `status`, `stripe_payment_record_id`, `checked_in_at`, `checked_in_by_user_id`, `created_at`, `updated_at`) SELECT `id`, `event_id`, `purchase_id`, `user_id`, `attendee_name`, `attendee_email`, `code`, `status`, `stripe_payment_record_id`, `checked_in_at`, `checked_in_by_user_id`, `created_at`, `updated_at` FROM `ticket`;
--> statement-breakpoint
DROP TABLE `ticket`;
--> statement-breakpoint
ALTER TABLE `__detach_ticket` RENAME TO `ticket`;
--> statement-breakpoint
CREATE INDEX `idx_ticket_event` ON `ticket` (`event_id`);
--> statement-breakpoint
CREATE INDEX `idx_ticket_purchase` ON `ticket` (`purchase_id`);
--> statement-breakpoint
CREATE INDEX `idx_ticket_user` ON `ticket` (`user_id`);
--> statement-breakpoint
CREATE INDEX `idx_ticket_event_status` ON `ticket` (`event_id`,`status`);
--> statement-breakpoint
-- detach event_rsvp
CREATE TABLE `__detach_event_rsvp` (
	`id` text PRIMARY KEY,
	`event_id` text NOT NULL,
	`user_id` text NOT NULL,
	`attendee_name` text NOT NULL,
	`attendee_email` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_event_rsvp_event_id_event_id_fk` FOREIGN KEY (`event_id`) REFERENCES `event`(`id`),
	CONSTRAINT `fk_event_rsvp_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `__detach_event_rsvp`(`id`, `event_id`, `user_id`, `attendee_name`, `attendee_email`, `created_at`) SELECT `id`, `event_id`, `user_id`, `attendee_name`, `attendee_email`, `created_at` FROM `event_rsvp`;
--> statement-breakpoint
DROP TABLE `event_rsvp`;
--> statement-breakpoint
ALTER TABLE `__detach_event_rsvp` RENAME TO `event_rsvp`;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_event_rsvp_event_user` ON `event_rsvp` (`event_id`,`user_id`);
--> statement-breakpoint
CREATE INDEX `idx_event_rsvp_event` ON `event_rsvp` (`event_id`);
--> statement-breakpoint
-- detach volunteer_hour_log
CREATE TABLE `__detach_volunteer_hour_log` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`volunteer_role_id` text NOT NULL,
	`shift_id` text,
	`worked_on` integer NOT NULL,
	`minutes` integer NOT NULL,
	`description` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`reviewed_by_user_id` text,
	`reviewed_at` integer,
	`review_notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_volunteer_hour_log_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_volunteer_hour_log_volunteer_role_id_volunteer_role_id_fk` FOREIGN KEY (`volunteer_role_id`) REFERENCES `volunteer_role`(`id`) ON DELETE RESTRICT,
	CONSTRAINT `fk_volunteer_hour_log_shift_id_volunteer_shift_id_fk` FOREIGN KEY (`shift_id`) REFERENCES `volunteer_shift`(`id`),
	CONSTRAINT `fk_volunteer_hour_log_reviewed_by_user_id_user_id_fk` FOREIGN KEY (`reviewed_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `volunteer_minutes_positive` CHECK(minutes > 0 AND minutes <= 1440)
);
--> statement-breakpoint
INSERT INTO `__detach_volunteer_hour_log`(`id`, `user_id`, `volunteer_role_id`, `shift_id`, `worked_on`, `minutes`, `description`, `status`, `reviewed_by_user_id`, `reviewed_at`, `review_notes`, `created_at`, `updated_at`) SELECT `id`, `user_id`, `volunteer_role_id`, `shift_id`, `worked_on`, `minutes`, `description`, `status`, `reviewed_by_user_id`, `reviewed_at`, `review_notes`, `created_at`, `updated_at` FROM `volunteer_hour_log`;
--> statement-breakpoint
DROP TABLE `volunteer_hour_log`;
--> statement-breakpoint
ALTER TABLE `__detach_volunteer_hour_log` RENAME TO `volunteer_hour_log`;
--> statement-breakpoint
CREATE INDEX `volunteer_hour_log_user_idx` ON `volunteer_hour_log` (`user_id`);
--> statement-breakpoint
CREATE INDEX `volunteer_hour_log_status_idx` ON `volunteer_hour_log` (`status`,`worked_on`);
--> statement-breakpoint
CREATE INDEX `volunteer_hour_log_worked_on_idx` ON `volunteer_hour_log` (`worked_on`);
--> statement-breakpoint
CREATE INDEX `volunteer_hour_log_role_idx` ON `volunteer_hour_log` (`volunteer_role_id`);
--> statement-breakpoint
-- detach volunteer_shift_feedback
CREATE TABLE `__detach_volunteer_shift_feedback` (
	`id` text PRIMARY KEY,
	`signup_id` text NOT NULL,
	`rating` integer NOT NULL,
	`was_set_up` integer NOT NULL,
	`comment` text,
	`submitted_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `volunteer_shift_feedback_signup_id_unique` UNIQUE(`signup_id`),
	CONSTRAINT `fk_volunteer_shift_feedback_signup_id_volunteer_signup_id_fk` FOREIGN KEY (`signup_id`) REFERENCES `volunteer_signup`(`id`),
	CONSTRAINT `volunteer_shift_feedback_rating_range` CHECK(rating >= 1 AND rating <= 5)
);
--> statement-breakpoint
INSERT INTO `__detach_volunteer_shift_feedback`(`id`, `signup_id`, `rating`, `was_set_up`, `comment`, `submitted_at`) SELECT `id`, `signup_id`, `rating`, `was_set_up`, `comment`, `submitted_at` FROM `volunteer_shift_feedback`;
--> statement-breakpoint
DROP TABLE `volunteer_shift_feedback`;
--> statement-breakpoint
ALTER TABLE `__detach_volunteer_shift_feedback` RENAME TO `volunteer_shift_feedback`;
--> statement-breakpoint
CREATE INDEX `volunteer_shift_feedback_submitted_idx` ON `volunteer_shift_feedback` (`submitted_at`);
--> statement-breakpoint
-- detach volunteer_signup
CREATE TABLE `__detach_volunteer_signup` (
	`id` text PRIMARY KEY,
	`shift_id` text NOT NULL,
	`user_id` text NOT NULL,
	`status` text DEFAULT 'claimed' NOT NULL,
	`claimed_at` integer DEFAULT (unixepoch()) NOT NULL,
	`confirmed_at` integer,
	`completed_at` integer,
	`cancelled_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `uq_volunteer_signup` UNIQUE(`shift_id`,`user_id`),
	CONSTRAINT `fk_volunteer_signup_shift_id_volunteer_shift_id_fk` FOREIGN KEY (`shift_id`) REFERENCES `volunteer_shift`(`id`),
	CONSTRAINT `fk_volunteer_signup_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `__detach_volunteer_signup`(`id`, `shift_id`, `user_id`, `status`, `claimed_at`, `confirmed_at`, `completed_at`, `cancelled_at`, `created_at`, `updated_at`) SELECT `id`, `shift_id`, `user_id`, `status`, `claimed_at`, `confirmed_at`, `completed_at`, `cancelled_at`, `created_at`, `updated_at` FROM `volunteer_signup`;
--> statement-breakpoint
DROP TABLE `volunteer_signup`;
--> statement-breakpoint
ALTER TABLE `__detach_volunteer_signup` RENAME TO `volunteer_signup`;
--> statement-breakpoint
CREATE INDEX `volunteer_signup_shift_idx` ON `volunteer_signup` (`shift_id`,`status`);
--> statement-breakpoint
CREATE INDEX `volunteer_signup_user_idx` ON `volunteer_signup` (`user_id`,`status`);
--> statement-breakpoint
-- detach volunteer_shift
CREATE TABLE `__detach_volunteer_shift` (
	`id` text PRIMARY KEY,
	`volunteer_role_id` text NOT NULL,
	`event_id` text,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`capacity` integer DEFAULT 1 NOT NULL,
	`notes` text,
	`cancelled_at` integer,
	`created_by_user_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_volunteer_shift_volunteer_role_id_volunteer_role_id_fk` FOREIGN KEY (`volunteer_role_id`) REFERENCES `volunteer_role`(`id`) ON DELETE RESTRICT,
	CONSTRAINT `fk_volunteer_shift_event_id_event_id_fk` FOREIGN KEY (`event_id`) REFERENCES `event`(`id`),
	CONSTRAINT `fk_volunteer_shift_created_by_user_id_user_id_fk` FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `volunteer_shift_ends_after_start` CHECK(ends_at > starts_at),
	CONSTRAINT `volunteer_shift_capacity_positive` CHECK(capacity > 0)
);
--> statement-breakpoint
INSERT INTO `__detach_volunteer_shift`(`id`, `volunteer_role_id`, `event_id`, `starts_at`, `ends_at`, `capacity`, `notes`, `cancelled_at`, `created_by_user_id`, `created_at`, `updated_at`) SELECT `id`, `volunteer_role_id`, `event_id`, `starts_at`, `ends_at`, `capacity`, `notes`, `cancelled_at`, `created_by_user_id`, `created_at`, `updated_at` FROM `volunteer_shift`;
--> statement-breakpoint
DROP TABLE `volunteer_shift`;
--> statement-breakpoint
ALTER TABLE `__detach_volunteer_shift` RENAME TO `volunteer_shift`;
--> statement-breakpoint
CREATE INDEX `volunteer_shift_upcoming_idx` ON `volunteer_shift` (`starts_at`) WHERE cancelled_at IS NULL;
--> statement-breakpoint
CREATE INDEX `volunteer_shift_role_idx` ON `volunteer_shift` (`volunteer_role_id`);
--> statement-breakpoint
CREATE INDEX `volunteer_shift_event_idx` ON `volunteer_shift` (`event_id`);
--> statement-breakpoint
-- detach event
CREATE TABLE `__detach_event` (
	`id` text PRIMARY KEY,
	`title` text NOT NULL,
	`description` text,
	`starts_at` integer NOT NULL,
	`ends_at` integer,
	`doors_at` integer,
	`status` text DEFAULT 'draft' NOT NULL,
	`published_at` integer,
	`reservation_id` text,
	`poster_key` text,
	`tags` text,
	`ticketing_enabled` integer DEFAULT false NOT NULL,
	`ticket_price` integer,
	`ticket_quantity` integer,
	`band_id` text,
	`source` text DEFAULT 'cmc' NOT NULL,
	`location` text,
	`external_ticket_url` text,
	`recurring_series_id` text,
	`review_notes` text,
	`created_by_user_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_event_reservation_id_reservation_id_fk` FOREIGN KEY (`reservation_id`) REFERENCES `reservation`(`id`),
	CONSTRAINT `fk_event_band_id_band_id_fk` FOREIGN KEY (`band_id`) REFERENCES `group`(`id`),
	CONSTRAINT `fk_event_recurring_series_id_recurring_series_id_fk` FOREIGN KEY (`recurring_series_id`) REFERENCES `recurring_series`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_event_created_by_user_id_user_id_fk` FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE,
	CONSTRAINT `event_time_order` CHECK(ends_at > starts_at),
	CONSTRAINT `event_cmc_needs_end` CHECK(source != 'cmc' OR ends_at IS NOT NULL)
);
--> statement-breakpoint
INSERT INTO `__detach_event`(`id`, `title`, `description`, `starts_at`, `ends_at`, `doors_at`, `status`, `published_at`, `reservation_id`, `poster_key`, `tags`, `ticketing_enabled`, `ticket_price`, `ticket_quantity`, `band_id`, `source`, `location`, `external_ticket_url`, `recurring_series_id`, `review_notes`, `created_by_user_id`, `created_at`, `updated_at`) SELECT `id`, `title`, `description`, `starts_at`, `ends_at`, `doors_at`, `status`, `published_at`, `reservation_id`, `poster_key`, `tags`, `ticketing_enabled`, `ticket_price`, `ticket_quantity`, `band_id`, `source`, `location`, `external_ticket_url`, `recurring_series_id`, `review_notes`, `created_by_user_id`, `created_at`, `updated_at` FROM `event`;
--> statement-breakpoint
DROP TABLE `event`;
--> statement-breakpoint
ALTER TABLE `__detach_event` RENAME TO `event`;
--> statement-breakpoint
CREATE INDEX `idx_event_status_starts` ON `event` (`status`,`starts_at`);
--> statement-breakpoint
CREATE INDEX `idx_event_reservation` ON `event` (`reservation_id`);
--> statement-breakpoint
CREATE INDEX `idx_event_band` ON `event` (`band_id`);
--> statement-breakpoint
CREATE INDEX `idx_event_source` ON `event` (`source`,`status`,`starts_at`);
--> statement-breakpoint
CREATE INDEX `idx_event_recurring_series` ON `event` (`recurring_series_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_event_recurring_instance` ON `event` (`recurring_series_id`,`starts_at`) WHERE recurring_series_id IS NOT NULL AND status != 'cancelled';
--> statement-breakpoint
-- detach group_member
CREATE TABLE `__detach_group_member` (
	`id` text PRIMARY KEY,
	`group_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`position` text,
	`alias` text,
	`status` text NOT NULL,
	`notify_announcements` integer DEFAULT true NOT NULL,
	`invited_by_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer,
	CONSTRAINT `band_member_band_user_unique` UNIQUE(`group_id`,`user_id`),
	CONSTRAINT `fk_band_member_band_id_band_id_fk` FOREIGN KEY (`group_id`) REFERENCES `group`(`id`),
	CONSTRAINT `fk_band_member_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_band_member_invited_by_id_user_id_fk` FOREIGN KEY (`invited_by_id`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
INSERT INTO `__detach_group_member`(`id`, `group_id`, `user_id`, `role`, `position`, `alias`, `status`, `notify_announcements`, `invited_by_id`, `created_at`, `updated_at`) SELECT `id`, `group_id`, `user_id`, `role`, `position`, `alias`, `status`, `notify_announcements`, `invited_by_id`, `created_at`, `updated_at` FROM `group_member`;
--> statement-breakpoint
DROP TABLE `group_member`;
--> statement-breakpoint
ALTER TABLE `__detach_group_member` RENAME TO `group_member`;
--> statement-breakpoint
CREATE INDEX `idx_band_member_user` ON `group_member` (`user_id`);
--> statement-breakpoint
CREATE INDEX `idx_band_member_status` ON `group_member` (`status`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_band_member_single_owner` ON `group_member` (`group_id`) WHERE role = 'owner';
--> statement-breakpoint
-- detach group_slug_history
CREATE TABLE `__detach_group_slug_history` (
	`id` text PRIMARY KEY,
	`slug` text NOT NULL,
	`group_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_band_slug_history_band_id_band_id_fk` FOREIGN KEY (`group_id`) REFERENCES `group`(`id`)
);
--> statement-breakpoint
INSERT INTO `__detach_group_slug_history`(`id`, `slug`, `group_id`, `created_at`) SELECT `id`, `slug`, `group_id`, `created_at` FROM `group_slug_history`;
--> statement-breakpoint
DROP TABLE `group_slug_history`;
--> statement-breakpoint
ALTER TABLE `__detach_group_slug_history` RENAME TO `group_slug_history`;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_band_slug_history_slug` ON `group_slug_history` (`slug`);
--> statement-breakpoint
CREATE INDEX `idx_band_slug_history_band` ON `group_slug_history` (`group_id`);
--> statement-breakpoint
-- detach directory_tag
CREATE TABLE `__detach_directory_tag` (
	`entry_id` text NOT NULL,
	`kind` text NOT NULL,
	`value` text NOT NULL,
	CONSTRAINT `directory_tag_entry_kind_value_unique` UNIQUE(`entry_id`,`kind`,`value`),
	CONSTRAINT `fk_directory_tag_entry_id_directory_entry_id_fk` FOREIGN KEY (`entry_id`) REFERENCES `directory_entry`(`id`)
);
--> statement-breakpoint
INSERT INTO `__detach_directory_tag`(`entry_id`, `kind`, `value`) SELECT `entry_id`, `kind`, `value` FROM `directory_tag`;
--> statement-breakpoint
DROP TABLE `directory_tag`;
--> statement-breakpoint
ALTER TABLE `__detach_directory_tag` RENAME TO `directory_tag`;
--> statement-breakpoint
CREATE INDEX `idx_directory_tag_entry` ON `directory_tag` (`entry_id`);
--> statement-breakpoint
CREATE INDEX `idx_directory_tag_kind_value` ON `directory_tag` (`kind`,`value`);
--> statement-breakpoint
-- detach directory_entry
CREATE TABLE `__detach_directory_entry` (
	`id` text PRIMARY KEY,
	`user_id` text,
	`group_id` text,
	`name` text NOT NULL,
	`bio` text,
	`tagline` text,
	`hometown` text,
	`founded_year` text,
	`avatar_key` text,
	`links` text,
	`visibility` text DEFAULT 'public' NOT NULL,
	`contact` text,
	`looking_for` text,
	`available_for_hire` integer DEFAULT false NOT NULL,
	`teaches_lessons` integer DEFAULT false NOT NULL,
	`open_to_collaboration` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`deleted_at` integer,
	CONSTRAINT `fk_directory_entry_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_directory_entry_group_id_group_id_fk` FOREIGN KEY (`group_id`) REFERENCES `group`(`id`)
);
--> statement-breakpoint
INSERT INTO `__detach_directory_entry`(`id`, `user_id`, `group_id`, `name`, `bio`, `tagline`, `hometown`, `founded_year`, `avatar_key`, `links`, `visibility`, `contact`, `looking_for`, `available_for_hire`, `teaches_lessons`, `open_to_collaboration`, `created_at`, `updated_at`, `deleted_at`) SELECT `id`, `user_id`, `group_id`, `name`, `bio`, `tagline`, `hometown`, `founded_year`, `avatar_key`, `links`, `visibility`, `contact`, `looking_for`, `available_for_hire`, `teaches_lessons`, `open_to_collaboration`, `created_at`, `updated_at`, `deleted_at` FROM `directory_entry`;
--> statement-breakpoint
DROP TABLE `directory_entry`;
--> statement-breakpoint
ALTER TABLE `__detach_directory_entry` RENAME TO `directory_entry`;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_directory_entry_user` ON `directory_entry` (`user_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_directory_entry_group` ON `directory_entry` (`group_id`);
--> statement-breakpoint
CREATE INDEX `idx_directory_entry_visibility` ON `directory_entry` (`visibility`);
--> statement-breakpoint
-- detach band_site
CREATE TABLE `__detach_band_site` (
	`id` text PRIMARY KEY,
	`group_id` text NOT NULL,
	`tier` text DEFAULT 'free' NOT NULL,
	`subscription` text,
	`custom_domain` text,
	`custom_domain_status` text,
	`custom_domain_hostname_id` text,
	`custom_domain_verification` text,
	`custom_domain_added_at` integer,
	`theme` text DEFAULT 'default' NOT NULL,
	`custom_css` text,
	`blocks` text DEFAULT '[]' NOT NULL,
	`epk` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_band_site_group_id_group_id_fk` FOREIGN KEY (`group_id`) REFERENCES `group`(`id`)
);
--> statement-breakpoint
INSERT INTO `__detach_band_site`(`id`, `group_id`, `tier`, `subscription`, `custom_domain`, `custom_domain_status`, `custom_domain_hostname_id`, `custom_domain_verification`, `custom_domain_added_at`, `theme`, `custom_css`, `blocks`, `epk`, `created_at`, `updated_at`) SELECT `id`, `group_id`, `tier`, `subscription`, `custom_domain`, `custom_domain_status`, `custom_domain_hostname_id`, `custom_domain_verification`, `custom_domain_added_at`, `theme`, `custom_css`, `blocks`, `epk`, `created_at`, `updated_at` FROM `band_site`;
--> statement-breakpoint
DROP TABLE `band_site`;
--> statement-breakpoint
ALTER TABLE `__detach_band_site` RENAME TO `band_site`;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_band_site_group` ON `band_site` (`group_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_band_site_custom_domain` ON `band_site` (`custom_domain`);
--> statement-breakpoint
CREATE INDEX `idx_band_site_tier` ON `band_site` (`tier`);
--> statement-breakpoint
-- detach platform_invite
CREATE TABLE `__detach_platform_invite` (
	`id` text PRIMARY KEY,
	`email` text NOT NULL,
	`token` text NOT NULL,
	`band_id` text NOT NULL,
	`role` text NOT NULL,
	`position` text,
	`invited_by_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`accepted_at` integer,
	CONSTRAINT `platform_invite_token_unique` UNIQUE(`token`),
	CONSTRAINT `fk_platform_invite_band_id_band_id_fk` FOREIGN KEY (`band_id`) REFERENCES `group`(`id`),
	CONSTRAINT `fk_platform_invite_invited_by_id_user_id_fk` FOREIGN KEY (`invited_by_id`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
INSERT INTO `__detach_platform_invite`(`id`, `email`, `token`, `band_id`, `role`, `position`, `invited_by_id`, `status`, `expires_at`, `created_at`, `accepted_at`) SELECT `id`, `email`, `token`, `band_id`, `role`, `position`, `invited_by_id`, `status`, `expires_at`, `created_at`, `accepted_at` FROM `platform_invite`;
--> statement-breakpoint
DROP TABLE `platform_invite`;
--> statement-breakpoint
ALTER TABLE `__detach_platform_invite` RENAME TO `platform_invite`;
--> statement-breakpoint
CREATE INDEX `idx_platform_invite_email` ON `platform_invite` (`email`);
--> statement-breakpoint
CREATE INDEX `idx_platform_invite_band` ON `platform_invite` (`band_id`);
--> statement-breakpoint
CREATE TABLE `__new_group` (
	`id` text PRIMARY KEY,
	`kind` text DEFAULT 'band' NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`bio` text,
	`avatar_key` text,
	`join_policy` text DEFAULT 'invite_only' NOT NULL,
	`join_instructions` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
INSERT INTO `__new_group`(`id`, `kind`, `name`, `slug`, `bio`, `avatar_key`, `join_policy`, `join_instructions`, `created_at`, `updated_at`, `deleted_at`) SELECT `id`, `kind`, `name`, `slug`, `bio`, `avatar_key`, `join_policy`, `join_instructions`, `created_at`, `updated_at`, `deleted_at` FROM `group`;
--> statement-breakpoint
DROP TABLE `group`;
--> statement-breakpoint
ALTER TABLE `__new_group` RENAME TO `group`;
--> statement-breakpoint
CREATE INDEX `idx_band_slug` ON `group` (`slug`);
--> statement-breakpoint
-- reattach platform_invite
CREATE TABLE `__reattach_platform_invite` (
	`id` text PRIMARY KEY,
	`email` text NOT NULL,
	`token` text NOT NULL,
	`band_id` text NOT NULL,
	`role` text NOT NULL,
	`position` text,
	`invited_by_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`accepted_at` integer,
	CONSTRAINT `platform_invite_token_unique` UNIQUE(`token`),
	CONSTRAINT `fk_platform_invite_band_id_band_id_fk` FOREIGN KEY (`band_id`) REFERENCES `group`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_platform_invite_invited_by_id_user_id_fk` FOREIGN KEY (`invited_by_id`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
INSERT INTO `__reattach_platform_invite`(`id`, `email`, `token`, `band_id`, `role`, `position`, `invited_by_id`, `status`, `expires_at`, `created_at`, `accepted_at`) SELECT `id`, `email`, `token`, `band_id`, `role`, `position`, `invited_by_id`, `status`, `expires_at`, `created_at`, `accepted_at` FROM `platform_invite`;
--> statement-breakpoint
DROP TABLE `platform_invite`;
--> statement-breakpoint
ALTER TABLE `__reattach_platform_invite` RENAME TO `platform_invite`;
--> statement-breakpoint
CREATE INDEX `idx_platform_invite_email` ON `platform_invite` (`email`);
--> statement-breakpoint
CREATE INDEX `idx_platform_invite_band` ON `platform_invite` (`band_id`);
--> statement-breakpoint
-- reattach band_site
CREATE TABLE `__reattach_band_site` (
	`id` text PRIMARY KEY,
	`group_id` text NOT NULL,
	`tier` text DEFAULT 'free' NOT NULL,
	`subscription` text,
	`custom_domain` text,
	`custom_domain_status` text,
	`custom_domain_hostname_id` text,
	`custom_domain_verification` text,
	`custom_domain_added_at` integer,
	`theme` text DEFAULT 'default' NOT NULL,
	`custom_css` text,
	`blocks` text DEFAULT '[]' NOT NULL,
	`epk` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_band_site_group_id_group_id_fk` FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `__reattach_band_site`(`id`, `group_id`, `tier`, `subscription`, `custom_domain`, `custom_domain_status`, `custom_domain_hostname_id`, `custom_domain_verification`, `custom_domain_added_at`, `theme`, `custom_css`, `blocks`, `epk`, `created_at`, `updated_at`) SELECT `id`, `group_id`, `tier`, `subscription`, `custom_domain`, `custom_domain_status`, `custom_domain_hostname_id`, `custom_domain_verification`, `custom_domain_added_at`, `theme`, `custom_css`, `blocks`, `epk`, `created_at`, `updated_at` FROM `band_site`;
--> statement-breakpoint
DROP TABLE `band_site`;
--> statement-breakpoint
ALTER TABLE `__reattach_band_site` RENAME TO `band_site`;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_band_site_group` ON `band_site` (`group_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_band_site_custom_domain` ON `band_site` (`custom_domain`);
--> statement-breakpoint
CREATE INDEX `idx_band_site_tier` ON `band_site` (`tier`);
--> statement-breakpoint
-- reattach directory_entry
CREATE TABLE `__reattach_directory_entry` (
	`id` text PRIMARY KEY,
	`user_id` text,
	`group_id` text,
	`name` text NOT NULL,
	`bio` text,
	`tagline` text,
	`hometown` text,
	`founded_year` text,
	`avatar_key` text,
	`links` text,
	`visibility` text DEFAULT 'public' NOT NULL,
	`contact` text,
	`looking_for` text,
	`available_for_hire` integer DEFAULT false NOT NULL,
	`teaches_lessons` integer DEFAULT false NOT NULL,
	`open_to_collaboration` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`deleted_at` integer,
	CONSTRAINT `fk_directory_entry_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_directory_entry_group_id_group_id_fk` FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `__reattach_directory_entry`(`id`, `user_id`, `group_id`, `name`, `bio`, `tagline`, `hometown`, `founded_year`, `avatar_key`, `links`, `visibility`, `contact`, `looking_for`, `available_for_hire`, `teaches_lessons`, `open_to_collaboration`, `created_at`, `updated_at`, `deleted_at`) SELECT `id`, `user_id`, `group_id`, `name`, `bio`, `tagline`, `hometown`, `founded_year`, `avatar_key`, `links`, `visibility`, `contact`, `looking_for`, `available_for_hire`, `teaches_lessons`, `open_to_collaboration`, `created_at`, `updated_at`, `deleted_at` FROM `directory_entry`;
--> statement-breakpoint
DROP TABLE `directory_entry`;
--> statement-breakpoint
ALTER TABLE `__reattach_directory_entry` RENAME TO `directory_entry`;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_directory_entry_user` ON `directory_entry` (`user_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_directory_entry_group` ON `directory_entry` (`group_id`);
--> statement-breakpoint
CREATE INDEX `idx_directory_entry_visibility` ON `directory_entry` (`visibility`);
--> statement-breakpoint
-- reattach directory_tag
CREATE TABLE `__reattach_directory_tag` (
	`entry_id` text NOT NULL,
	`kind` text NOT NULL,
	`value` text NOT NULL,
	CONSTRAINT `directory_tag_entry_kind_value_unique` UNIQUE(`entry_id`,`kind`,`value`),
	CONSTRAINT `fk_directory_tag_entry_id_directory_entry_id_fk` FOREIGN KEY (`entry_id`) REFERENCES `directory_entry`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `__reattach_directory_tag`(`entry_id`, `kind`, `value`) SELECT `entry_id`, `kind`, `value` FROM `directory_tag`;
--> statement-breakpoint
DROP TABLE `directory_tag`;
--> statement-breakpoint
ALTER TABLE `__reattach_directory_tag` RENAME TO `directory_tag`;
--> statement-breakpoint
CREATE INDEX `idx_directory_tag_entry` ON `directory_tag` (`entry_id`);
--> statement-breakpoint
CREATE INDEX `idx_directory_tag_kind_value` ON `directory_tag` (`kind`,`value`);
--> statement-breakpoint
-- reattach group_slug_history
CREATE TABLE `__reattach_group_slug_history` (
	`id` text PRIMARY KEY,
	`slug` text NOT NULL,
	`group_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_band_slug_history_band_id_band_id_fk` FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `__reattach_group_slug_history`(`id`, `slug`, `group_id`, `created_at`) SELECT `id`, `slug`, `group_id`, `created_at` FROM `group_slug_history`;
--> statement-breakpoint
DROP TABLE `group_slug_history`;
--> statement-breakpoint
ALTER TABLE `__reattach_group_slug_history` RENAME TO `group_slug_history`;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_band_slug_history_slug` ON `group_slug_history` (`slug`);
--> statement-breakpoint
CREATE INDEX `idx_band_slug_history_band` ON `group_slug_history` (`group_id`);
--> statement-breakpoint
-- reattach group_member
CREATE TABLE `__reattach_group_member` (
	`id` text PRIMARY KEY,
	`group_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`position` text,
	`alias` text,
	`status` text NOT NULL,
	`notify_announcements` integer DEFAULT true NOT NULL,
	`invited_by_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer,
	CONSTRAINT `band_member_band_user_unique` UNIQUE(`group_id`,`user_id`),
	CONSTRAINT `fk_band_member_band_id_band_id_fk` FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_band_member_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_band_member_invited_by_id_user_id_fk` FOREIGN KEY (`invited_by_id`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
INSERT INTO `__reattach_group_member`(`id`, `group_id`, `user_id`, `role`, `position`, `alias`, `status`, `notify_announcements`, `invited_by_id`, `created_at`, `updated_at`) SELECT `id`, `group_id`, `user_id`, `role`, `position`, `alias`, `status`, `notify_announcements`, `invited_by_id`, `created_at`, `updated_at` FROM `group_member`;
--> statement-breakpoint
DROP TABLE `group_member`;
--> statement-breakpoint
ALTER TABLE `__reattach_group_member` RENAME TO `group_member`;
--> statement-breakpoint
CREATE INDEX `idx_band_member_user` ON `group_member` (`user_id`);
--> statement-breakpoint
CREATE INDEX `idx_band_member_status` ON `group_member` (`status`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_band_member_single_owner` ON `group_member` (`group_id`) WHERE role = 'owner';
--> statement-breakpoint
-- reattach event
CREATE TABLE `__reattach_event` (
	`id` text PRIMARY KEY,
	`title` text NOT NULL,
	`description` text,
	`starts_at` integer NOT NULL,
	`ends_at` integer,
	`doors_at` integer,
	`status` text DEFAULT 'draft' NOT NULL,
	`published_at` integer,
	`reservation_id` text,
	`poster_key` text,
	`tags` text,
	`ticketing_enabled` integer DEFAULT false NOT NULL,
	`ticket_price` integer,
	`ticket_quantity` integer,
	`band_id` text,
	`source` text DEFAULT 'cmc' NOT NULL,
	`location` text,
	`external_ticket_url` text,
	`recurring_series_id` text,
	`review_notes` text,
	`created_by_user_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_event_reservation_id_reservation_id_fk` FOREIGN KEY (`reservation_id`) REFERENCES `reservation`(`id`),
	CONSTRAINT `fk_event_band_id_band_id_fk` FOREIGN KEY (`band_id`) REFERENCES `group`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_event_recurring_series_id_recurring_series_id_fk` FOREIGN KEY (`recurring_series_id`) REFERENCES `recurring_series`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_event_created_by_user_id_user_id_fk` FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE,
	CONSTRAINT `event_time_order` CHECK(ends_at > starts_at),
	CONSTRAINT `event_cmc_needs_end` CHECK(source != 'cmc' OR ends_at IS NOT NULL)
);
--> statement-breakpoint
INSERT INTO `__reattach_event`(`id`, `title`, `description`, `starts_at`, `ends_at`, `doors_at`, `status`, `published_at`, `reservation_id`, `poster_key`, `tags`, `ticketing_enabled`, `ticket_price`, `ticket_quantity`, `band_id`, `source`, `location`, `external_ticket_url`, `recurring_series_id`, `review_notes`, `created_by_user_id`, `created_at`, `updated_at`) SELECT `id`, `title`, `description`, `starts_at`, `ends_at`, `doors_at`, `status`, `published_at`, `reservation_id`, `poster_key`, `tags`, `ticketing_enabled`, `ticket_price`, `ticket_quantity`, `band_id`, `source`, `location`, `external_ticket_url`, `recurring_series_id`, `review_notes`, `created_by_user_id`, `created_at`, `updated_at` FROM `event`;
--> statement-breakpoint
DROP TABLE `event`;
--> statement-breakpoint
ALTER TABLE `__reattach_event` RENAME TO `event`;
--> statement-breakpoint
CREATE INDEX `idx_event_status_starts` ON `event` (`status`,`starts_at`);
--> statement-breakpoint
CREATE INDEX `idx_event_reservation` ON `event` (`reservation_id`);
--> statement-breakpoint
CREATE INDEX `idx_event_band` ON `event` (`band_id`);
--> statement-breakpoint
CREATE INDEX `idx_event_source` ON `event` (`source`,`status`,`starts_at`);
--> statement-breakpoint
CREATE INDEX `idx_event_recurring_series` ON `event` (`recurring_series_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_event_recurring_instance` ON `event` (`recurring_series_id`,`starts_at`) WHERE recurring_series_id IS NOT NULL AND status != 'cancelled';
--> statement-breakpoint
-- reattach volunteer_shift
CREATE TABLE `__reattach_volunteer_shift` (
	`id` text PRIMARY KEY,
	`volunteer_role_id` text NOT NULL,
	`event_id` text,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`capacity` integer DEFAULT 1 NOT NULL,
	`notes` text,
	`cancelled_at` integer,
	`created_by_user_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_volunteer_shift_volunteer_role_id_volunteer_role_id_fk` FOREIGN KEY (`volunteer_role_id`) REFERENCES `volunteer_role`(`id`) ON DELETE RESTRICT,
	CONSTRAINT `fk_volunteer_shift_event_id_event_id_fk` FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_volunteer_shift_created_by_user_id_user_id_fk` FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `volunteer_shift_ends_after_start` CHECK(ends_at > starts_at),
	CONSTRAINT `volunteer_shift_capacity_positive` CHECK(capacity > 0)
);
--> statement-breakpoint
INSERT INTO `__reattach_volunteer_shift`(`id`, `volunteer_role_id`, `event_id`, `starts_at`, `ends_at`, `capacity`, `notes`, `cancelled_at`, `created_by_user_id`, `created_at`, `updated_at`) SELECT `id`, `volunteer_role_id`, `event_id`, `starts_at`, `ends_at`, `capacity`, `notes`, `cancelled_at`, `created_by_user_id`, `created_at`, `updated_at` FROM `volunteer_shift`;
--> statement-breakpoint
DROP TABLE `volunteer_shift`;
--> statement-breakpoint
ALTER TABLE `__reattach_volunteer_shift` RENAME TO `volunteer_shift`;
--> statement-breakpoint
CREATE INDEX `volunteer_shift_upcoming_idx` ON `volunteer_shift` (`starts_at`) WHERE cancelled_at IS NULL;
--> statement-breakpoint
CREATE INDEX `volunteer_shift_role_idx` ON `volunteer_shift` (`volunteer_role_id`);
--> statement-breakpoint
CREATE INDEX `volunteer_shift_event_idx` ON `volunteer_shift` (`event_id`);
--> statement-breakpoint
-- reattach volunteer_signup
CREATE TABLE `__reattach_volunteer_signup` (
	`id` text PRIMARY KEY,
	`shift_id` text NOT NULL,
	`user_id` text NOT NULL,
	`status` text DEFAULT 'claimed' NOT NULL,
	`claimed_at` integer DEFAULT (unixepoch()) NOT NULL,
	`confirmed_at` integer,
	`completed_at` integer,
	`cancelled_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `uq_volunteer_signup` UNIQUE(`shift_id`,`user_id`),
	CONSTRAINT `fk_volunteer_signup_shift_id_volunteer_shift_id_fk` FOREIGN KEY (`shift_id`) REFERENCES `volunteer_shift`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_volunteer_signup_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `__reattach_volunteer_signup`(`id`, `shift_id`, `user_id`, `status`, `claimed_at`, `confirmed_at`, `completed_at`, `cancelled_at`, `created_at`, `updated_at`) SELECT `id`, `shift_id`, `user_id`, `status`, `claimed_at`, `confirmed_at`, `completed_at`, `cancelled_at`, `created_at`, `updated_at` FROM `volunteer_signup`;
--> statement-breakpoint
DROP TABLE `volunteer_signup`;
--> statement-breakpoint
ALTER TABLE `__reattach_volunteer_signup` RENAME TO `volunteer_signup`;
--> statement-breakpoint
CREATE INDEX `volunteer_signup_shift_idx` ON `volunteer_signup` (`shift_id`,`status`);
--> statement-breakpoint
CREATE INDEX `volunteer_signup_user_idx` ON `volunteer_signup` (`user_id`,`status`);
--> statement-breakpoint
-- reattach volunteer_shift_feedback
CREATE TABLE `__reattach_volunteer_shift_feedback` (
	`id` text PRIMARY KEY,
	`signup_id` text NOT NULL,
	`rating` integer NOT NULL,
	`was_set_up` integer NOT NULL,
	`comment` text,
	`submitted_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `volunteer_shift_feedback_signup_id_unique` UNIQUE(`signup_id`),
	CONSTRAINT `fk_volunteer_shift_feedback_signup_id_volunteer_signup_id_fk` FOREIGN KEY (`signup_id`) REFERENCES `volunteer_signup`(`id`) ON DELETE CASCADE,
	CONSTRAINT `volunteer_shift_feedback_rating_range` CHECK(rating >= 1 AND rating <= 5)
);
--> statement-breakpoint
INSERT INTO `__reattach_volunteer_shift_feedback`(`id`, `signup_id`, `rating`, `was_set_up`, `comment`, `submitted_at`) SELECT `id`, `signup_id`, `rating`, `was_set_up`, `comment`, `submitted_at` FROM `volunteer_shift_feedback`;
--> statement-breakpoint
DROP TABLE `volunteer_shift_feedback`;
--> statement-breakpoint
ALTER TABLE `__reattach_volunteer_shift_feedback` RENAME TO `volunteer_shift_feedback`;
--> statement-breakpoint
CREATE INDEX `volunteer_shift_feedback_submitted_idx` ON `volunteer_shift_feedback` (`submitted_at`);
--> statement-breakpoint
-- reattach volunteer_hour_log
CREATE TABLE `__reattach_volunteer_hour_log` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`volunteer_role_id` text NOT NULL,
	`shift_id` text,
	`worked_on` integer NOT NULL,
	`minutes` integer NOT NULL,
	`description` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`reviewed_by_user_id` text,
	`reviewed_at` integer,
	`review_notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_volunteer_hour_log_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_volunteer_hour_log_volunteer_role_id_volunteer_role_id_fk` FOREIGN KEY (`volunteer_role_id`) REFERENCES `volunteer_role`(`id`) ON DELETE RESTRICT,
	CONSTRAINT `fk_volunteer_hour_log_shift_id_volunteer_shift_id_fk` FOREIGN KEY (`shift_id`) REFERENCES `volunteer_shift`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_volunteer_hour_log_reviewed_by_user_id_user_id_fk` FOREIGN KEY (`reviewed_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `volunteer_minutes_positive` CHECK(minutes > 0 AND minutes <= 1440)
);
--> statement-breakpoint
INSERT INTO `__reattach_volunteer_hour_log`(`id`, `user_id`, `volunteer_role_id`, `shift_id`, `worked_on`, `minutes`, `description`, `status`, `reviewed_by_user_id`, `reviewed_at`, `review_notes`, `created_at`, `updated_at`) SELECT `id`, `user_id`, `volunteer_role_id`, `shift_id`, `worked_on`, `minutes`, `description`, `status`, `reviewed_by_user_id`, `reviewed_at`, `review_notes`, `created_at`, `updated_at` FROM `volunteer_hour_log`;
--> statement-breakpoint
DROP TABLE `volunteer_hour_log`;
--> statement-breakpoint
ALTER TABLE `__reattach_volunteer_hour_log` RENAME TO `volunteer_hour_log`;
--> statement-breakpoint
CREATE INDEX `volunteer_hour_log_user_idx` ON `volunteer_hour_log` (`user_id`);
--> statement-breakpoint
CREATE INDEX `volunteer_hour_log_status_idx` ON `volunteer_hour_log` (`status`,`worked_on`);
--> statement-breakpoint
CREATE INDEX `volunteer_hour_log_worked_on_idx` ON `volunteer_hour_log` (`worked_on`);
--> statement-breakpoint
CREATE INDEX `volunteer_hour_log_role_idx` ON `volunteer_hour_log` (`volunteer_role_id`);
--> statement-breakpoint
-- reattach event_rsvp
CREATE TABLE `__reattach_event_rsvp` (
	`id` text PRIMARY KEY,
	`event_id` text NOT NULL,
	`user_id` text NOT NULL,
	`attendee_name` text NOT NULL,
	`attendee_email` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_event_rsvp_event_id_event_id_fk` FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_event_rsvp_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `__reattach_event_rsvp`(`id`, `event_id`, `user_id`, `attendee_name`, `attendee_email`, `created_at`) SELECT `id`, `event_id`, `user_id`, `attendee_name`, `attendee_email`, `created_at` FROM `event_rsvp`;
--> statement-breakpoint
DROP TABLE `event_rsvp`;
--> statement-breakpoint
ALTER TABLE `__reattach_event_rsvp` RENAME TO `event_rsvp`;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_event_rsvp_event_user` ON `event_rsvp` (`event_id`,`user_id`);
--> statement-breakpoint
CREATE INDEX `idx_event_rsvp_event` ON `event_rsvp` (`event_id`);
--> statement-breakpoint
-- reattach ticket
CREATE TABLE `__reattach_ticket` (
	`id` text PRIMARY KEY,
	`event_id` text NOT NULL,
	`purchase_id` text NOT NULL,
	`user_id` text,
	`attendee_name` text NOT NULL,
	`attendee_email` text NOT NULL,
	`code` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`stripe_payment_record_id` text,
	`checked_in_at` integer,
	`checked_in_by_user_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `ticket_code_unique` UNIQUE(`code`),
	CONSTRAINT `fk_ticket_event_id_event_id_fk` FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_ticket_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_ticket_checked_in_by_user_id_user_id_fk` FOREIGN KEY (`checked_in_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
INSERT INTO `__reattach_ticket`(`id`, `event_id`, `purchase_id`, `user_id`, `attendee_name`, `attendee_email`, `code`, `status`, `stripe_payment_record_id`, `checked_in_at`, `checked_in_by_user_id`, `created_at`, `updated_at`) SELECT `id`, `event_id`, `purchase_id`, `user_id`, `attendee_name`, `attendee_email`, `code`, `status`, `stripe_payment_record_id`, `checked_in_at`, `checked_in_by_user_id`, `created_at`, `updated_at` FROM `ticket`;
--> statement-breakpoint
DROP TABLE `ticket`;
--> statement-breakpoint
ALTER TABLE `__reattach_ticket` RENAME TO `ticket`;
--> statement-breakpoint
CREATE INDEX `idx_ticket_event` ON `ticket` (`event_id`);
--> statement-breakpoint
CREATE INDEX `idx_ticket_purchase` ON `ticket` (`purchase_id`);
--> statement-breakpoint
CREATE INDEX `idx_ticket_user` ON `ticket` (`user_id`);
--> statement-breakpoint
CREATE INDEX `idx_ticket_event_status` ON `ticket` (`event_id`,`status`);
--> statement-breakpoint
-- reattach event_band
CREATE TABLE `__reattach_event_band` (
	`id` text PRIMARY KEY,
	`event_id` text NOT NULL,
	`name` text NOT NULL,
	`band_id` text,
	`billing_order` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'unlinked' NOT NULL,
	`note` text,
	`added_by_band_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_event_band_event_id_event_id_fk` FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_event_band_band_id_band_id_fk` FOREIGN KEY (`band_id`) REFERENCES `group`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_event_band_added_by_band_id_band_id_fk` FOREIGN KEY (`added_by_band_id`) REFERENCES `group`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
INSERT INTO `__reattach_event_band`(`id`, `event_id`, `name`, `band_id`, `billing_order`, `status`, `note`, `added_by_band_id`, `created_at`) SELECT `id`, `event_id`, `name`, `band_id`, `billing_order`, `status`, `note`, `added_by_band_id`, `created_at` FROM `event_band`;
--> statement-breakpoint
DROP TABLE `event_band`;
--> statement-breakpoint
ALTER TABLE `__reattach_event_band` RENAME TO `event_band`;
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_event_band_event_band` ON `event_band` (`event_id`,`band_id`) WHERE band_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX `idx_event_band_band_status` ON `event_band` (`band_id`,`status`);
--> statement-breakpoint
CREATE INDEX `idx_event_band_event_order` ON `event_band` (`event_id`,`billing_order`);
--> statement-breakpoint
PRAGMA defer_foreign_keys=OFF;
