-- One-time backfill for #1642. Recurring work moved from volunteer.manageShifts onto
-- volunteer.manageRecurring, so every committee holding manageShifts that owns recurring
-- work (any maintenance_schedule, retired or not) gets manageRecurring too. Merges into
-- the existing list, audits each change, and a second run changes nothing.
WITH want(gid) AS (
	SELECT g.id FROM "group" g
	WHERE g.kind = 'committee'
		AND 'volunteer.manageShifts' IN (SELECT value FROM json_each(g.capability_grants))
		AND 'volunteer.manageRecurring' NOT IN (SELECT value FROM json_each(g.capability_grants))
		AND EXISTS (SELECT 1 FROM maintenance_schedule s WHERE s.group_id = g.id)
)
INSERT INTO audit_log (id, action, actor_user_id, actor_name, actor_email, subject_type, subject_id, subject_label, details, created_at)
SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + abs(random()) % 4, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
	'capability.grants_changed', NULL, 'System', '', 'group', g.id, g.name,
	json_object('added', json('["volunteer.manageRecurring"]'), 'removed', json('[]')), unixepoch()
FROM want w JOIN "group" g ON g.id = w.gid;
--> statement-breakpoint
UPDATE "group" SET capability_grants = (
	SELECT json_group_array(value) FROM (
		SELECT value FROM json_each("group".capability_grants)
		UNION
		SELECT 'volunteer.manageRecurring'
	)
)
WHERE kind = 'committee'
	AND 'volunteer.manageShifts' IN (SELECT value FROM json_each("group".capability_grants))
	AND 'volunteer.manageRecurring' NOT IN (SELECT value FROM json_each("group".capability_grants))
	AND EXISTS (SELECT 1 FROM maintenance_schedule s WHERE s.group_id = "group".id);
