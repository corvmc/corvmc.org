-- A club or committee holds the room free (#2616). Bookings written before
-- insertReservation carried a null price, which reads as owed in full.
UPDATE `reservation` SET `cash_due_cents` = 0
 WHERE `booker_type` = 'group'
   AND `cash_due_cents` IS NULL
   AND `paid_at` IS NULL
   AND `status` <> 'cancelled'
   AND `booker_id` IN (SELECT `id` FROM `group` WHERE `kind` <> 'band');
