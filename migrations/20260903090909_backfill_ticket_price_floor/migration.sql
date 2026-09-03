-- Every show that is already selling keeps the price it is selling at.
--
-- `ticket_price_floor_cents` defaults to 0, which is the right default for a
-- new event — the scale runs to free and nobody is turned away. Applied to the
-- events already on the books it would be a silent policy change: every show
-- currently charging $15 would become pay-what-you-want the moment this
-- deploys, without anyone having decided that show by show.
--
-- So existing ticketed events start with floor == suggested, which is exactly
-- the fixed price they have today, and staff open each scale deliberately.
UPDATE `event`
SET `ticket_price_floor_cents` = COALESCE(`ticket_price`, 0)
WHERE `ticketing_enabled` = 1;
