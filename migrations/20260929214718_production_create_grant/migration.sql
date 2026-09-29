-- Booking opens its own shows (#1675): production.create, org-wide, because no project
-- exists to reach until the production does. Additive only; staff keep it through their
-- position. A missing Booking committee is skipped, the change is audited as
-- capability.grants_changed, and a second run is a no-op.
INSERT INTO audit_log (id, action, actor_user_id, actor_name, actor_email, subject_type, subject_id, subject_label, details, created_at)
SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + abs(random()) % 4, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
	'capability.grants_changed', NULL, 'System', '', 'group', g.id, g.name,
	json_object('added', json_array('production.create'), 'removed', json('[]')), unixepoch()
FROM "group" g
WHERE g.kind = 'committee' AND (g.slug = 'booking-committee' OR g.name = 'Booking Committee')
	AND NOT EXISTS (
		SELECT 1 FROM group_capability c WHERE c.group_id = g.id AND c.capability = 'production.create'
	);
--> statement-breakpoint
INSERT OR IGNORE INTO group_capability (group_id, capability)
SELECT g.id, 'production.create' FROM "group" g
WHERE g.kind = 'committee' AND (g.slug = 'booking-committee' OR g.name = 'Booking Committee');
