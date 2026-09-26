import { and, eq, sql } from 'drizzle-orm';
import { db } from './db';
import {
	ballot,
	ballotChoice,
	ballotElector,
	ballotElectorOverride,
	ballotOption,
	ballotParticipation,
	ballotRecordedVote
} from '../../src/lib/server/db/schema/ballot';
import { groupMember } from '../../src/lib/server/db/schema/group';
import { auditLog } from '../../src/lib/server/db/schema/audit';
import { suggestion } from '../../src/lib/server/db/schema/suggestion';
import { project } from '../../src/lib/server/db/schema/project';
import { GROUP_LEADER_PERSONAS } from './group-leaders';
import type { SeedUser } from './types';

const DAY = 86_400_000;

/**
 * The seeded rolls: active accounts old enough at open. The orientation half of
 * the rule is left out because the seed orients only a handful of members, and
 * a roll of two cannot show a secret tally. Drafts preview the real rule.
 */
const memberOfRecord = (cutoff: Date) => sql`
	select id from user
	where deleted_at is null and banned_at is null
	  and created_at <= ${Math.floor(cutoff.getTime() / 1000)}`;

/**
 * One ballot of each kind that a login can act on, plus a certified result:
 *
 * - the Booking Committee's recorded ballot, open, which its chair can vote on,
 *   change, and certify once it closes;
 * - an open member-wide ballot the admin is on through an audited override;
 * - last spring's certified member-wide result, which every member can read;
 * - one whole idea → decision → work chain: a suggestion, the certified ballot
 *   that passed it, and the project that result authorised.
 */
export async function seedBallots(
	groups: { id: string; slug: string; kind: string }[],
	adminUser: SeedUser
) {
	console.log('Seeding ballots...');
	const now = new Date();
	const chairId = GROUP_LEADER_PERSONAS[1].id;
	const committee = groups.find((g) => g.slug === 'booking-committee');

	let count = 0;

	const chainSuggestionId = 'seed-suggestion-back-room-pa';
	await db.insert(suggestion).values({
		id: chainSuggestionId,
		authorUserId: chairId,
		title: 'A PA for the back room',
		body: 'The back room has no sound of its own, so every workshop borrows the main PA.',
		category: 'gear_equipment',
		status: 'planned',
		createdAt: new Date(now.getTime() - 60 * DAY)
	});

	if (committee) {
		const id = 'seed-ballot-committee';
		const roster = await db
			.select({ userId: groupMember.userId })
			.from(groupMember)
			.where(and(eq(groupMember.groupId, committee.id), eq(groupMember.status, 'active')));
		const options = ['Approve the fall calendar', 'Send it back with notes'];
		await db.insert(ballot).values({
			id,
			kind: 'group',
			groupId: committee.id,
			title: 'Approve the fall booking calendar',
			description: 'The draft calendar was circulated at the September meeting.',
			closesAt: new Date(now.getTime() + 5 * DAY),
			certifierId: chairId,
			createdById: chairId,
			openedAt: new Date(now.getTime() - 2 * DAY),
			openNoticeSentAt: new Date(now.getTime() - 2 * DAY),
			electorateSize: roster.length
		});
		await db.insert(ballotOption).values(
			options.map((label, position) => ({
				id: `${id}-opt-${position}`,
				ballotId: id,
				label,
				position
			}))
		);
		if (roster.length) {
			await db
				.insert(ballotElector)
				.values(roster.map((r) => ({ ballotId: id, userId: r.userId })));
			const voters = roster.filter((r) => r.userId !== chairId).slice(0, 2);
			if (voters.length) {
				await db.insert(ballotRecordedVote).values(
					voters.map((v, i) => ({
						ballotId: id,
						userId: v.userId,
						optionId: `${id}-opt-${i % 2}`
					}))
				);
			}
		}
		count++;
	}

	for (const spec of [
		{
			id: 'seed-ballot-member-open',
			title: 'Adopt the amended bylaws',
			description: 'Article IV is amended to add a youth seat on the board.',
			openedAt: new Date(now.getTime() - DAY),
			closesAt: new Date(now.getTime() + 13 * DAY),
			options: ['Yes', 'No'],
			certified: false
		},
		{
			id: 'seed-ballot-member-certified',
			title: 'Elect the 2026 board treasurer',
			description: null,
			openedAt: new Date(now.getTime() - 180 * DAY),
			closesAt: new Date(now.getTime() - 166 * DAY),
			options: ['Jordan Ames', 'Kim Osei'],
			certified: true
		},
		{
			id: 'seed-ballot-member-chain',
			title: 'Buy a PA for the back room?',
			description: 'Put to the members from the suggestion board.',
			openedAt: new Date(now.getTime() - 40 * DAY),
			closesAt: new Date(now.getTime() - 26 * DAY),
			options: ['Yes', 'No'],
			certified: true,
			suggestionId: chainSuggestionId
		}
	]) {
		await db.insert(ballot).values({
			id: spec.id,
			kind: 'member',
			suggestionId: 'suggestionId' in spec ? spec.suggestionId : null,
			title: spec.title,
			description: spec.description,
			closesAt: spec.closesAt,
			certifierId: adminUser.id,
			createdById: adminUser.id,
			openedAt: spec.openedAt,
			openNoticeSentAt: spec.openedAt
		});
		await db.insert(ballotOption).values(
			spec.options.map((label, position) => ({
				id: `${spec.id}-opt-${position}`,
				ballotId: spec.id,
				label,
				position
			}))
		);

		if (!spec.certified) {
			const reason = 'Staff account, created after the cutoff; votes as a founding member';
			await db.insert(ballotElectorOverride).values({
				ballotId: spec.id,
				userId: adminUser.id,
				include: true,
				reason,
				createdById: adminUser.id
			});
			await db.insert(auditLog).values({
				action: 'ballot.elector_overridden',
				actorUserId: adminUser.id,
				actorName: adminUser.name,
				actorEmail: adminUser.email,
				subjectType: 'user',
				subjectId: adminUser.id,
				subjectLabel: adminUser.name,
				details: { ballotId: spec.id, ballotTitle: spec.title, include: true, reason }
			});
		}

		const cutoff = new Date(spec.openedAt.getTime() - 60 * DAY);
		await db.run(sql`
			insert into ballot_elector (ballot_id, user_id)
			select ${spec.id}, id from (${memberOfRecord(cutoff)})
			${spec.certified ? sql`` : sql`union select ${spec.id}, ${adminUser.id}`}`);
		const roll = await db
			.select({ userId: ballotElector.userId })
			.from(ballotElector)
			.where(eq(ballotElector.ballotId, spec.id));

		// Secret votes: participation for the first two thirds of the roll, counters that sum to it.
		const voters = roll
			.filter((r) => r.userId !== adminUser.id)
			.slice(0, Math.floor((roll.length * 2) / 3));
		for (let i = 0; i < voters.length; i += 40) {
			await db
				.insert(ballotParticipation)
				.values(voters.slice(i, i + 40).map((v) => ({ ballotId: spec.id, userId: v.userId })));
		}
		const first = Math.ceil(voters.length * 0.6);
		const votes = [first, voters.length - first];
		await db.insert(ballotChoice).values(
			spec.options.map((_, position) => ({
				ballotId: spec.id,
				optionId: `${spec.id}-opt-${position}`,
				votes: votes[position]
			}))
		);

		await db
			.update(ballot)
			.set({
				electorateSize: roll.length,
				...(spec.certified
					? {
							certifiedAt: new Date(spec.closesAt.getTime() + 2 * DAY),
							certifiedById: adminUser.id,
							resultPublishedAt: new Date(spec.closesAt.getTime() + 2 * DAY),
							certifiedResult: {
								options: spec.options.map((label, position) => ({
									optionId: `${spec.id}-opt-${position}`,
									label,
									votes: votes[position]
								})),
								turnout: voters.length,
								electorateSize: roll.length
							}
						}
					: {})
			})
			.where(eq(ballot.id, spec.id));
		count++;
	}

	await db.insert(project).values({
		id: 'seed-project-back-room-pa',
		name: 'Back room PA',
		description: 'Authorised by the members; see Why this exists.',
		status: 'planned',
		suggestionId: chainSuggestionId,
		ballotId: 'seed-ballot-member-chain',
		budgetCents: 180_000,
		createdByUserId: adminUser.id
	});

	return { ballots: count };
}
