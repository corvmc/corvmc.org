-- One-time grant for #2794. The door list now needs event.checkIn on the shift's role, so every
-- volunteer role that takes card payments at the door (finance.collect) gets a row for it.
-- Additive only: other grants are untouched. Audits each role it changes; a second run is a no-op.
INSERT INTO audit_log (id, action, actor_user_id, actor_name, actor_email, subject_type, subject_id, subject_label, details, created_at)
SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + abs(random()) % 4, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
	'capability.grants_changed', NULL, 'System', '', 'role', r.id, r.name,
	json_object('added', json('["event.checkIn"]'), 'removed', json('[]')), unixepoch()
FROM volunteer_role r
WHERE EXISTS (
		SELECT 1 FROM volunteer_role_capability c
		WHERE c.volunteer_role_id = r.id AND c.capability = 'finance.collect'
	)
	AND NOT EXISTS (
		SELECT 1 FROM volunteer_role_capability c
		WHERE c.volunteer_role_id = r.id AND c.capability = 'event.checkIn'
	);
--> statement-breakpoint
UPDATE volunteer_role SET updated_at = unixepoch()
WHERE EXISTS (
		SELECT 1 FROM volunteer_role_capability c
		WHERE c.volunteer_role_id = volunteer_role.id AND c.capability = 'finance.collect'
	)
	AND NOT EXISTS (
		SELECT 1 FROM volunteer_role_capability c
		WHERE c.volunteer_role_id = volunteer_role.id AND c.capability = 'event.checkIn'
	);
--> statement-breakpoint
INSERT OR IGNORE INTO volunteer_role_capability (volunteer_role_id, capability)
SELECT c.volunteer_role_id, 'event.checkIn' FROM volunteer_role_capability c
WHERE c.capability = 'finance.collect';
