-- Funders and sponsors are organizations now, and their people are contacts (#2622).
-- The Development committee keeps reaching them: contact.read and contact.manage,
-- org-wide. A missing committee is skipped, each capability added is audited as
-- capability.grants_changed, and a second run is a no-op.
INSERT INTO audit_log (id, action, actor_user_id, actor_name, actor_email, subject_type, subject_id, subject_label, details, created_at)
SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + abs(random()) % 4, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
	'capability.grants_changed', NULL, 'System', '', 'group', g.id, g.name,
	json_object('added', (
		SELECT json_group_array(n.value) FROM json_each('["contact.read","contact.manage"]') n
		WHERE NOT EXISTS (
			SELECT 1 FROM group_capability c WHERE c.group_id = g.id AND c.capability = n.value
		)
	), 'removed', json('[]')), unixepoch()
FROM "group" g
WHERE g.kind = 'committee' AND (g.slug = 'development-committee' OR g.name = 'Development Committee')
	AND EXISTS (
		SELECT 1 FROM json_each('["contact.read","contact.manage"]') n
		WHERE NOT EXISTS (
			SELECT 1 FROM group_capability c WHERE c.group_id = g.id AND c.capability = n.value
		)
	);
--> statement-breakpoint
INSERT OR IGNORE INTO group_capability (group_id, capability)
SELECT g.id, n.value FROM "group" g, json_each('["contact.read","contact.manage"]') n
WHERE g.kind = 'committee' AND (g.slug = 'development-committee' OR g.name = 'Development Committee');
