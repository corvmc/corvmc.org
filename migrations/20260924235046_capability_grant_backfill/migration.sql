-- One-time backfill of capability grants (#1647, #1650). Before those PRs a committee
-- that owned a project held every committee power, and anyone on a show's crew could
-- file an incident. This keeps that behaviour: merges into existing grant lists, only
-- adds allowlisted capabilities, audits each change, and a second run changes nothing.
WITH want(gid, cap) AS (
	SELECT g.id, n.value FROM "group" g,
		json_each('["project.manage","finance.read","event.publish","volunteer.manageShifts"]') n
	WHERE g.kind = 'committee' AND EXISTS (SELECT 1 FROM project p WHERE p.group_id = g.id)
	UNION
	SELECT g.id, 'event.manage' FROM "group" g
	WHERE g.kind = 'committee' AND EXISTS (
		SELECT 1 FROM market_day m
		JOIN event_listing e ON e.id = m.event_id
		JOIN project p ON p.id = e.project_id
		WHERE p.group_id = g.id
	)
	UNION
	SELECT g.id, n.value FROM "group" g,
		json_each('["sponsor.read","sponsor.manage","grant.read","grant.manage","renewal.read","renewal.manage"]') n
	WHERE g.kind = 'committee' AND (g.slug = 'development-committee' OR g.name = 'Development Committee')
),
missing AS (
	SELECT w.gid, w.cap FROM want w JOIN "group" g ON g.id = w.gid
	WHERE w.cap NOT IN (SELECT value FROM json_each(g.capability_grants))
)
INSERT INTO audit_log (id, action, actor_user_id, actor_name, actor_email, subject_type, subject_id, subject_label, details, created_at)
SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + abs(random()) % 4, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
	'capability.grants_changed', NULL, 'System', '', 'group', g.id, g.name,
	json_object('added', json_group_array(m.cap), 'removed', json('[]')), unixepoch()
FROM missing m JOIN "group" g ON g.id = m.gid
GROUP BY g.id;
--> statement-breakpoint
WITH want(gid, cap) AS (
	SELECT g.id, n.value FROM "group" g,
		json_each('["project.manage","finance.read","event.publish","volunteer.manageShifts"]') n
	WHERE g.kind = 'committee' AND EXISTS (SELECT 1 FROM project p WHERE p.group_id = g.id)
	UNION
	SELECT g.id, 'event.manage' FROM "group" g
	WHERE g.kind = 'committee' AND EXISTS (
		SELECT 1 FROM market_day m
		JOIN event_listing e ON e.id = m.event_id
		JOIN project p ON p.id = e.project_id
		WHERE p.group_id = g.id
	)
	UNION
	SELECT g.id, n.value FROM "group" g,
		json_each('["sponsor.read","sponsor.manage","grant.read","grant.manage","renewal.read","renewal.manage"]') n
	WHERE g.kind = 'committee' AND (g.slug = 'development-committee' OR g.name = 'Development Committee')
)
UPDATE "group" SET capability_grants = (
	SELECT json_group_array(value) FROM (
		SELECT value FROM json_each("group".capability_grants)
		UNION
		SELECT cap FROM want WHERE gid = "group".id
	)
)
WHERE id IN (
	SELECT w.gid FROM want w
	WHERE w.cap NOT IN (SELECT value FROM json_each("group".capability_grants))
);
--> statement-breakpoint
WITH want(rid, cap) AS (
	SELECT r.id, 'incident.file' FROM volunteer_role r
	WHERE EXISTS (SELECT 1 FROM work_order w WHERE w.volunteer_role_id = r.id AND w.event_id IS NOT NULL)
	UNION
	SELECT r.id, 'event.uploadRecap' FROM volunteer_role r WHERE r.name LIKE '%photo%'
),
missing AS (
	SELECT w.rid, w.cap FROM want w JOIN volunteer_role r ON r.id = w.rid
	WHERE w.cap NOT IN (SELECT value FROM json_each(r.capability_grants))
)
INSERT INTO audit_log (id, action, actor_user_id, actor_name, actor_email, subject_type, subject_id, subject_label, details, created_at)
SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + abs(random()) % 4, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
	'capability.grants_changed', NULL, 'System', '', 'role', r.id, r.name,
	json_object('added', json_group_array(m.cap), 'removed', json('[]')), unixepoch()
FROM missing m JOIN volunteer_role r ON r.id = m.rid
GROUP BY r.id;
--> statement-breakpoint
WITH want(rid, cap) AS (
	SELECT r.id, 'incident.file' FROM volunteer_role r
	WHERE EXISTS (SELECT 1 FROM work_order w WHERE w.volunteer_role_id = r.id AND w.event_id IS NOT NULL)
	UNION
	SELECT r.id, 'event.uploadRecap' FROM volunteer_role r WHERE r.name LIKE '%photo%'
)
UPDATE volunteer_role SET capability_grants = (
	SELECT json_group_array(value) FROM (
		SELECT value FROM json_each(volunteer_role.capability_grants)
		UNION
		SELECT cap FROM want WHERE rid = volunteer_role.id
	)
)
WHERE id IN (
	SELECT w.rid FROM want w
	WHERE w.cap NOT IN (SELECT value FROM json_each(volunteer_role.capability_grants))
);
