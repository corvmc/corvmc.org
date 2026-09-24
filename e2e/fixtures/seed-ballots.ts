/**
 * Two member-wide ballots for `ballots.e2e.ts`, both with the staff operator on
 * the roll and named as certifier:
 *
 *  - one open, nobody has voted, so the test can cast the secret vote;
 *  - one closed and uncertified, with two votes already counted, so the test
 *    can certify it and read the published result.
 *
 * Run after `seedStaffUser`, whose operator and role target it reuses.
 */
import { eq, inArray, sql } from 'drizzle-orm';
import {
	ballot,
	ballotChoice,
	ballotElector,
	ballotOption,
	ballotParticipation
} from '../../src/lib/server/db/schema/ballot';
import { readLocalDb, withPlatformDb } from './platform-db';
import { SEED_STAFF_ID, SEED_TARGET_ID } from './seed-staff-user';

export const SEED_BALLOT_OPEN_ID = 'e2e-ballot-open';
export const SEED_BALLOT_CLOSED_ID = 'e2e-ballot-closed';
export const SEED_BALLOT_CLOSED_TITLE = 'E2E: adopt the closed motion';

const DAY = 86_400_000;
const IDS = [SEED_BALLOT_OPEN_ID, SEED_BALLOT_CLOSED_ID];

export async function seedBallots(): Promise<void> {
	await withPlatformDb(async (db) => {
		await db.delete(ballot).where(inArray(ballot.id, IDS));
		const now = Date.now();

		for (const spec of [
			{
				id: SEED_BALLOT_OPEN_ID,
				title: 'E2E: adopt the open motion',
				openedAt: new Date(now - DAY),
				closesAt: new Date(now + 7 * DAY),
				votes: [0, 0],
				voters: [] as string[]
			},
			{
				id: SEED_BALLOT_CLOSED_ID,
				title: SEED_BALLOT_CLOSED_TITLE,
				openedAt: new Date(now - 10 * DAY),
				closesAt: new Date(now - DAY),
				votes: [2, 0],
				voters: [SEED_STAFF_ID, SEED_TARGET_ID]
			}
		]) {
			await db.insert(ballot).values({
				id: spec.id,
				kind: 'member',
				title: spec.title,
				closesAt: spec.closesAt,
				certifierId: SEED_STAFF_ID,
				createdById: SEED_STAFF_ID,
				openedAt: spec.openedAt,
				openNoticeSentAt: spec.openedAt,
				electorateSize: 2
			});
			await db.insert(ballotOption).values([
				{ id: `${spec.id}-yes`, ballotId: spec.id, label: 'Yes', position: 0 },
				{ id: `${spec.id}-no`, ballotId: spec.id, label: 'No', position: 1 }
			]);
			await db.insert(ballotElector).values([
				{ ballotId: spec.id, userId: SEED_STAFF_ID },
				{ ballotId: spec.id, userId: SEED_TARGET_ID }
			]);
			await db.insert(ballotChoice).values([
				{ ballotId: spec.id, optionId: `${spec.id}-yes`, votes: spec.votes[0] },
				{ ballotId: spec.id, optionId: `${spec.id}-no`, votes: spec.votes[1] }
			]);
			if (spec.voters.length) {
				await db
					.insert(ballotParticipation)
					.values(spec.voters.map((userId) => ({ ballotId: spec.id, userId })));
			}
		}
	});
}

/** Participation rows and the counter total, which must always agree. */
export function readSecretTally(ballotId: string) {
	return readLocalDb(async (db) => {
		const [p] = await db
			.select({ n: sql<number>`count(*)` })
			.from(ballotParticipation)
			.where(eq(ballotParticipation.ballotId, ballotId));
		const [c] = await db
			.select({ n: sql<number>`coalesce(sum(${ballotChoice.votes}), 0)` })
			.from(ballotChoice)
			.where(eq(ballotChoice.ballotId, ballotId));
		return { participation: Number(p.n), counted: Number(c.n) };
	});
}

export function readCertifiedAt(ballotId: string) {
	return readLocalDb(async (db) => {
		const [row] = await db
			.select({ certifiedAt: ballot.certifiedAt })
			.from(ballot)
			.where(eq(ballot.id, ballotId));
		return row?.certifiedAt ?? null;
	});
}
