import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { BallotInput } from './ballot-service';

/**
 * Ballots, against a real SQLite. Who is on the roll, what a vote writes and
 * when a tally may be read are all `WHERE` clauses and constraints, which a
 * mocked `db` would agree with either way.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite({ foreignKeys: true });
});

// better-sqlite3's drizzle has no `batch`; D1's runs the statements in order and
// stops at the first failure, as this does.
vi.mock('$lib/server/db', () => ({
	db: Object.assign(testDb, {
		batch: async (stmts: PromiseLike<unknown>[]) => {
			const out = [];
			for (const s of stmts) out.push(await s);
			return out;
		}
	}),
	getRowCount: (result: unknown) => (result as { changes?: number })?.changes ?? 0
}));

vi.mock('$lib/server/site-config/site-config-service', () => ({
	config: vi.fn(async () => 60)
}));

const emit = vi.fn(async () => undefined);
vi.mock('$lib/server/event-bus/event-bus', () => ({
	domainEvents: { emit: (...a: unknown[]) => emit(...(a as [])), on: vi.fn() }
}));

const recordAuditEntry = vi.fn(async () => undefined);
vi.mock('$lib/server/audit/audit-service', () => ({
	recordAuditEntry: (...a: unknown[]) => recordAuditEntry(...(a as []))
}));

const svc = await import('./ballot-service');
const { user } = await import('$lib/server/db/schema/authentication');
const { group, groupMember } = await import('$lib/server/db/schema/group');
const { memberOrientation } = await import('$lib/server/db/schema/volunteer');
const { ballotElector, ballotChoice, ballotParticipation, ballotRecordedVote } =
	await import('$lib/server/db/schema/ballot');
const { eq } = await import('drizzle-orm');

const DAY = 86_400_000;
const NOW = new Date('2026-09-24T12:00:00Z');
const LATER = new Date(NOW.getTime() + 7 * DAY);
const AFTER_CLOSE = new Date(LATER.getTime() + 60_000);

const STAFF = 'usr-staff';
const CERTIFIER = 'usr-certifier';
const VETERAN = 'usr-veteran';
const WAIVED = 'usr-waived';
const NEWCOMER = 'usr-newcomer';
const UNORIENTED = 'usr-unoriented';
const DEACTIVATED = 'usr-deactivated';
const BANNED = 'usr-banned';
const CHAIR = 'usr-chair';
const PENDING = 'usr-pending';
const COMMITTEE = 'grp-committee';
const A_BAND = 'grp-band';

function ago(days: number) {
	return new Date(NOW.getTime() - days * DAY);
}

async function seed() {
	await testDb.insert(user).values(
		[
			[STAFF, 400],
			[CERTIFIER, 400],
			[VETERAN, 400],
			[WAIVED, 90],
			[NEWCOMER, 10],
			[UNORIENTED, 400],
			[DEACTIVATED, 400],
			[BANNED, 400],
			[CHAIR, 400],
			[PENDING, 400]
		].map(([id, age]) => ({
			id: id as string,
			name: id as string,
			email: `${id}@example.com`,
			emailVerified: true,
			createdAt: ago(age as number),
			deletedAt: id === DEACTIVATED || id === BANNED ? ago(1) : null,
			bannedAt: id === BANNED ? ago(1) : null
		})) as never
	);
	await testDb.insert(memberOrientation).values(
		[VETERAN, NEWCOMER, DEACTIVATED, BANNED, CHAIR, PENDING, CERTIFIER, STAFF].map((userId) => ({
			userId,
			completedAt: ago(300)
		}))
	);
	await testDb
		.insert(memberOrientation)
		.values({ userId: WAIVED, waivedAt: ago(80), waivedReason: 'Played here for years' });
	await testDb.insert(group).values([
		{ id: COMMITTEE, kind: 'committee', name: 'Board', slug: 'board' },
		{ id: A_BAND, kind: 'band', name: 'A Band', slug: 'a-band' }
	] as never);
	await testDb.insert(groupMember).values([
		{ groupId: COMMITTEE, userId: CHAIR, role: 'owner', status: 'active' },
		{ groupId: COMMITTEE, userId: VETERAN, role: 'member', status: 'active' },
		{ groupId: COMMITTEE, userId: NEWCOMER, role: 'member', status: 'active' },
		{ groupId: COMMITTEE, userId: PENDING, role: 'member', status: 'pending' }
	] as never);
}

beforeEach(async () => {
	emit.mockClear();
	recordAuditEntry.mockClear();
	for (const t of [
		'ballot_recorded_vote',
		'ballot_choice',
		'ballot_participation',
		'ballot_elector_override',
		'ballot_elector',
		'ballot_option',
		'ballot',
		'member_orientation',
		'group_member',
		'"group"',
		'user'
	]) {
		sqlite.exec(`delete from ${t}`);
	}
	await seed();
});

function memberBallot(overrides: Partial<BallotInput> = {}) {
	return svc.createBallot(
		{
			kind: 'member',
			title: 'Adopt the amended bylaws',
			options: ['Yes', 'No'],
			closesAt: LATER,
			certifierId: CERTIFIER,
			...overrides
		},
		{ actorId: STAFF, now: NOW }
	);
}

function groupBallot() {
	return svc.createBallot(
		{
			kind: 'group',
			groupId: COMMITTEE,
			title: 'Approve the budget',
			options: ['Approve', 'Reject', 'Table it'],
			closesAt: LATER,
			certifierId: CHAIR
		},
		{ actorId: CHAIR, now: NOW }
	);
}

async function roll(ballotId: string) {
	const rows = await testDb
		.select({ userId: ballotElector.userId })
		.from(ballotElector)
		.where(eq(ballotElector.ballotId, ballotId));
	return rows.map((r) => r.userId).sort();
}

describe('status', () => {
	it('is derived from the timestamps', async () => {
		const id = await memberBallot();
		const b = await svc.getBallot(id);
		expect(svc.ballotStatusOf(b, NOW)).toBe('draft');
		await svc.openBallot(id, { now: NOW });
		const opened = await svc.getBallot(id);
		expect(svc.ballotStatusOf(opened, NOW)).toBe('open');
		expect(svc.ballotStatusOf(opened, AFTER_CLOSE)).toBe('closed');
	});
});

describe('creating', () => {
	it('refuses a group ballot on a band', async () => {
		await expect(
			svc.createBallot(
				{
					kind: 'group',
					groupId: A_BAND,
					title: 'Tour?',
					options: ['Yes', 'No'],
					closesAt: LATER,
					certifierId: CHAIR
				},
				{ actorId: CHAIR, now: NOW }
			)
		).rejects.toBeInstanceOf(svc.BallotValidationError);
	});

	it('refuses fewer than two distinct options', async () => {
		await expect(memberBallot({ options: ['Yes', ' Yes '] })).rejects.toBeInstanceOf(
			svc.BallotValidationError
		);
	});

	it('refuses a close date in the past', async () => {
		await expect(memberBallot({ closesAt: ago(1) })).rejects.toBeInstanceOf(
			svc.BallotValidationError
		);
	});
});

describe('opening a member-wide ballot', () => {
	it('freezes members of record: active, old enough, oriented or waived', async () => {
		const id = await memberBallot();
		await svc.openBallot(id, { now: NOW });
		expect(await roll(id)).toEqual([CERTIFIER, CHAIR, PENDING, STAFF, VETERAN, WAIVED].sort());
		expect((await svc.getBallot(id)).electorateSize).toBe(6);
	});

	it('applies overrides made on the draft, and audits each', async () => {
		const id = await memberBallot();
		await svc.setElectorOverride(
			id,
			{ userId: NEWCOMER, include: true, reason: 'Founding member, new account' },
			{ actorId: STAFF, now: NOW }
		);
		await svc.setElectorOverride(
			id,
			{ userId: VETERAN, include: false, reason: 'Asked to be left off' },
			{ actorId: STAFF, now: NOW }
		);
		await svc.openBallot(id, { now: NOW });

		const r = await roll(id);
		expect(r).toContain(NEWCOMER);
		expect(r).not.toContain(VETERAN);
		expect(recordAuditEntry).toHaveBeenCalledTimes(2);
		expect(recordAuditEntry).toHaveBeenCalledWith(
			expect.objectContaining({
				action: 'ballot.elector_overridden',
				subject: expect.objectContaining({ type: 'user', id: NEWCOMER })
			})
		);
	});

	it('does not let an include override admit a banned account', async () => {
		const id = await memberBallot();
		await svc.setElectorOverride(
			id,
			{ userId: BANNED, include: true, reason: 'Mistake' },
			{ actorId: STAFF, now: NOW }
		);
		await svc.openBallot(id, { now: NOW });
		expect(await roll(id)).not.toContain(BANNED);
	});

	it('is not changed by someone finishing orientation after it opened', async () => {
		const id = await memberBallot();
		await svc.openBallot(id, { now: NOW });
		await testDb.insert(memberOrientation).values({ userId: UNORIENTED, completedAt: NOW });
		expect(await roll(id)).not.toContain(UNORIENTED);
	});

	it('starts one counter per option at zero', async () => {
		const id = await memberBallot();
		await svc.openBallot(id, { now: NOW });
		const counters = await testDb.select().from(ballotChoice).where(eq(ballotChoice.ballotId, id));
		expect(counters).toHaveLength(2);
		expect(counters.every((c) => c.votes === 0)).toBe(true);
	});

	it('cannot be opened twice', async () => {
		const id = await memberBallot();
		await svc.openBallot(id, { now: NOW });
		await expect(svc.openBallot(id, { now: NOW })).rejects.toBeInstanceOf(svc.BallotStateError);
	});
});

describe('opening a group ballot', () => {
	it('freezes the active roster, not pending invitations', async () => {
		const id = await groupBallot();
		await svc.openBallot(id, { now: NOW });
		expect(await roll(id)).toEqual([CHAIR, NEWCOMER, VETERAN].sort());
	});
});

describe('a secret vote', () => {
	async function openMember() {
		const id = await memberBallot();
		await svc.openBallot(id, { now: NOW });
		const b = await svc.getBallotDetail(id);
		return { id, yes: b.options[0].id, no: b.options[1].id };
	}

	it('records participation and increments a counter, and nothing links them', async () => {
		const { id, yes } = await openMember();
		await svc.castVote(id, VETERAN, yes, { now: NOW });

		const participation = await testDb
			.select()
			.from(ballotParticipation)
			.where(eq(ballotParticipation.ballotId, id));
		expect(participation).toEqual([{ ballotId: id, userId: VETERAN }]);

		const counters = await testDb.select().from(ballotChoice).where(eq(ballotChoice.ballotId, id));
		expect(counters.find((c) => c.optionId === yes)?.votes).toBe(1);
		for (const row of counters) expect(Object.values(row)).not.toContain(VETERAN);

		const recorded = await testDb.select().from(ballotRecordedVote);
		expect(recorded).toEqual([]);
	});

	it('refuses a second vote and leaves the counters alone', async () => {
		const { id, yes, no } = await openMember();
		await svc.castVote(id, VETERAN, yes, { now: NOW });
		await expect(svc.castVote(id, VETERAN, no, { now: NOW })).rejects.toBeInstanceOf(
			svc.AlreadyVotedError
		);
		const counters = await testDb.select().from(ballotChoice).where(eq(ballotChoice.ballotId, id));
		expect(counters.reduce((n, c) => n + c.votes, 0)).toBe(1);
	});

	it('refuses someone not on the roll', async () => {
		const { id, yes } = await openMember();
		await expect(svc.castVote(id, NEWCOMER, yes, { now: NOW })).rejects.toBeInstanceOf(
			svc.NotAnElectorError
		);
	});

	it('refuses an option from another ballot', async () => {
		const { id } = await openMember();
		const other = await groupBallot();
		const otherOption = (await svc.getBallotDetail(other)).options[0].id;
		await expect(svc.castVote(id, VETERAN, otherOption, { now: NOW })).rejects.toBeInstanceOf(
			svc.BallotValidationError
		);
	});

	it('refuses a vote after the close', async () => {
		const { id, yes } = await openMember();
		await expect(svc.castVote(id, VETERAN, yes, { now: AFTER_CLOSE })).rejects.toBeInstanceOf(
			svc.BallotStateError
		);
	});

	it('tells the voter only that they voted', async () => {
		const { id, yes } = await openMember();
		await svc.castVote(id, VETERAN, yes, { now: NOW });
		expect(await svc.getMyVote(id, VETERAN)).toEqual({ voted: true, optionId: null });
	});

	it('refuses an exclude override for someone who already voted', async () => {
		const { id, yes } = await openMember();
		await svc.castVote(id, VETERAN, yes, { now: NOW });
		await expect(
			svc.setElectorOverride(
				id,
				{ userId: VETERAN, include: false, reason: 'Late objection' },
				{ actorId: STAFF, now: NOW }
			)
		).rejects.toBeInstanceOf(svc.BallotStateError);
	});

	it('adds to the frozen roll when an include override is made while open', async () => {
		const { id, yes } = await openMember();
		await svc.setElectorOverride(
			id,
			{ userId: NEWCOMER, include: true, reason: 'Missed off' },
			{ actorId: STAFF, now: NOW }
		);
		expect((await svc.getBallot(id)).electorateSize).toBe(7);
		await svc.castVote(id, NEWCOMER, yes, { now: NOW });
	});
});

describe('a recorded vote', () => {
	it('can be changed before the close, and shows in the roll call after it', async () => {
		const id = await groupBallot();
		await svc.openBallot(id, { now: NOW });
		const [approve, reject] = (await svc.getBallotDetail(id)).options;

		await svc.castVote(id, VETERAN, approve.id, { now: NOW });
		await svc.castVote(id, VETERAN, reject.id, { now: NOW });
		expect(await svc.getMyVote(id, VETERAN)).toEqual({ voted: true, optionId: reject.id });

		const tally = await svc.getTally(id, { now: AFTER_CLOSE });
		expect(tally.turnout).toBe(1);
		expect(tally.options.find((o) => o.optionId === reject.id)?.votes).toBe(1);
		expect(tally.rollCall).toEqual([
			expect.objectContaining({ userId: VETERAN, optionId: reject.id })
		]);
	});
});

describe('the tally', () => {
	it('is refused before the close, whoever asks', async () => {
		const id = await memberBallot();
		await svc.openBallot(id, { now: NOW });
		await expect(svc.getTally(id, { now: NOW })).rejects.toBeInstanceOf(svc.TallyHiddenError);
	});

	it('has no roll call on a secret ballot', async () => {
		const id = await memberBallot();
		await svc.openBallot(id, { now: NOW });
		const yes = (await svc.getBallotDetail(id)).options[0].id;
		await svc.castVote(id, VETERAN, yes, { now: NOW });
		const tally = await svc.getTally(id, { now: AFTER_CLOSE });
		expect(tally.rollCall).toBeNull();
		expect(tally.turnout).toBe(1);
		expect(tally.electorateSize).toBe(6);
	});

	it('reports turnout, and never direction, while open', async () => {
		const id = await memberBallot();
		await svc.openBallot(id, { now: NOW });
		const yes = (await svc.getBallotDetail(id)).options[0].id;
		await svc.castVote(id, VETERAN, yes, { now: NOW });
		expect(await svc.getTurnout(id)).toEqual({ voted: 1, electorateSize: 6 });
	});
});

describe('certifying', () => {
	async function closedWithVotes() {
		const id = await memberBallot();
		await svc.openBallot(id, { now: NOW });
		const [yes, no] = (await svc.getBallotDetail(id)).options;
		await svc.castVote(id, VETERAN, yes.id, { now: NOW });
		await svc.castVote(id, WAIVED, yes.id, { now: NOW });
		await svc.castVote(id, CHAIR, no.id, { now: NOW });
		return { id, yes, no };
	}

	it('is refused to anyone but the named certifier', async () => {
		const { id } = await closedWithVotes();
		await expect(svc.certifyBallot(id, STAFF, { now: AFTER_CLOSE })).rejects.toBeInstanceOf(
			svc.NotCertifierError
		);
	});

	it('is refused before the close', async () => {
		const { id } = await closedWithVotes();
		await expect(svc.certifyBallot(id, CERTIFIER, { now: NOW })).rejects.toBeInstanceOf(
			svc.BallotStateError
		);
	});

	it('snapshots the result, emits once, and cannot be repeated', async () => {
		const { id, yes, no } = await closedWithVotes();
		await svc.certifyBallot(id, CERTIFIER, { now: AFTER_CLOSE });

		const b = await svc.getBallot(id);
		expect(svc.ballotStatusOf(b, AFTER_CLOSE)).toBe('certified');
		expect(b.certifiedResult).toEqual({
			options: [
				{ optionId: yes.id, label: 'Yes', votes: 2 },
				{ optionId: no.id, label: 'No', votes: 1 }
			],
			turnout: 3,
			electorateSize: 6
		});
		expect(emit).toHaveBeenCalledWith(
			'ballot.certified',
			expect.objectContaining({ ballotId: id })
		);

		await expect(svc.certifyBallot(id, CERTIFIER, { now: AFTER_CLOSE })).rejects.toBeInstanceOf(
			svc.BallotStateError
		);
	});

	it('keeps the certified result when a voter is later purged', async () => {
		const { id } = await closedWithVotes();
		await svc.certifyBallot(id, CERTIFIER, { now: AFTER_CLOSE });
		sqlite.exec(`delete from user where id = '${CHAIR}'`);
		const tally = await svc.getTally(id, { now: AFTER_CLOSE });
		expect(tally.turnout).toBe(3);
	});
});

describe('cancelling', () => {
	it('needs a reason, ends voting, and hides the result for good', async () => {
		const id = await memberBallot();
		await svc.openBallot(id, { now: NOW });
		await svc.cancelBallot(id, 'Wrong wording', { now: NOW });
		const yes = (await svc.getBallotDetail(id)).options[0].id;
		await expect(svc.castVote(id, VETERAN, yes, { now: NOW })).rejects.toBeInstanceOf(
			svc.BallotStateError
		);
		await expect(svc.getTally(id, { now: AFTER_CLOSE })).rejects.toBeInstanceOf(
			svc.TallyHiddenError
		);
	});
});
