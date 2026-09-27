-- Backfill who cancelled each already-cancelled reservation, from the evidence that exists.
-- Staff: the `reservation.cancelled_by_staff` audit entry (#1519, from 2026-09-23 23:15 UTC).
-- System / owner / staff: the fixed reasons `cancel()` callers and the crons write.
-- Member: after #1519 an unaudited cancellation with no fixed reason can only be the booker's side.
-- Anything older stays NULL, which the page shows as plain "Cancelled". Every step skips rows
-- already set, so a second run is a no-op.
UPDATE reservation SET
	cancelled_by = 'staff',
	cancelled_by_user_id = (
		SELECT a.actor_user_id FROM audit_log a
		WHERE a.action = 'reservation.cancelled_by_staff'
			AND json_extract(a.details, '$.reservationId') = reservation.id
		ORDER BY a.created_at DESC LIMIT 1
	),
	cancelled_at = (
		SELECT a.created_at FROM audit_log a
		WHERE a.action = 'reservation.cancelled_by_staff'
			AND json_extract(a.details, '$.reservationId') = reservation.id
		ORDER BY a.created_at DESC LIMIT 1
	)
WHERE status = 'cancelled' AND cancelled_by IS NULL
	AND EXISTS (
		SELECT 1 FROM audit_log a
		WHERE a.action = 'reservation.cancelled_by_staff'
			AND json_extract(a.details, '$.reservationId') = reservation.id
	);
--> statement-breakpoint
UPDATE reservation SET cancelled_by = 'system'
WHERE status = 'cancelled' AND cancelled_by IS NULL
	AND cancellation_reason IN ('Waitlist expired', 'Not confirmed before start');
--> statement-breakpoint
UPDATE reservation SET cancelled_by = 'owner'
WHERE status = 'cancelled' AND cancelled_by IS NULL AND cancellation_reason = 'Band deleted';
--> statement-breakpoint
UPDATE reservation SET cancelled_by = 'staff'
WHERE status = 'cancelled' AND cancelled_by IS NULL
	AND cancellation_reason IN (
		'Band deactivated', 'Event deleted', 'Event cancelled',
		'Session cancelled', 'Session no longer holds the room'
	);
--> statement-breakpoint
UPDATE reservation SET cancelled_by = 'member'
WHERE status = 'cancelled' AND cancelled_by IS NULL AND updated_at >= 1790205354;
--> statement-breakpoint
-- `updated_at` is the cancellation time unless something touched the row after it.
UPDATE reservation SET cancelled_at = updated_at
WHERE status = 'cancelled' AND cancelled_at IS NULL;
