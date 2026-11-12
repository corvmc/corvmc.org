-- Date inputs written as UTC midnight read as the previous evening in club time (#2538).
-- 20:00 UTC is noon PST and 1 PM PDT, the same club day at either offset.
-- Only exact UTC midnights move, so rows written as club noon are untouched.
UPDATE `inventory_loan` SET `requested_pickup_date` = `requested_pickup_date` + 72000 WHERE `requested_pickup_date` % 86400 = 0;--> statement-breakpoint
UPDATE `inventory_loan` SET `estimated_return_date` = `estimated_return_date` + 72000 WHERE `estimated_return_date` % 86400 = 0;--> statement-breakpoint
UPDATE `inventory_loan` SET `scheduled_pickup_date` = `scheduled_pickup_date` + 72000 WHERE `scheduled_pickup_date` % 86400 = 0;--> statement-breakpoint
UPDATE `inventory_loan` SET `due_date` = `due_date` + 72000 WHERE `due_date` % 86400 = 0;--> statement-breakpoint
UPDATE `acquisition` SET `acknowledged_at` = `acknowledged_at` + 72000 WHERE `acknowledged_at` % 86400 = 0;
