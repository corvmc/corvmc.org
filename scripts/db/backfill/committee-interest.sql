-- The volunteer-role interest rows, as committee applications.
--
-- `committees-and-roles-spec.md` decision 2 retires the `committee` bucket in
-- `volunteerRoleGroups` and says these rows "are the first applications and
-- should be migrated, not dropped — they are people who already put their hand
-- up". This is that migration; the roles themselves go in a later pass, once
-- these have landed.
--
-- One application per person carrying every committee they named, which is the
-- shape the paper form has: one submission, several boxes ticked.
--
-- Answers arrive EMPTY and that is not a defect. `volunteer_role_interest`
-- stores a user and a role and nothing else, so there is nothing to carry --
-- a chair will have to ask. Better that than inventing an answer.
--
-- Idempotent: the application id is derived from the user, so a re-run
-- collides with itself and writes nothing.

INSERT INTO committee_application (id, user_id, answers)
SELECT DISTINCT 'migrated-interest-' || i.user_id, i.user_id, '{}'
FROM volunteer_role_interest i
JOIN volunteer_role r ON r.id = i.volunteer_role_id AND r."group" = 'committee'
JOIN "group" g ON g.kind = 'committee' AND g.name = r.name
WHERE NOT EXISTS (
	SELECT 1 FROM committee_application a WHERE a.id = 'migrated-interest-' || i.user_id
);

INSERT INTO committee_application_choice (id, application_id, group_id, status)
SELECT DISTINCT 'migrated-choice-' || i.user_id || '-' || g.id,
       'migrated-interest-' || i.user_id,
       g.id,
       'submitted'
FROM volunteer_role_interest i
JOIN volunteer_role r ON r.id = i.volunteer_role_id AND r."group" = 'committee'
JOIN "group" g ON g.kind = 'committee' AND g.name = r.name
-- Not already on the committee: somebody seated since they registered interest
-- has nothing left to apply for.
WHERE NOT EXISTS (
	SELECT 1 FROM group_member m WHERE m.group_id = g.id AND m.user_id = i.user_id
)
AND NOT EXISTS (
	SELECT 1 FROM committee_application_choice c
	WHERE c.id = 'migrated-choice-' || i.user_id || '-' || g.id
);
