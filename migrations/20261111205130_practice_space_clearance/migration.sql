-- The "Practice space" clearance (#2565). Its id is PRACTICE_SPACE_CLEARANCE_ID in
-- src/lib/config.ts, which the booking-notice rule reads; it never expires.
INSERT OR IGNORE INTO volunteer_certification (id, name, description, issued_by, validity_months, display_order, is_active, created_at, updated_at)
VALUES (
	'practice-space',
	'Practice space',
	'Shown around the practice space: the door, the gear and how to open and close. Without it, a member''s own booking needs 3 days'' notice.',
	NULL, NULL, 0, 1, unixepoch(), unixepoch()
);
--> statement-breakpoint
-- Backfill: every member who has finished a booking they made themselves (not a band,
-- event or staff hold), and every member whose orientation is completed or waived.
-- granted_by_user_id is null and the note names this migration. A second run adds nothing.
INSERT INTO member_certification (id, user_id, certification_id, granted_at, expires_at, granted_by_user_id, notes, created_at, updated_at)
SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + abs(random()) % 4, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
	m.user_id, 'practice-space', unixepoch(), NULL, NULL,
	'Granted by migration 20261111205130_practice_space_clearance', unixepoch(), unixepoch()
FROM (
	SELECT created_by_user_id AS user_id FROM reservation
	WHERE booker_type = 'user' AND status = 'completed' AND created_by_staff_id IS NULL
	UNION
	SELECT user_id FROM member_orientation
	WHERE completed_at IS NOT NULL OR waived_at IS NOT NULL
) m
WHERE EXISTS (SELECT 1 FROM "user" u WHERE u.id = m.user_id)
	AND NOT EXISTS (
		SELECT 1 FROM member_certification mc
		WHERE mc.user_id = m.user_id AND mc.certification_id = 'practice-space'
	);
