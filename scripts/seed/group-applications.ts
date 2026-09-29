import { and, eq, inArray } from 'drizzle-orm';
import { db } from './db';
import { groupMember } from '../../src/lib/server/db/schema/group';
import {
	groupApplication,
	groupApplicationChoice
} from '../../src/lib/server/db/schema/group-application';
import { type SeedUser } from './types';

/**
 * Committee applications in each state the review card and the applicant's list
 * render: new, contacted, a multi-committee one, a declined one with a reason,
 * and a withdrawn one. The blank-answer row is what a migrated request looks
 * like, since a roster row carried no answers.
 */
export async function seedGroupApplications(
	groups: { id: string; slug: string; kind: string; joinPolicy?: string | null }[],
	users: SeedUser[]
) {
	console.log('Seeding group applications...');

	// By kind, not by slug: a committee's name is the board's to change.
	const committees = groups.filter(
		(g) => g.kind === 'committee' && g.joinPolicy === 'by_application'
	);
	const [first, second] = committees;
	if (!first || !second) return [];

	// Skip anyone already on either roster or already applying (groups.ts seeds one).
	const [onRoster, applying] = await Promise.all([
		db
			.select({ userId: groupMember.userId })
			.from(groupMember)
			.where(inArray(groupMember.groupId, [first.id, second.id])),
		db
			.select({ userId: groupApplication.userId })
			.from(groupApplication)
			.innerJoin(
				groupApplicationChoice,
				eq(groupApplicationChoice.applicationId, groupApplication.id)
			)
			.where(and(inArray(groupApplicationChoice.groupId, [first.id, second.id])))
	]);
	const busy = new Set([...onRoster, ...applying].map((r) => r.userId));
	const pool = users.filter((u) => !busy.has(u.id));
	if (pool.length < 5) return [];

	type Choice = { groupId: string; status: 'submitted' | 'contacted' | 'declined'; notes?: string };
	const rows: {
		id: string;
		userId: string;
		answers: Record<string, string>;
		withdrawn?: boolean;
		choices: Choice[];
	}[] = [
		{
			id: 'seed-committee-app-new',
			userId: pool[0].id,
			answers: {
				experience:
					'Ran a house venue for three years and booked the Thursday series at the co-op.',
				vision: 'A room where a fifteen-year-old can play their first show on a Tuesday.'
			},
			choices: [{ groupId: first.id, status: 'submitted' }]
		},
		{
			id: 'seed-committee-app-contacted',
			userId: pool[1].id,
			answers: {
				experience: 'Tour managing, mostly regional. I know every load-in between here and Eugene.',
				vision: 'Fewer bills that are four bands who all sound the same.'
			},
			choices: [{ groupId: first.id, status: 'contacted' }]
		},
		{
			// One application naming two committees, each deciding for itself.
			id: 'seed-committee-app-multi',
			userId: pool[2].id,
			answers: {
				experience: 'Grant writing for a regional arts council; I also book a small festival.',
				vision: 'A calendar and a budget that know about each other.'
			},
			choices: [
				{ groupId: first.id, status: 'submitted' },
				{ groupId: second.id, status: 'submitted' }
			]
		},
		{
			// Migrated-request shape: no answers, because there were none.
			id: 'seed-committee-app-declined',
			userId: pool[3].id,
			answers: {},
			choices: [
				{
					groupId: first.id,
					status: 'declined',
					notes: 'We are full this term — please apply again after the March meeting.'
				}
			]
		},
		{
			id: 'seed-committee-app-withdrawn',
			userId: pool[4].id,
			answers: { experience: 'Sound engineering.', vision: '' },
			withdrawn: true,
			choices: [{ groupId: second.id, status: 'submitted' }]
		}
	];

	const now = new Date();
	await db.insert(groupApplication).values(
		rows.map((row, i) => ({
			id: row.id,
			userId: row.userId,
			answers: row.answers,
			withdrawnAt: row.withdrawn ? now : null,
			createdAt: new Date(now.getTime() - (i + 1) * 86_400_000),
			updatedAt: now
		}))
	);

	await db.insert(groupApplicationChoice).values(
		rows.flatMap((row) =>
			row.choices.map((c, j) => ({
				id: `${row.id}-choice-${j}`,
				applicationId: row.id,
				groupId: c.groupId,
				status: c.status,
				reviewNotes: c.notes ?? null,
				decidedAt: c.status === 'declined' ? now : null,
				createdAt: now,
				updatedAt: now
			}))
		)
	);

	return rows;
}
