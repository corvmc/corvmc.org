-- Rename the built-in event audience (#2570). Rows staff have edited keep their text.
UPDATE `audience` SET `name` = 'Event audience' WHERE `system_key` = 'event-interest' AND `name` = 'This show''s audience';--> statement-breakpoint
UPDATE `audience` SET `description` = 'Everyone holding a ticket to the event a campaign is about, plus everyone who RSVP’d. Empty unless the campaign names an event.' WHERE `system_key` = 'event-interest' AND `description` = 'Everyone holding a ticket to the show a campaign is about, plus everyone who RSVP’d. Empty unless the campaign names a show.';
