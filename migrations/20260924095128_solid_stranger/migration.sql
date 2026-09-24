ALTER TABLE `audio_release` ADD `radio_attested_at` integer;--> statement-breakpoint
ALTER TABLE `audio_release` ADD `radio_attested_by_user_id` text REFERENCES user(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `audio_release` ADD `radio_attestation_version` text;