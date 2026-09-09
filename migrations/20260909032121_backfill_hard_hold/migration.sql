-- Every hold that was hard under the old rule stays hard under the new one.
UPDATE `reservation` SET `hard_hold` = 1 WHERE `booker_type` = 'event_listing';
