-- Renewals become recurring work (#2611). Removes what pointed at the retired
-- module: committee and role grants of renewal.*, staff notification switches
-- for renewal_expiry, sent-reminder rows and certificate attachments. The
-- media rows stay, so the sweep reaps their objects. Prod held no renewals.
DELETE FROM group_capability WHERE capability IN ('renewal.read', 'renewal.manage');
--> statement-breakpoint
DELETE FROM volunteer_role_capability WHERE capability IN ('renewal.read', 'renewal.manage');
--> statement-breakpoint
DELETE FROM notification_preference WHERE notification_type = 'renewal_expiry';
--> statement-breakpoint
DELETE FROM reminder_sent WHERE subject_type = 'renewal';
--> statement-breakpoint
DELETE FROM media_attachment WHERE attachable_type = 'renewal';
