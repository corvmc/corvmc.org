-- Backfill `inbox_thread.last_outbound_at` from the messages already on file.
--
-- Without this every existing thread reads as "never answered" in the Open
-- queue, which is the loudest of the three reasons and wrong for most of the
-- inbox. The column is only ever written forward by `addOutboundMessage`, so a
-- one-off pass over the message table is the whole migration.
UPDATE `inbox_thread`
SET `last_outbound_at` = (
	SELECT MAX(m.`created_at`)
	FROM `inbox_message` m
	WHERE m.`thread_id` = `inbox_thread`.`id`
	  AND m.`direction` = 'outbound'
)
WHERE `last_outbound_at` IS NULL;
