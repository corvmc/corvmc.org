-- #2387: the template that auto-applied on production.created now starts a show when picked.
-- Only the template changes; work orders already stamped from it keep their duty_list_id.
UPDATE `duty_list` SET `project_kind` = 'production', `auto_apply_on` = NULL WHERE `auto_apply_on` = 'production.created';
