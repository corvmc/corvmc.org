-- One-time grant for #1630. Door payments need finance.collect on the shift's role, so every
-- volunteer role whose name contains "door" (LIKE is ASCII case-insensitive) gets a row for it.
-- Additive only: other grants are untouched. Audits each role it changes; a second run is a no-op.
INSERT INTO audit_log (id, action, actor_user_id, actor_name, actor_email, subject_type, subject_id, subject_label, details, created_at)
SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + abs(random()) % 4, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
	'capability.grants_changed', NULL, 'System', '', 'role', r.id, r.name,
	json_object('added', json('["finance.collect"]'), 'removed', json('[]')), unixepoch()
FROM volunteer_role r
WHERE r.name LIKE '%door%'
	AND NOT EXISTS (
		SELECT 1 FROM volunteer_role_capability c
		WHERE c.volunteer_role_id = r.id AND c.capability = 'finance.collect'
	);
--> statement-breakpoint
UPDATE volunteer_role SET updated_at = unixepoch()
WHERE name LIKE '%door%'
	AND NOT EXISTS (
		SELECT 1 FROM volunteer_role_capability c
		WHERE c.volunteer_role_id = volunteer_role.id AND c.capability = 'finance.collect'
	);
--> statement-breakpoint
INSERT OR IGNORE INTO volunteer_role_capability (volunteer_role_id, capability)
SELECT r.id, 'finance.collect' FROM volunteer_role r WHERE r.name LIKE '%door%';
