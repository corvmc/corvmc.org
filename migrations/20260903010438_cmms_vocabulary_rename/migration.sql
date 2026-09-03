-- The CMMS vocabulary from docs/specs/project-spec.md#vocabulary, applied to the
-- two tables that already were these things: `asset_flag` is a **work request**
-- (someone noticed, not yet authorized) and `volunteer_shift` is a **work
-- order** (triaged, scoped, assigned — a shift is its scheduled state). Both
-- keep every row and their ids; `work_task.work_order_id` and
-- `work_request.work_order_id` already used the new name. Sequenced before the
-- `project` table so the rename and `project_id` never share a lineage.
--
-- Two ALTERs and one UPDATE is the whole point. `drizzle-kit generate` defaults
-- each prompt to "create", which would emit DROP TABLE `asset_flag` and lose
-- every open request — and `d1-safe-rebuild.mjs --check` would not catch it,
-- because nothing references asset_flag.id. The prompts were answered through
-- `expect`, matching the option text, and this SQL was read before commit.
--
-- Index and check names keep their old prefixes (volunteer_shift_upcoming_idx,
-- idx_asset_flag_status, ...). SQLite carries them through RENAME TO untouched;
-- renaming them would turn these free ALTERs into table rebuilds. Child
-- foreign-key columns (`volunteer_signup.shift_id`, `volunteer_hour_log.shift_id`)
-- and `volunteer_shift_feedback` — feedback on a signup, not on the work —
-- stay as they are for the same reason.
ALTER TABLE `asset_flag` RENAME TO `work_request`;--> statement-breakpoint
ALTER TABLE `volunteer_shift` RENAME TO `work_order`;--> statement-breakpoint
-- `media_attachment.attachable_type` stores the parent table's name as data, and
-- drizzle's text enum emits no CHECK, so the stored value moves with the table.
UPDATE `media_attachment` SET `attachable_type` = 'work_request' WHERE `attachable_type` = 'asset_flag';
