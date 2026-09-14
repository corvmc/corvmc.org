import { db } from './db';
import {
	committeeApplication,
	committeeApplicationChoice
} from '../../src/lib/server/db/schema/committee-application';
import { type SeedUser } from './types';

/**
 * Applications waiting on a committee chair — one of each state the panel
 * renders, since its job is to look different for each.
 *
 * The blank-answer row is deliberate: it is what an applicant migrated from
 * volunteer-role interest looks like, because that table stored no answers.
 */
export async function seedCommitteeApplications(
	groups: { id: string; slug: string; kind: string }[],
	users: SeedUser[]
) {
	console.log('Seeding committee applications...');

	// By kind, not by slug: the committee's name is the board's to change, and a
	// seeder that hard-codes one silently produces nothing the day it does.
	const committee = groups.find((g) => g.kind === 'committee');
	if (!committee || users.length < 3) return [];

	const rows: {
		id: string;
		userId: string;
		answers: Record<string, string>;
		status: 'submitted' | 'contacted' | 'declined';
		reviewNotes?: string;
	}[] = [
		{
			id: 'seed-committee-app-new',
			userId: users[0].id,
			answers: {
				experience:
					'Ran a house venue for three years and booked the Thursday series at the co-op.',
				vision: 'A room where a fifteen-year-old can play their first show on a Tuesday.'
			},
			status: 'submitted'
		},
		{
			id: 'seed-committee-app-contacted',
			userId: users[1].id,
			answers: {
				experience: 'Tour managing, mostly regional. I know every load-in between here and Eugene.',
				vision: 'Fewer bills that are four bands who all sound the same.'
			},
			status: 'contacted'
		},
		{
			// Migrated-from-interest shape: no answers, because there were none.
			id: 'seed-committee-app-declined',
			userId: users[2].id,
			answers: {},
			status: 'declined',
			reviewNotes: 'We are full this term — please apply again after the March meeting.'
		}
	];

	const now = new Date();
	await db.insert(committeeApplication).values(
		rows.map((row, i) => ({
			id: row.id,
			userId: row.userId,
			answers: row.answers,
			createdAt: new Date(now.getTime() - (i + 1) * 86_400_000),
			updatedAt: now
		}))
	);

	await db.insert(committeeApplicationChoice).values(
		rows.map((row) => ({
			id: `${row.id}-choice`,
			applicationId: row.id,
			groupId: committee.id,
			status: row.status,
			reviewNotes: row.reviewNotes ?? null,
			decidedAt: row.status === 'declined' ? now : null,
			createdAt: now,
			updatedAt: now
		}))
	);

	return rows;
}
