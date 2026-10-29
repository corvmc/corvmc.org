-- Templates are stamped into projects now (#2034). An event-subject list becomes a
-- project template; its `start`/`doors`/`end` anchors already mean the project's
-- event, so the anchor stays. Work orders it already stamped are left alone.
UPDATE `duty_list` SET `subject` = 'project', `updated_at` = unixepoch() WHERE `subject` = 'event';
