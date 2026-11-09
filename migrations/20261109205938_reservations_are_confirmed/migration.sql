-- A reservation is confirmed when it exists (#2502), so nothing is left in `scheduled`.
-- Live bookings only: a scheduled row is by definition neither cancelled nor finished.
-- The confirmation reminder is gone, so preferences stored for it are dropped.
UPDATE reservation SET status = 'confirmed', updated_at = unixepoch() WHERE status = 'scheduled';
--> statement-breakpoint
DELETE FROM notification_preference WHERE notification_type = 'confirmation_reminder';
