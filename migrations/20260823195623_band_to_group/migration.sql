ALTER TABLE `band` RENAME TO `group`;--> statement-breakpoint
ALTER TABLE `group` ADD `kind` text DEFAULT 'band' NOT NULL;--> statement-breakpoint
ALTER TABLE `group` ADD `join_policy` text DEFAULT 'invite_only' NOT NULL;--> statement-breakpoint
ALTER TABLE `group` ADD `join_instructions` text;--> statement-breakpoint
-- Data migration, deliberately in the same file as the rename above so the
-- schema and the values it describes change atomically. `booker_type` is a
-- TypeScript-only enum in SQLite, so drizzle emits no DDL for renaming the
-- 'band' member to 'group' — without this line the code would look for a value
-- no row holds, and every band reservation would silently vanish from its panel.
UPDATE `reservation` SET `booker_type` = 'group' WHERE `booker_type` = 'band';
