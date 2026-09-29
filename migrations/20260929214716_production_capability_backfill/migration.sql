-- The two halves of a show (#1673, docs/specs/production-projects-spec.md): Booking gains
-- production.book and Production gains production.run, with 'owned' reach over every show
-- they take part in. Additive only; staff keep both through their position. Audits each
-- committee it changes, and a second run is a no-op.
WITH want(gid, cap) AS (
	SELECT g.id, 'production.book' FROM "group" g
	WHERE g.kind = 'committee' AND (g.slug = 'booking-committee' OR g.name = 'Booking Committee')
	UNION
	SELECT g.id, 'production.run' FROM "group" g
	WHERE g.kind = 'committee' AND (g.slug = 'production-committee' OR g.name = 'Production Committee')
),
missing AS (
	SELECT w.gid, w.cap FROM want w
	WHERE NOT EXISTS (
		SELECT 1 FROM group_capability c WHERE c.group_id = w.gid AND c.capability = w.cap
	)
)
INSERT INTO audit_log (id, action, actor_user_id, actor_name, actor_email, subject_type, subject_id, subject_label, details, created_at)
SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + abs(random()) % 4, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
	'capability.grants_changed', NULL, 'System', '', 'group', g.id, g.name,
	json_object('added', json_group_array(m.cap), 'removed', json('[]')), unixepoch()
FROM missing m JOIN "group" g ON g.id = m.gid
GROUP BY g.id;
--> statement-breakpoint
INSERT OR IGNORE INTO group_capability (group_id, capability)
SELECT g.id, 'production.book' FROM "group" g
WHERE g.kind = 'committee' AND (g.slug = 'booking-committee' OR g.name = 'Booking Committee');
--> statement-breakpoint
INSERT OR IGNORE INTO group_capability (group_id, capability)
SELECT g.id, 'production.run' FROM "group" g
WHERE g.kind = 'committee' AND (g.slug = 'production-committee' OR g.name = 'Production Committee');
--> statement-breakpoint
-- Committees on projects created between the schema migration and this one.
INSERT OR IGNORE INTO project_committee (project_id, group_id, role)
SELECT pr.id, pr.group_id, 'owner'
FROM project pr JOIN "group" g ON g.id = pr.group_id
WHERE g.kind = 'committee';
--> statement-breakpoint
INSERT OR IGNORE INTO project_committee (project_id, group_id, role)
SELECT pr.id, g.id, CASE g.slug WHEN 'booking-committee' THEN 'booking' ELSE 'production' END
FROM project pr
JOIN "group" g ON g.slug IN ('booking-committee', 'production-committee')
	AND g.kind = 'committee'
	AND g.deleted_at IS NULL
WHERE pr.kind = 'production';
