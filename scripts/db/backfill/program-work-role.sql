-- One `Program Work` role, replacing the six committee roles retired in #1157.
--
-- Retiring those left committee work unloggable: `submitHours` requires a LIVE
-- role, so archiving them closed the only door. Four people had already used
-- it. This reopens it with a single role, and `volunteer_hour_log.group_id`
-- says which committee or club the time was for -- so there is no per-committee
-- role to drift from the group of the same name, which is what decision 2 of
-- committees-and-roles-spec.md killed.
--
-- Idempotent on the name, which is UNIQUE.

INSERT INTO volunteer_role (id, name, "group", description, display_order, is_active)
SELECT '2a1f0b6c-5d3e-4a7b-9c81-6e4f2d8a3b57',
       'Program Work',
       'away-from-shows',
       'Committee meetings and club sessions — the work of running a program. Name the committee or club on the log.',
       75,
       1
WHERE NOT EXISTS (SELECT 1 FROM volunteer_role WHERE name = 'Program Work');
