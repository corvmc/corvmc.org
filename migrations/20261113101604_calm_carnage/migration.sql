-- d1-safe-rebuild: rewritten for Cloudflare D1.
-- D1 ignores PRAGMA foreign_keys=OFF inside its migration transaction, so
-- drizzle's generated DROP TABLE would cascade-delete these children:
--   production_slot, party_role, inbox_group_read, group_announcement, inbox_message, inbox_note, inbox_participant, inbox_thread_tag, market_vendor, inbox_thread, work_order_link, activity
-- Each is rebuilt with its FK demoted to NO ACTION, then restored below.
PRAGMA defer_foreign_keys=ON;
--> statement-breakpoint
-- detach production_slot
CREATE TABLE `__detach_production_slot` (
	`id` text PRIMARY KEY,
	`production_id` text NOT NULL,
	`event_band_id` text,
	`sort_order` real NOT NULL,
	`set_length_minutes` integer NOT NULL,
	`changeover_minutes` integer DEFAULT 10 NOT NULL,
	`scheduled_start_at` integer,
	`actual_start_at` integer,
	`actual_end_at` integer,
	`soundcheck_at` integer,
	`tech_notes` text,
	`backline_needs` text,
	`hospitality_notes` text,
	`contact_id` text,
	`guarantee_cents` integer,
	`percentage_bps` integer,
	`versus` integer DEFAULT false NOT NULL,
	`against_net` integer DEFAULT false NOT NULL,
	`contributed` integer DEFAULT false NOT NULL,
	`paid_cents` integer,
	`paid_at` integer,
	`paid_by_user_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_production_slot_production_id_production_id_fk` FOREIGN KEY (`production_id`) REFERENCES `production`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_production_slot_event_band_id_event_band_id_fk` FOREIGN KEY (`event_band_id`) REFERENCES `event_band`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_production_slot_contact_id_contact_id_fk` FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`),
	CONSTRAINT `fk_production_slot_paid_by_user_id_user_id_fk` FOREIGN KEY (`paid_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `production_slot_set_length_positive` CHECK(set_length_minutes > 0),
	CONSTRAINT `production_slot_changeover_nonneg` CHECK(changeover_minutes >= 0)
);
--> statement-breakpoint
INSERT INTO `__detach_production_slot`(`id`, `production_id`, `event_band_id`, `sort_order`, `set_length_minutes`, `changeover_minutes`, `scheduled_start_at`, `actual_start_at`, `actual_end_at`, `soundcheck_at`, `tech_notes`, `backline_needs`, `hospitality_notes`, `contact_id`, `guarantee_cents`, `percentage_bps`, `versus`, `against_net`, `contributed`, `paid_cents`, `paid_at`, `paid_by_user_id`, `created_at`, `updated_at`) SELECT `id`, `production_id`, `event_band_id`, `sort_order`, `set_length_minutes`, `changeover_minutes`, `scheduled_start_at`, `actual_start_at`, `actual_end_at`, `soundcheck_at`, `tech_notes`, `backline_needs`, `hospitality_notes`, `contact_id`, `guarantee_cents`, `percentage_bps`, `versus`, `against_net`, `contributed`, `paid_cents`, `paid_at`, `paid_by_user_id`, `created_at`, `updated_at` FROM `production_slot`;
--> statement-breakpoint
DROP TABLE `production_slot`;
--> statement-breakpoint
ALTER TABLE `__detach_production_slot` RENAME TO `production_slot`;
--> statement-breakpoint
CREATE INDEX `idx_production_slot_order` ON `production_slot` (`production_id`,`sort_order`);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_production_slot_event_band` ON `production_slot` (`event_band_id`) WHERE event_band_id is not null;
--> statement-breakpoint
-- detach party_role
CREATE TABLE `__detach_party_role` (
	`id` text PRIMARY KEY,
	`organization_id` text,
	`contact_id` text,
	`role` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_party_role_organization_id_organization_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_party_role_contact_id_contact_id_fk` FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`),
	CONSTRAINT `party_role_one_owner` CHECK((organization_id is null) <> (contact_id is null))
);
--> statement-breakpoint
INSERT INTO `__detach_party_role`(`id`, `organization_id`, `contact_id`, `role`, `created_at`) SELECT `id`, `organization_id`, `contact_id`, `role`, `created_at` FROM `party_role`;
--> statement-breakpoint
DROP TABLE `party_role`;
--> statement-breakpoint
ALTER TABLE `__detach_party_role` RENAME TO `party_role`;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_party_role_organization` ON `party_role` (`organization_id`,`role`) WHERE organization_id is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_party_role_contact` ON `party_role` (`contact_id`,`role`) WHERE contact_id is not null;
--> statement-breakpoint
CREATE INDEX `idx_party_role_role` ON `party_role` (`role`);
--> statement-breakpoint
-- detach inbox_group_read
CREATE TABLE `__detach_inbox_group_read` (
	`id` text PRIMARY KEY,
	`thread_id` text NOT NULL,
	`user_id` text NOT NULL,
	`last_read_at` integer,
	`muted` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_inbox_group_read_thread_id_inbox_thread_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `inbox_thread`(`id`),
	CONSTRAINT `fk_inbox_group_read_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `__detach_inbox_group_read`(`id`, `thread_id`, `user_id`, `last_read_at`, `muted`, `created_at`) SELECT `id`, `thread_id`, `user_id`, `last_read_at`, `muted`, `created_at` FROM `inbox_group_read`;
--> statement-breakpoint
DROP TABLE `inbox_group_read`;
--> statement-breakpoint
ALTER TABLE `__detach_inbox_group_read` RENAME TO `inbox_group_read`;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_inbox_group_read_thread_user` ON `inbox_group_read` (`thread_id`,`user_id`);
--> statement-breakpoint
CREATE INDEX `idx_inbox_group_read_user` ON `inbox_group_read` (`user_id`);
--> statement-breakpoint
-- detach group_announcement
CREATE TABLE `__detach_group_announcement` (
	`id` text PRIMARY KEY,
	`group_id` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`author_user_id` text,
	`author_name` text,
	`pinned` integer DEFAULT false NOT NULL,
	`published_at` integer,
	`message_id` text,
	`notified_at` integer,
	`recipient_count` integer,
	`deleted_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_group_announcement_group_id_group_id_fk` FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_group_announcement_author_user_id_user_id_fk` FOREIGN KEY (`author_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_group_announcement_message_id_inbox_message_id_fk` FOREIGN KEY (`message_id`) REFERENCES `inbox_message`(`id`)
);
--> statement-breakpoint
INSERT INTO `__detach_group_announcement`(`id`, `group_id`, `title`, `body`, `author_user_id`, `author_name`, `pinned`, `published_at`, `message_id`, `notified_at`, `recipient_count`, `deleted_at`, `created_at`, `updated_at`) SELECT `id`, `group_id`, `title`, `body`, `author_user_id`, `author_name`, `pinned`, `published_at`, `message_id`, `notified_at`, `recipient_count`, `deleted_at`, `created_at`, `updated_at` FROM `group_announcement`;
--> statement-breakpoint
DROP TABLE `group_announcement`;
--> statement-breakpoint
ALTER TABLE `__detach_group_announcement` RENAME TO `group_announcement`;
--> statement-breakpoint
CREATE INDEX `idx_group_announcement_group` ON `group_announcement` (`group_id`,`pinned`,`published_at`);
--> statement-breakpoint
-- detach inbox_message
CREATE TABLE `__detach_inbox_message` (
	`id` text PRIMARY KEY,
	`thread_id` text NOT NULL,
	`direction` text NOT NULL,
	`body` text NOT NULL,
	`body_html` text,
	`author_name` text,
	`author_user_id` text,
	`channel_message_id` text,
	`channel_metadata` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_inbox_message_thread_id_inbox_thread_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `inbox_thread`(`id`),
	CONSTRAINT `fk_inbox_message_author_user_id_user_id_fk` FOREIGN KEY (`author_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
INSERT INTO `__detach_inbox_message`(`id`, `thread_id`, `direction`, `body`, `body_html`, `author_name`, `author_user_id`, `channel_message_id`, `channel_metadata`, `created_at`) SELECT `id`, `thread_id`, `direction`, `body`, `body_html`, `author_name`, `author_user_id`, `channel_message_id`, `channel_metadata`, `created_at` FROM `inbox_message`;
--> statement-breakpoint
DROP TABLE `inbox_message`;
--> statement-breakpoint
ALTER TABLE `__detach_inbox_message` RENAME TO `inbox_message`;
--> statement-breakpoint
CREATE INDEX `idx_inbox_message_thread` ON `inbox_message` (`thread_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_inbox_message_channel_id` ON `inbox_message` (`channel_message_id`);
--> statement-breakpoint
-- detach inbox_note
CREATE TABLE `__detach_inbox_note` (
	`id` text PRIMARY KEY,
	`thread_id` text NOT NULL,
	`author_user_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_inbox_note_thread_id_inbox_thread_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `inbox_thread`(`id`),
	CONSTRAINT `fk_inbox_note_author_user_id_user_id_fk` FOREIGN KEY (`author_user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `__detach_inbox_note`(`id`, `thread_id`, `author_user_id`, `body`, `created_at`) SELECT `id`, `thread_id`, `author_user_id`, `body`, `created_at` FROM `inbox_note`;
--> statement-breakpoint
DROP TABLE `inbox_note`;
--> statement-breakpoint
ALTER TABLE `__detach_inbox_note` RENAME TO `inbox_note`;
--> statement-breakpoint
CREATE INDEX `idx_inbox_note_thread` ON `inbox_note` (`thread_id`,`created_at`);
--> statement-breakpoint
-- detach inbox_participant
CREATE TABLE `__detach_inbox_participant` (
	`id` text PRIMARY KEY,
	`thread_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`last_read_at` integer,
	`accepted_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_inbox_participant_thread_id_inbox_thread_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `inbox_thread`(`id`),
	CONSTRAINT `fk_inbox_participant_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `__detach_inbox_participant`(`id`, `thread_id`, `user_id`, `role`, `last_read_at`, `accepted_at`, `created_at`) SELECT `id`, `thread_id`, `user_id`, `role`, `last_read_at`, `accepted_at`, `created_at` FROM `inbox_participant`;
--> statement-breakpoint
DROP TABLE `inbox_participant`;
--> statement-breakpoint
ALTER TABLE `__detach_inbox_participant` RENAME TO `inbox_participant`;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_inbox_participant_thread_user` ON `inbox_participant` (`thread_id`,`user_id`);
--> statement-breakpoint
CREATE INDEX `idx_inbox_participant_user` ON `inbox_participant` (`user_id`);
--> statement-breakpoint
CREATE INDEX `idx_inbox_participant_user_accepted` ON `inbox_participant` (`user_id`,`accepted_at`);
--> statement-breakpoint
-- detach inbox_thread_tag
CREATE TABLE `__detach_inbox_thread_tag` (
	`id` text PRIMARY KEY,
	`thread_id` text NOT NULL,
	`tag` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_inbox_thread_tag_thread_id_inbox_thread_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `inbox_thread`(`id`)
);
--> statement-breakpoint
INSERT INTO `__detach_inbox_thread_tag`(`id`, `thread_id`, `tag`, `created_at`) SELECT `id`, `thread_id`, `tag`, `created_at` FROM `inbox_thread_tag`;
--> statement-breakpoint
DROP TABLE `inbox_thread_tag`;
--> statement-breakpoint
ALTER TABLE `__detach_inbox_thread_tag` RENAME TO `inbox_thread_tag`;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_inbox_thread_tag_unique` ON `inbox_thread_tag` (`thread_id`,`tag`);
--> statement-breakpoint
-- detach market_vendor
CREATE TABLE `__detach_market_vendor` (
	`id` text PRIMARY KEY,
	`event_id` text NOT NULL,
	`thread_id` text,
	`organization_id` text,
	`business_name` text NOT NULL,
	`offering` text NOT NULL,
	`website` text,
	`tables_requested` integer DEFAULT 1 NOT NULL,
	`needs_power` integer DEFAULT false NOT NULL,
	`brings_own_table` integer DEFAULT false NOT NULL,
	`brings_tent` integer DEFAULT false NOT NULL,
	`notes` text,
	`status` text DEFAULT 'applied' NOT NULL,
	`table_label` text,
	`decided_by_user_id` text,
	`decided_at` integer,
	`fee_cents` integer DEFAULT 0 NOT NULL,
	`fee_floor_cents` integer DEFAULT 0 NOT NULL,
	`paid_cents` integer,
	`paid_at` integer,
	`stripe_payment_record_id` text,
	`refunded_at` integer,
	`checked_in_at` integer,
	`invite_back` integer,
	`invite_back_note` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_market_vendor_event_id_event_listing_id_fk` FOREIGN KEY (`event_id`) REFERENCES `event_listing`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_market_vendor_thread_id_inbox_thread_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `inbox_thread`(`id`),
	CONSTRAINT `fk_market_vendor_organization_id_organization_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_market_vendor_decided_by_user_id_user_id_fk` FOREIGN KEY (`decided_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
INSERT INTO `__detach_market_vendor`(`id`, `event_id`, `thread_id`, `organization_id`, `business_name`, `offering`, `website`, `tables_requested`, `needs_power`, `brings_own_table`, `brings_tent`, `notes`, `status`, `table_label`, `decided_by_user_id`, `decided_at`, `fee_cents`, `fee_floor_cents`, `paid_cents`, `paid_at`, `stripe_payment_record_id`, `refunded_at`, `checked_in_at`, `invite_back`, `invite_back_note`, `created_at`, `updated_at`) SELECT `id`, `event_id`, `thread_id`, `organization_id`, `business_name`, `offering`, `website`, `tables_requested`, `needs_power`, `brings_own_table`, `brings_tent`, `notes`, `status`, `table_label`, `decided_by_user_id`, `decided_at`, `fee_cents`, `fee_floor_cents`, `paid_cents`, `paid_at`, `stripe_payment_record_id`, `refunded_at`, `checked_in_at`, `invite_back`, `invite_back_note`, `created_at`, `updated_at` FROM `market_vendor`;
--> statement-breakpoint
DROP TABLE `market_vendor`;
--> statement-breakpoint
ALTER TABLE `__detach_market_vendor` RENAME TO `market_vendor`;
--> statement-breakpoint
CREATE INDEX `idx_market_vendor_event_status` ON `market_vendor` (`event_id`,`status`);
--> statement-breakpoint
CREATE INDEX `idx_market_vendor_organization` ON `market_vendor` (`organization_id`);
--> statement-breakpoint
-- detach inbox_thread
CREATE TABLE `__detach_inbox_thread` (
	`id` text PRIMARY KEY,
	`channel` text NOT NULL,
	`group_id` text,
	`status` text DEFAULT 'open' NOT NULL,
	`subject` text,
	`preview` text,
	`contact_name` text,
	`contact_email` text,
	`contact_phone` text,
	`contact_external_id` text,
	`organization_id` text,
	`contact_id` text,
	`assigned_to_user_id` text,
	`snoozed_until` integer,
	`awaiting_reply_since` integer,
	`undo_state` text,
	`pinned` integer DEFAULT false NOT NULL,
	`published_at` integer,
	`deleted_at` integer,
	`notified_at` integer,
	`recipient_count` integer,
	`post_policy` text DEFAULT 'members' NOT NULL,
	`notify_policy` text DEFAULT 'in_app' NOT NULL,
	`message_count` integer DEFAULT 0 NOT NULL,
	`last_message_at` integer,
	`last_outbound_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_inbox_thread_group_id_group_id_fk` FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_inbox_thread_organization_id_organization_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_inbox_thread_contact_id_contact_id_fk` FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`),
	CONSTRAINT `fk_inbox_thread_assigned_to_user_id_user_id_fk` FOREIGN KEY (`assigned_to_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
INSERT INTO `__detach_inbox_thread`(`id`, `channel`, `group_id`, `status`, `subject`, `preview`, `contact_name`, `contact_email`, `contact_phone`, `contact_external_id`, `organization_id`, `contact_id`, `assigned_to_user_id`, `snoozed_until`, `awaiting_reply_since`, `undo_state`, `pinned`, `published_at`, `deleted_at`, `notified_at`, `recipient_count`, `post_policy`, `notify_policy`, `message_count`, `last_message_at`, `last_outbound_at`, `created_at`, `updated_at`) SELECT `id`, `channel`, `group_id`, `status`, `subject`, `preview`, `contact_name`, `contact_email`, `contact_phone`, `contact_external_id`, `organization_id`, `contact_id`, `assigned_to_user_id`, `snoozed_until`, `awaiting_reply_since`, `undo_state`, `pinned`, `published_at`, `deleted_at`, `notified_at`, `recipient_count`, `post_policy`, `notify_policy`, `message_count`, `last_message_at`, `last_outbound_at`, `created_at`, `updated_at` FROM `inbox_thread`;
--> statement-breakpoint
DROP TABLE `inbox_thread`;
--> statement-breakpoint
ALTER TABLE `__detach_inbox_thread` RENAME TO `inbox_thread`;
--> statement-breakpoint
CREATE INDEX `idx_inbox_thread_status` ON `inbox_thread` (`status`);
--> statement-breakpoint
CREATE INDEX `idx_inbox_thread_channel` ON `inbox_thread` (`channel`);
--> statement-breakpoint
CREATE INDEX `idx_inbox_thread_assigned` ON `inbox_thread` (`assigned_to_user_id`);
--> statement-breakpoint
CREATE INDEX `idx_inbox_thread_last_message` ON `inbox_thread` (`last_message_at`);
--> statement-breakpoint
CREATE INDEX `idx_inbox_thread_contact_email` ON `inbox_thread` (`contact_email`);
--> statement-breakpoint
CREATE INDEX `idx_inbox_thread_organization` ON `inbox_thread` (`organization_id`) WHERE organization_id is not null;
--> statement-breakpoint
CREATE INDEX `idx_inbox_thread_contact` ON `inbox_thread` (`contact_id`) WHERE contact_id is not null;
--> statement-breakpoint
CREATE INDEX `idx_inbox_thread_contact_phone` ON `inbox_thread` (`contact_phone`);
--> statement-breakpoint
CREATE INDEX `idx_inbox_thread_contact_ext` ON `inbox_thread` (`channel`,`contact_external_id`);
--> statement-breakpoint
CREATE INDEX `idx_inbox_thread_group` ON `inbox_thread` (`group_id`,`status`,`last_message_at`);
--> statement-breakpoint
CREATE INDEX `idx_inbox_thread_group_pinned` ON `inbox_thread` (`group_id`,`pinned`,`published_at`);
--> statement-breakpoint
CREATE INDEX `idx_inbox_thread_notified` ON `inbox_thread` (`notified_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_inbox_thread_group_announcements` ON `inbox_thread` (`group_id`) WHERE "inbox_thread"."channel" = 'group' AND "inbox_thread"."post_policy" = 'leadership';
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_inbox_thread_group_general` ON `inbox_thread` (`group_id`) WHERE "inbox_thread"."channel" = 'group' AND "inbox_thread"."subject" IS NULL;
--> statement-breakpoint
-- detach work_order_link
CREATE TABLE `__detach_work_order_link` (
	`id` text PRIMARY KEY,
	`work_order_id` text NOT NULL,
	`organization_id` text,
	`contact_id` text,
	`asset_id` text,
	`reservation_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_work_order_link_work_order_id_work_order_id_fk` FOREIGN KEY (`work_order_id`) REFERENCES `work_order`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_work_order_link_organization_id_organization_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_work_order_link_contact_id_contact_id_fk` FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`),
	CONSTRAINT `fk_work_order_link_asset_id_inventory_asset_id_fk` FOREIGN KEY (`asset_id`) REFERENCES `inventory_asset`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_work_order_link_reservation_id_reservation_id_fk` FOREIGN KEY (`reservation_id`) REFERENCES `reservation`(`id`) ON DELETE CASCADE,
	CONSTRAINT `work_order_link_one_target` CHECK((organization_id is not null) + (contact_id is not null) + (asset_id is not null) + (reservation_id is not null) = 1)
);
--> statement-breakpoint
INSERT INTO `__detach_work_order_link`(`id`, `work_order_id`, `organization_id`, `contact_id`, `asset_id`, `reservation_id`, `created_at`) SELECT `id`, `work_order_id`, `organization_id`, `contact_id`, `asset_id`, `reservation_id`, `created_at` FROM `work_order_link`;
--> statement-breakpoint
DROP TABLE `work_order_link`;
--> statement-breakpoint
ALTER TABLE `__detach_work_order_link` RENAME TO `work_order_link`;
--> statement-breakpoint
CREATE INDEX `idx_work_order_link_work_order` ON `work_order_link` (`work_order_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_work_order_link_organization` ON `work_order_link` (`organization_id`,`work_order_id`) WHERE organization_id is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_work_order_link_contact` ON `work_order_link` (`contact_id`,`work_order_id`) WHERE contact_id is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_work_order_link_asset` ON `work_order_link` (`asset_id`,`work_order_id`) WHERE asset_id is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_work_order_link_reservation` ON `work_order_link` (`reservation_id`,`work_order_id`) WHERE reservation_id is not null;
--> statement-breakpoint
-- detach activity
CREATE TABLE `__detach_activity` (
	`id` text PRIMARY KEY,
	`organization_id` text,
	`contact_id` text,
	`kind` text NOT NULL,
	`occurred_on` text NOT NULL,
	`body` text NOT NULL,
	`author_user_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_activity_organization_id_organization_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_activity_contact_id_contact_id_fk` FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`),
	CONSTRAINT `fk_activity_author_user_id_user_id_fk` FOREIGN KEY (`author_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `activity_one_owner` CHECK((organization_id is null) <> (contact_id is null))
);
--> statement-breakpoint
INSERT INTO `__detach_activity`(`id`, `organization_id`, `contact_id`, `kind`, `occurred_on`, `body`, `author_user_id`, `created_at`, `updated_at`) SELECT `id`, `organization_id`, `contact_id`, `kind`, `occurred_on`, `body`, `author_user_id`, `created_at`, `updated_at` FROM `activity`;
--> statement-breakpoint
DROP TABLE `activity`;
--> statement-breakpoint
ALTER TABLE `__detach_activity` RENAME TO `activity`;
--> statement-breakpoint
CREATE INDEX `idx_activity_organization` ON `activity` (`organization_id`,`occurred_on`) WHERE organization_id is not null;
--> statement-breakpoint
CREATE INDEX `idx_activity_contact` ON `activity` (`contact_id`,`occurred_on`) WHERE contact_id is not null;
--> statement-breakpoint
CREATE TABLE `__new_contact` (
	`id` text PRIMARY KEY,
	`organization_id` text,
	`user_id` text,
	`subscriber_id` text,
	`name` text,
	`role` text,
	`email` text,
	`phone` text,
	`notes` text,
	`payment_ref` text,
	`source` text NOT NULL,
	`retain_until` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_contact_organization_id_organization_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_contact_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_contact_subscriber_id_subscriber_id_fk` FOREIGN KEY (`subscriber_id`) REFERENCES `subscriber`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
INSERT INTO `__new_contact`(`id`, `organization_id`, `user_id`, `subscriber_id`, `name`, `role`, `email`, `phone`, `notes`, `payment_ref`, `source`, `retain_until`, `created_at`, `updated_at`) SELECT `id`, `organization_id`, `user_id`, `subscriber_id`, `name`, `role`, `email`, `phone`, `notes`, `payment_ref`, `source`, `retain_until`, `created_at`, `updated_at` FROM `contact`;
--> statement-breakpoint
DROP TABLE `contact`;
--> statement-breakpoint
ALTER TABLE `__new_contact` RENAME TO `contact`;
--> statement-breakpoint
DROP INDEX IF EXISTS `idx_contact_entry`;
--> statement-breakpoint
CREATE INDEX `idx_contact_subscriber` ON `contact` (`subscriber_id`);
--> statement-breakpoint
CREATE INDEX `idx_contact_organization` ON `contact` (`organization_id`);
--> statement-breakpoint
CREATE INDEX `idx_contact_user` ON `contact` (`user_id`);
--> statement-breakpoint
CREATE INDEX `idx_contact_email` ON `contact` (`email`);
--> statement-breakpoint
CREATE INDEX `idx_contact_retain_until` ON `contact` (`retain_until`);
--> statement-breakpoint
-- reattach activity
CREATE TABLE `__reattach_activity` (
	`id` text PRIMARY KEY,
	`organization_id` text,
	`contact_id` text,
	`kind` text NOT NULL,
	`occurred_on` text NOT NULL,
	`body` text NOT NULL,
	`author_user_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_activity_organization_id_organization_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_activity_contact_id_contact_id_fk` FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_activity_author_user_id_user_id_fk` FOREIGN KEY (`author_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `activity_one_owner` CHECK((organization_id is null) <> (contact_id is null))
);
--> statement-breakpoint
INSERT INTO `__reattach_activity`(`id`, `organization_id`, `contact_id`, `kind`, `occurred_on`, `body`, `author_user_id`, `created_at`, `updated_at`) SELECT `id`, `organization_id`, `contact_id`, `kind`, `occurred_on`, `body`, `author_user_id`, `created_at`, `updated_at` FROM `activity`;
--> statement-breakpoint
DROP TABLE `activity`;
--> statement-breakpoint
ALTER TABLE `__reattach_activity` RENAME TO `activity`;
--> statement-breakpoint
CREATE INDEX `idx_activity_organization` ON `activity` (`organization_id`,`occurred_on`) WHERE organization_id is not null;
--> statement-breakpoint
CREATE INDEX `idx_activity_contact` ON `activity` (`contact_id`,`occurred_on`) WHERE contact_id is not null;
--> statement-breakpoint
-- reattach work_order_link
CREATE TABLE `__reattach_work_order_link` (
	`id` text PRIMARY KEY,
	`work_order_id` text NOT NULL,
	`organization_id` text,
	`contact_id` text,
	`asset_id` text,
	`reservation_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_work_order_link_work_order_id_work_order_id_fk` FOREIGN KEY (`work_order_id`) REFERENCES `work_order`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_work_order_link_organization_id_organization_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_work_order_link_contact_id_contact_id_fk` FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_work_order_link_asset_id_inventory_asset_id_fk` FOREIGN KEY (`asset_id`) REFERENCES `inventory_asset`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_work_order_link_reservation_id_reservation_id_fk` FOREIGN KEY (`reservation_id`) REFERENCES `reservation`(`id`) ON DELETE CASCADE,
	CONSTRAINT `work_order_link_one_target` CHECK((organization_id is not null) + (contact_id is not null) + (asset_id is not null) + (reservation_id is not null) = 1)
);
--> statement-breakpoint
INSERT INTO `__reattach_work_order_link`(`id`, `work_order_id`, `organization_id`, `contact_id`, `asset_id`, `reservation_id`, `created_at`) SELECT `id`, `work_order_id`, `organization_id`, `contact_id`, `asset_id`, `reservation_id`, `created_at` FROM `work_order_link`;
--> statement-breakpoint
DROP TABLE `work_order_link`;
--> statement-breakpoint
ALTER TABLE `__reattach_work_order_link` RENAME TO `work_order_link`;
--> statement-breakpoint
CREATE INDEX `idx_work_order_link_work_order` ON `work_order_link` (`work_order_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_work_order_link_organization` ON `work_order_link` (`organization_id`,`work_order_id`) WHERE organization_id is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_work_order_link_contact` ON `work_order_link` (`contact_id`,`work_order_id`) WHERE contact_id is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_work_order_link_asset` ON `work_order_link` (`asset_id`,`work_order_id`) WHERE asset_id is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_work_order_link_reservation` ON `work_order_link` (`reservation_id`,`work_order_id`) WHERE reservation_id is not null;
--> statement-breakpoint
-- reattach inbox_thread
CREATE TABLE `__reattach_inbox_thread` (
	`id` text PRIMARY KEY,
	`channel` text NOT NULL,
	`group_id` text,
	`status` text DEFAULT 'open' NOT NULL,
	`subject` text,
	`preview` text,
	`contact_name` text,
	`contact_email` text,
	`contact_phone` text,
	`contact_external_id` text,
	`organization_id` text,
	`contact_id` text,
	`assigned_to_user_id` text,
	`snoozed_until` integer,
	`awaiting_reply_since` integer,
	`undo_state` text,
	`pinned` integer DEFAULT false NOT NULL,
	`published_at` integer,
	`deleted_at` integer,
	`notified_at` integer,
	`recipient_count` integer,
	`post_policy` text DEFAULT 'members' NOT NULL,
	`notify_policy` text DEFAULT 'in_app' NOT NULL,
	`message_count` integer DEFAULT 0 NOT NULL,
	`last_message_at` integer,
	`last_outbound_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_inbox_thread_group_id_group_id_fk` FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_inbox_thread_organization_id_organization_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_inbox_thread_contact_id_contact_id_fk` FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_inbox_thread_assigned_to_user_id_user_id_fk` FOREIGN KEY (`assigned_to_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
INSERT INTO `__reattach_inbox_thread`(`id`, `channel`, `group_id`, `status`, `subject`, `preview`, `contact_name`, `contact_email`, `contact_phone`, `contact_external_id`, `organization_id`, `contact_id`, `assigned_to_user_id`, `snoozed_until`, `awaiting_reply_since`, `undo_state`, `pinned`, `published_at`, `deleted_at`, `notified_at`, `recipient_count`, `post_policy`, `notify_policy`, `message_count`, `last_message_at`, `last_outbound_at`, `created_at`, `updated_at`) SELECT `id`, `channel`, `group_id`, `status`, `subject`, `preview`, `contact_name`, `contact_email`, `contact_phone`, `contact_external_id`, `organization_id`, `contact_id`, `assigned_to_user_id`, `snoozed_until`, `awaiting_reply_since`, `undo_state`, `pinned`, `published_at`, `deleted_at`, `notified_at`, `recipient_count`, `post_policy`, `notify_policy`, `message_count`, `last_message_at`, `last_outbound_at`, `created_at`, `updated_at` FROM `inbox_thread`;
--> statement-breakpoint
DROP TABLE `inbox_thread`;
--> statement-breakpoint
ALTER TABLE `__reattach_inbox_thread` RENAME TO `inbox_thread`;
--> statement-breakpoint
CREATE INDEX `idx_inbox_thread_status` ON `inbox_thread` (`status`);
--> statement-breakpoint
CREATE INDEX `idx_inbox_thread_channel` ON `inbox_thread` (`channel`);
--> statement-breakpoint
CREATE INDEX `idx_inbox_thread_assigned` ON `inbox_thread` (`assigned_to_user_id`);
--> statement-breakpoint
CREATE INDEX `idx_inbox_thread_last_message` ON `inbox_thread` (`last_message_at`);
--> statement-breakpoint
CREATE INDEX `idx_inbox_thread_contact_email` ON `inbox_thread` (`contact_email`);
--> statement-breakpoint
CREATE INDEX `idx_inbox_thread_organization` ON `inbox_thread` (`organization_id`) WHERE organization_id is not null;
--> statement-breakpoint
CREATE INDEX `idx_inbox_thread_contact` ON `inbox_thread` (`contact_id`) WHERE contact_id is not null;
--> statement-breakpoint
CREATE INDEX `idx_inbox_thread_contact_phone` ON `inbox_thread` (`contact_phone`);
--> statement-breakpoint
CREATE INDEX `idx_inbox_thread_contact_ext` ON `inbox_thread` (`channel`,`contact_external_id`);
--> statement-breakpoint
CREATE INDEX `idx_inbox_thread_group` ON `inbox_thread` (`group_id`,`status`,`last_message_at`);
--> statement-breakpoint
CREATE INDEX `idx_inbox_thread_group_pinned` ON `inbox_thread` (`group_id`,`pinned`,`published_at`);
--> statement-breakpoint
CREATE INDEX `idx_inbox_thread_notified` ON `inbox_thread` (`notified_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_inbox_thread_group_announcements` ON `inbox_thread` (`group_id`) WHERE "inbox_thread"."channel" = 'group' AND "inbox_thread"."post_policy" = 'leadership';
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_inbox_thread_group_general` ON `inbox_thread` (`group_id`) WHERE "inbox_thread"."channel" = 'group' AND "inbox_thread"."subject" IS NULL;
--> statement-breakpoint
-- reattach market_vendor
CREATE TABLE `__reattach_market_vendor` (
	`id` text PRIMARY KEY,
	`event_id` text NOT NULL,
	`thread_id` text,
	`organization_id` text,
	`business_name` text NOT NULL,
	`offering` text NOT NULL,
	`website` text,
	`tables_requested` integer DEFAULT 1 NOT NULL,
	`needs_power` integer DEFAULT false NOT NULL,
	`brings_own_table` integer DEFAULT false NOT NULL,
	`brings_tent` integer DEFAULT false NOT NULL,
	`notes` text,
	`status` text DEFAULT 'applied' NOT NULL,
	`table_label` text,
	`decided_by_user_id` text,
	`decided_at` integer,
	`fee_cents` integer DEFAULT 0 NOT NULL,
	`fee_floor_cents` integer DEFAULT 0 NOT NULL,
	`paid_cents` integer,
	`paid_at` integer,
	`stripe_payment_record_id` text,
	`refunded_at` integer,
	`checked_in_at` integer,
	`invite_back` integer,
	`invite_back_note` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_market_vendor_event_id_event_listing_id_fk` FOREIGN KEY (`event_id`) REFERENCES `event_listing`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_market_vendor_thread_id_inbox_thread_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `inbox_thread`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_market_vendor_organization_id_organization_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_market_vendor_decided_by_user_id_user_id_fk` FOREIGN KEY (`decided_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
INSERT INTO `__reattach_market_vendor`(`id`, `event_id`, `thread_id`, `organization_id`, `business_name`, `offering`, `website`, `tables_requested`, `needs_power`, `brings_own_table`, `brings_tent`, `notes`, `status`, `table_label`, `decided_by_user_id`, `decided_at`, `fee_cents`, `fee_floor_cents`, `paid_cents`, `paid_at`, `stripe_payment_record_id`, `refunded_at`, `checked_in_at`, `invite_back`, `invite_back_note`, `created_at`, `updated_at`) SELECT `id`, `event_id`, `thread_id`, `organization_id`, `business_name`, `offering`, `website`, `tables_requested`, `needs_power`, `brings_own_table`, `brings_tent`, `notes`, `status`, `table_label`, `decided_by_user_id`, `decided_at`, `fee_cents`, `fee_floor_cents`, `paid_cents`, `paid_at`, `stripe_payment_record_id`, `refunded_at`, `checked_in_at`, `invite_back`, `invite_back_note`, `created_at`, `updated_at` FROM `market_vendor`;
--> statement-breakpoint
DROP TABLE `market_vendor`;
--> statement-breakpoint
ALTER TABLE `__reattach_market_vendor` RENAME TO `market_vendor`;
--> statement-breakpoint
CREATE INDEX `idx_market_vendor_event_status` ON `market_vendor` (`event_id`,`status`);
--> statement-breakpoint
CREATE INDEX `idx_market_vendor_organization` ON `market_vendor` (`organization_id`);
--> statement-breakpoint
-- reattach inbox_thread_tag
CREATE TABLE `__reattach_inbox_thread_tag` (
	`id` text PRIMARY KEY,
	`thread_id` text NOT NULL,
	`tag` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_inbox_thread_tag_thread_id_inbox_thread_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `inbox_thread`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `__reattach_inbox_thread_tag`(`id`, `thread_id`, `tag`, `created_at`) SELECT `id`, `thread_id`, `tag`, `created_at` FROM `inbox_thread_tag`;
--> statement-breakpoint
DROP TABLE `inbox_thread_tag`;
--> statement-breakpoint
ALTER TABLE `__reattach_inbox_thread_tag` RENAME TO `inbox_thread_tag`;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_inbox_thread_tag_unique` ON `inbox_thread_tag` (`thread_id`,`tag`);
--> statement-breakpoint
-- reattach inbox_participant
CREATE TABLE `__reattach_inbox_participant` (
	`id` text PRIMARY KEY,
	`thread_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`last_read_at` integer,
	`accepted_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_inbox_participant_thread_id_inbox_thread_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `inbox_thread`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_inbox_participant_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `__reattach_inbox_participant`(`id`, `thread_id`, `user_id`, `role`, `last_read_at`, `accepted_at`, `created_at`) SELECT `id`, `thread_id`, `user_id`, `role`, `last_read_at`, `accepted_at`, `created_at` FROM `inbox_participant`;
--> statement-breakpoint
DROP TABLE `inbox_participant`;
--> statement-breakpoint
ALTER TABLE `__reattach_inbox_participant` RENAME TO `inbox_participant`;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_inbox_participant_thread_user` ON `inbox_participant` (`thread_id`,`user_id`);
--> statement-breakpoint
CREATE INDEX `idx_inbox_participant_user` ON `inbox_participant` (`user_id`);
--> statement-breakpoint
CREATE INDEX `idx_inbox_participant_user_accepted` ON `inbox_participant` (`user_id`,`accepted_at`);
--> statement-breakpoint
-- reattach inbox_note
CREATE TABLE `__reattach_inbox_note` (
	`id` text PRIMARY KEY,
	`thread_id` text NOT NULL,
	`author_user_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_inbox_note_thread_id_inbox_thread_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `inbox_thread`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_inbox_note_author_user_id_user_id_fk` FOREIGN KEY (`author_user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `__reattach_inbox_note`(`id`, `thread_id`, `author_user_id`, `body`, `created_at`) SELECT `id`, `thread_id`, `author_user_id`, `body`, `created_at` FROM `inbox_note`;
--> statement-breakpoint
DROP TABLE `inbox_note`;
--> statement-breakpoint
ALTER TABLE `__reattach_inbox_note` RENAME TO `inbox_note`;
--> statement-breakpoint
CREATE INDEX `idx_inbox_note_thread` ON `inbox_note` (`thread_id`,`created_at`);
--> statement-breakpoint
-- reattach inbox_message
CREATE TABLE `__reattach_inbox_message` (
	`id` text PRIMARY KEY,
	`thread_id` text NOT NULL,
	`direction` text NOT NULL,
	`body` text NOT NULL,
	`body_html` text,
	`author_name` text,
	`author_user_id` text,
	`channel_message_id` text,
	`channel_metadata` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_inbox_message_thread_id_inbox_thread_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `inbox_thread`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_inbox_message_author_user_id_user_id_fk` FOREIGN KEY (`author_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
INSERT INTO `__reattach_inbox_message`(`id`, `thread_id`, `direction`, `body`, `body_html`, `author_name`, `author_user_id`, `channel_message_id`, `channel_metadata`, `created_at`) SELECT `id`, `thread_id`, `direction`, `body`, `body_html`, `author_name`, `author_user_id`, `channel_message_id`, `channel_metadata`, `created_at` FROM `inbox_message`;
--> statement-breakpoint
DROP TABLE `inbox_message`;
--> statement-breakpoint
ALTER TABLE `__reattach_inbox_message` RENAME TO `inbox_message`;
--> statement-breakpoint
CREATE INDEX `idx_inbox_message_thread` ON `inbox_message` (`thread_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_inbox_message_channel_id` ON `inbox_message` (`channel_message_id`);
--> statement-breakpoint
-- reattach group_announcement
CREATE TABLE `__reattach_group_announcement` (
	`id` text PRIMARY KEY,
	`group_id` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`author_user_id` text,
	`author_name` text,
	`pinned` integer DEFAULT false NOT NULL,
	`published_at` integer,
	`message_id` text,
	`notified_at` integer,
	`recipient_count` integer,
	`deleted_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_group_announcement_group_id_group_id_fk` FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_group_announcement_author_user_id_user_id_fk` FOREIGN KEY (`author_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_group_announcement_message_id_inbox_message_id_fk` FOREIGN KEY (`message_id`) REFERENCES `inbox_message`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
INSERT INTO `__reattach_group_announcement`(`id`, `group_id`, `title`, `body`, `author_user_id`, `author_name`, `pinned`, `published_at`, `message_id`, `notified_at`, `recipient_count`, `deleted_at`, `created_at`, `updated_at`) SELECT `id`, `group_id`, `title`, `body`, `author_user_id`, `author_name`, `pinned`, `published_at`, `message_id`, `notified_at`, `recipient_count`, `deleted_at`, `created_at`, `updated_at` FROM `group_announcement`;
--> statement-breakpoint
DROP TABLE `group_announcement`;
--> statement-breakpoint
ALTER TABLE `__reattach_group_announcement` RENAME TO `group_announcement`;
--> statement-breakpoint
CREATE INDEX `idx_group_announcement_group` ON `group_announcement` (`group_id`,`pinned`,`published_at`);
--> statement-breakpoint
-- reattach inbox_group_read
CREATE TABLE `__reattach_inbox_group_read` (
	`id` text PRIMARY KEY,
	`thread_id` text NOT NULL,
	`user_id` text NOT NULL,
	`last_read_at` integer,
	`muted` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_inbox_group_read_thread_id_inbox_thread_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `inbox_thread`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_inbox_group_read_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `__reattach_inbox_group_read`(`id`, `thread_id`, `user_id`, `last_read_at`, `muted`, `created_at`) SELECT `id`, `thread_id`, `user_id`, `last_read_at`, `muted`, `created_at` FROM `inbox_group_read`;
--> statement-breakpoint
DROP TABLE `inbox_group_read`;
--> statement-breakpoint
ALTER TABLE `__reattach_inbox_group_read` RENAME TO `inbox_group_read`;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_inbox_group_read_thread_user` ON `inbox_group_read` (`thread_id`,`user_id`);
--> statement-breakpoint
CREATE INDEX `idx_inbox_group_read_user` ON `inbox_group_read` (`user_id`);
--> statement-breakpoint
-- reattach party_role
CREATE TABLE `__reattach_party_role` (
	`id` text PRIMARY KEY,
	`organization_id` text,
	`contact_id` text,
	`role` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_party_role_organization_id_organization_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_party_role_contact_id_contact_id_fk` FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`) ON DELETE CASCADE,
	CONSTRAINT `party_role_one_owner` CHECK((organization_id is null) <> (contact_id is null))
);
--> statement-breakpoint
INSERT INTO `__reattach_party_role`(`id`, `organization_id`, `contact_id`, `role`, `created_at`) SELECT `id`, `organization_id`, `contact_id`, `role`, `created_at` FROM `party_role`;
--> statement-breakpoint
DROP TABLE `party_role`;
--> statement-breakpoint
ALTER TABLE `__reattach_party_role` RENAME TO `party_role`;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_party_role_organization` ON `party_role` (`organization_id`,`role`) WHERE organization_id is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_party_role_contact` ON `party_role` (`contact_id`,`role`) WHERE contact_id is not null;
--> statement-breakpoint
CREATE INDEX `idx_party_role_role` ON `party_role` (`role`);
--> statement-breakpoint
-- reattach production_slot
CREATE TABLE `__reattach_production_slot` (
	`id` text PRIMARY KEY,
	`production_id` text NOT NULL,
	`event_band_id` text,
	`sort_order` real NOT NULL,
	`set_length_minutes` integer NOT NULL,
	`changeover_minutes` integer DEFAULT 10 NOT NULL,
	`scheduled_start_at` integer,
	`actual_start_at` integer,
	`actual_end_at` integer,
	`soundcheck_at` integer,
	`tech_notes` text,
	`backline_needs` text,
	`hospitality_notes` text,
	`contact_id` text,
	`guarantee_cents` integer,
	`percentage_bps` integer,
	`versus` integer DEFAULT false NOT NULL,
	`against_net` integer DEFAULT false NOT NULL,
	`contributed` integer DEFAULT false NOT NULL,
	`paid_cents` integer,
	`paid_at` integer,
	`paid_by_user_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_production_slot_production_id_production_id_fk` FOREIGN KEY (`production_id`) REFERENCES `production`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_production_slot_event_band_id_event_band_id_fk` FOREIGN KEY (`event_band_id`) REFERENCES `event_band`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_production_slot_contact_id_contact_id_fk` FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_production_slot_paid_by_user_id_user_id_fk` FOREIGN KEY (`paid_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `production_slot_set_length_positive` CHECK(set_length_minutes > 0),
	CONSTRAINT `production_slot_changeover_nonneg` CHECK(changeover_minutes >= 0)
);
--> statement-breakpoint
INSERT INTO `__reattach_production_slot`(`id`, `production_id`, `event_band_id`, `sort_order`, `set_length_minutes`, `changeover_minutes`, `scheduled_start_at`, `actual_start_at`, `actual_end_at`, `soundcheck_at`, `tech_notes`, `backline_needs`, `hospitality_notes`, `contact_id`, `guarantee_cents`, `percentage_bps`, `versus`, `against_net`, `contributed`, `paid_cents`, `paid_at`, `paid_by_user_id`, `created_at`, `updated_at`) SELECT `id`, `production_id`, `event_band_id`, `sort_order`, `set_length_minutes`, `changeover_minutes`, `scheduled_start_at`, `actual_start_at`, `actual_end_at`, `soundcheck_at`, `tech_notes`, `backline_needs`, `hospitality_notes`, `contact_id`, `guarantee_cents`, `percentage_bps`, `versus`, `against_net`, `contributed`, `paid_cents`, `paid_at`, `paid_by_user_id`, `created_at`, `updated_at` FROM `production_slot`;
--> statement-breakpoint
DROP TABLE `production_slot`;
--> statement-breakpoint
ALTER TABLE `__reattach_production_slot` RENAME TO `production_slot`;
--> statement-breakpoint
CREATE INDEX `idx_production_slot_order` ON `production_slot` (`production_id`,`sort_order`);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_production_slot_event_band` ON `production_slot` (`event_band_id`) WHERE event_band_id is not null;
--> statement-breakpoint
PRAGMA defer_foreign_keys=OFF;
