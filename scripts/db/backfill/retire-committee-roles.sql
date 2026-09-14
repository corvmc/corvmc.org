-- Retire the six committee `volunteer_role` rows.
--
-- `committees-and-roles-spec.md` decision 2: a committee is a group, and the
-- volunteer roles that shadowed them retire. Their interest rows became
-- applications in `committee-interest.sql`, which has to have run first.
--
-- **Archived, not deleted.** Four `volunteer_hour_log` rows point at two of
-- these roles -- somebody logged committee work -- and that FK is
-- `onDelete: 'restrict'`. It should be: retiring a role does not un-happen the
-- work done under it, which is the same rule `getHoursByRole` follows.
--
-- The bucket moves because the `committee` value leaves `volunteerRoleGroups`
-- in the same change. `away-from-shows` is where committee work honestly sits,
-- and `is_active = 0` is what keeps these off the /contribute picker -- a
-- committee is applied to now, not signed up for.
--
-- Must run BEFORE the enum change deploys, or these rows read back as a value
-- the type does not admit.

UPDATE volunteer_role
SET "group" = 'away-from-shows', is_active = 0, updated_at = unixepoch()
WHERE "group" = 'committee';
