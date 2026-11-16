-- Gives every existing event a short code for its /e/<code> link (#2615), six
-- characters from the alphabet in src/lib/event-short-code.ts. OR IGNORE skips
-- a row whose random code collides with the unique index; the next pass retries.
UPDATE OR IGNORE `event_listing` SET `short_code` =
	substr('23456789abcdefghjkmnpqrstuvwxyz', (random() & 2147483647) % 31 + 1, 1) ||
	substr('23456789abcdefghjkmnpqrstuvwxyz', (random() & 2147483647) % 31 + 1, 1) ||
	substr('23456789abcdefghjkmnpqrstuvwxyz', (random() & 2147483647) % 31 + 1, 1) ||
	substr('23456789abcdefghjkmnpqrstuvwxyz', (random() & 2147483647) % 31 + 1, 1) ||
	substr('23456789abcdefghjkmnpqrstuvwxyz', (random() & 2147483647) % 31 + 1, 1) ||
	substr('23456789abcdefghjkmnpqrstuvwxyz', (random() & 2147483647) % 31 + 1, 1)
WHERE `short_code` IS NULL;
--> statement-breakpoint
UPDATE OR IGNORE `event_listing` SET `short_code` =
	substr('23456789abcdefghjkmnpqrstuvwxyz', (random() & 2147483647) % 31 + 1, 1) ||
	substr('23456789abcdefghjkmnpqrstuvwxyz', (random() & 2147483647) % 31 + 1, 1) ||
	substr('23456789abcdefghjkmnpqrstuvwxyz', (random() & 2147483647) % 31 + 1, 1) ||
	substr('23456789abcdefghjkmnpqrstuvwxyz', (random() & 2147483647) % 31 + 1, 1) ||
	substr('23456789abcdefghjkmnpqrstuvwxyz', (random() & 2147483647) % 31 + 1, 1) ||
	substr('23456789abcdefghjkmnpqrstuvwxyz', (random() & 2147483647) % 31 + 1, 1)
WHERE `short_code` IS NULL;
--> statement-breakpoint
UPDATE OR IGNORE `event_listing` SET `short_code` =
	substr('23456789abcdefghjkmnpqrstuvwxyz', (random() & 2147483647) % 31 + 1, 1) ||
	substr('23456789abcdefghjkmnpqrstuvwxyz', (random() & 2147483647) % 31 + 1, 1) ||
	substr('23456789abcdefghjkmnpqrstuvwxyz', (random() & 2147483647) % 31 + 1, 1) ||
	substr('23456789abcdefghjkmnpqrstuvwxyz', (random() & 2147483647) % 31 + 1, 1) ||
	substr('23456789abcdefghjkmnpqrstuvwxyz', (random() & 2147483647) % 31 + 1, 1) ||
	substr('23456789abcdefghjkmnpqrstuvwxyz', (random() & 2147483647) % 31 + 1, 1)
WHERE `short_code` IS NULL;
