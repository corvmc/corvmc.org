-- Art and Merchandise and Communications run show work on their committees (#2959 follow-up a):
-- poster art, the description, the listing's times. Matched by slug, which production and the
-- seed share. Additive only; audits each committee it changes, and a second run is a no-op.
INSERT INTO audit_log (id, action, actor_user_id, actor_name, actor_email, subject_type, subject_id, subject_label, details, created_at)
SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + abs(random()) % 4, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
	'capability.grants_changed', NULL, 'System', '', 'group', g.id, g.name,
	json_object('added', json_array('production.run'), 'removed', json('[]')), unixepoch()
FROM "group" g
WHERE g.kind = 'committee'
	AND g.slug IN ('art-and-merchandise-committee', 'communications-committee')
	AND NOT EXISTS (
		SELECT 1 FROM group_capability r WHERE r.group_id = g.id AND r.capability = 'production.run'
	);
--> statement-breakpoint
INSERT OR IGNORE INTO group_capability (group_id, capability)
SELECT g.id, 'production.run' FROM "group" g
WHERE g.kind = 'committee'
	AND g.slug IN ('art-and-merchandise-committee', 'communications-committee');
