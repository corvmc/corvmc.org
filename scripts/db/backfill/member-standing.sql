-- Backfill `member_standing` from the three tables it replaces, and split the
-- member-owned half of `messaging_standing` out to `user.accepts_direct_messages`.
--
-- Run AFTER the migration that creates `member_standing`, and BEFORE the one
-- that drops the three old tables:
--
--   wrangler d1 execute corvmc-db --local --file=scripts/db/backfill/member-standing.sql
--   wrangler d1 execute corvmc-db --remote --file=scripts/db/backfill/member-standing.sql
--
-- Not a migration, and deliberately not one: migrations here come only from
-- `pnpm db:generate`, which writes DDL from a schema diff and would drop the
-- old tables in the same breath that creates the new one, taking the rows with
-- them. Splitting it into create → backfill → drop is what makes the data
-- survive.
--
-- D1 has no transactions, so idempotence is the safety property instead. Every
-- statement below is safe to re-run: the inserts collide on `(user_id, scope)`
-- and do nothing, and the update is absolute rather than relative. A crash
-- part-way leaves an obvious state that is repaired by running it again.
--
-- `source` is not carried across. It was three copies of one fact: a member row
-- becomes a preference (below), a report row is identified by
-- `triggering_flag_id`, and anything else was staff. See
-- `docs/specs/shipped/member-standing-spec.md`.

-- Community listings. `requires_review = 0` can only mean staff restored it, so
-- the row is kept as a cleared standing rather than dropped — "we looked at this
-- and forgave it" reads differently from "this never came up".
INSERT INTO member_standing (
	user_id, scope, status, reason, triggering_flag_id, updated_by_user_id, updated_at
)
SELECT
	user_id,
	'community_event',
	CASE WHEN requires_review THEN 'restricted' ELSE 'none' END,
	reason,
	triggering_flag_id,
	updated_by_user_id,
	updated_at
FROM community_event_standing
-- `WHERE true` is not filler. SQLite cannot parse `INSERT … SELECT … ON
-- CONFLICT` without a WHERE on the SELECT: it reads the `ON` as the start of a
-- join clause and fails. The messaging insert below has a real WHERE and needs
-- no workaround.
WHERE true
ON CONFLICT (user_id, scope) DO NOTHING;

-- Suggestions. Byte-identical source table, identical mapping.
INSERT INTO member_standing (
	user_id, scope, status, reason, triggering_flag_id, updated_by_user_id, updated_at
)
SELECT
	user_id,
	'suggestion',
	CASE WHEN requires_review THEN 'restricted' ELSE 'none' END,
	reason,
	triggering_flag_id,
	updated_by_user_id,
	updated_at
FROM suggestion_standing
WHERE true
ON CONFLICT (user_id, scope) DO NOTHING;

-- Messaging, staff- and report-imposed only. `status` already uses the shared
-- ladder, so it copies across untouched.
INSERT INTO member_standing (
	user_id, scope, status, reason, triggering_flag_id, updated_by_user_id, updated_at
)
SELECT
	user_id,
	'messaging',
	status,
	reason,
	triggering_flag_id,
	updated_by_user_id,
	updated_at
FROM messaging_standing
WHERE source <> 'member'
ON CONFLICT (user_id, scope) DO NOTHING;

-- The member-owned half. A member who switched their own messaging off gets a
-- preference and NO standing row: nothing was imposed on them, so there is no
-- moderation record to write. A `source = 'member'` row with `status = 'none'`
-- (switched off, then back on) maps to nothing at all — the column already
-- defaults to true.
UPDATE user
SET accepts_direct_messages = 0
WHERE id IN (
	SELECT user_id FROM messaging_standing WHERE source = 'member' AND status = 'disabled'
);
