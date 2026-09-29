-- Correct rows recorded as cancelled by staff where the canceller was the booking's own side
-- (#1697): a program leader cancelling or releasing their group session's room, and a staffer
-- cancelling a booking they made themselves. Both came from the backfill and from `cancel()`
-- before #1690. Event and band cascades stay staff whoever booked the room. Keeps the user id
-- and the time; the WHERE only matches `staff` rows, so a second run is a no-op.
UPDATE reservation SET cancelled_by = 'member'
WHERE status = 'cancelled' AND cancelled_by = 'staff'
	AND (
		cancellation_reason IN ('Session cancelled', 'Session no longer holds the room')
		OR (
			cancelled_by_user_id = created_by_user_id
			AND coalesce(cancellation_reason, '') NOT IN (
				'Event deleted', 'Event cancelled', 'Band deactivated'
			)
		)
	);
