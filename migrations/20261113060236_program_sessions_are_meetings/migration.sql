-- A club's or committee's session is a meeting (#2607). createGroupEvent wrote
-- no kind, so the column default made each one a show. Series prototypes are
-- listings too, so later occurrences inherit the fix. Only the default moves.
UPDATE `event_listing` SET `kind` = 'meeting'
 WHERE `source` = 'group'
   AND `kind` = 'show'
   AND `group_id` IN (SELECT `id` FROM `group` WHERE `kind` IN ('club', 'committee'));
