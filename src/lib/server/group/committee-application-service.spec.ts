import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Committee applications, against a real SQLite.
 *
 * The rules worth pinning are all `WHERE` clauses a mocked `db` would agree
 * with either way: which committees a submission drops, which choices a chair
 * may act on, and that a decline keeps the row where the group equivalent
 * deletes it.
 */

/**
 * The whole schema, replayed from the committed migrations.
 *
 * Not `ddlFor(table)` as three sibling specs use: that lifts the `CREATE TABLE`
 * out of the migration that last created it, and `event` was renamed to
 * `event_listing` after creation, so it finds nothing. Replaying every
 * migration is what a rename survives, and it is what `db:migrate:local` does.
 */
const { sqlite, testDb } = vi.hoisted(() => {
	/* eslint-disable @typescript-eslint/no-require-imports */
	const { readFileSync, globSync } = require('node:fs') as typeof import('node:fs');
	const Database = require('better-sqlite3') as typeof import('better-sqlite3');
	const { drizzle } =
		require('drizzle-orm/better-sqlite3') as typeof import('drizzle-orm/better-sqlite3');
	/* eslint-enable @typescript-eslint/no-require-imports */

	const sqlite = new Database(':memory:');

	for (const file of globSync('migrations/*/migration.sql').sort()) {
		for (const statement of readFileSync(file, 'utf8')
			.split('--> statement-breakpoint')
			.map((s: string) => s.trim())
			.filter(Boolean)) {
			sqlite.exec(statement);
		}
	}

	// After the replay, not before: a table rebuild toggles this pragma back on
	// as its last statement. Off for the same reason the sibling specs turn it
	// off — these are aggregate queries, and seeding every referenced parent
	// row would test nothing extra.
	sqlite.pragma('foreign_keys = OFF');

	// `drizzle({ client })`, not `drizzle(client)` — the positional overload is
	// gone in drizzle 1.0 and a raw Database is read as a config object, which
	// quietly opens a second, empty database.
	return { sqlite, testDb: drizzle({ client: sqlite }) };
});

// `getRowCount` reads D1's `meta.changes`; better-sqlite3 reports `changes` at
// the top level. Left real, every update here would look like it matched no
// rows — which is a false *pass* on any test expecting a throw.
vi.mock('$lib/server/db', () => ({
	db: testDb,
	getRowCount: (result: unknown) => (result as { changes?: number })?.changes ?? 0
}));

const invite = vi.fn(async () => undefined);
vi.mock('$lib/server/band/band-service', () => ({
	invite: (...a: unknown[]) => invite(...(a as []))
}));

const svc = await import('./committee-application-service');

const BOOKING = 'grp-booking';
const FACILITY = 'grp-facility';
const A_BAND = 'grp-band';
const APPLICANT = 'usr-applicant';
const CHAIR = 'usr-chair';

async function seed() {
	const { user } = await import('$lib/server/db/schema/authentication');
	const { group } = await import('$lib/server/db/schema/group');
	await testDb.insert(user).values([
		{ id: APPLICANT, name: 'Ada', email: 'ada@example.com', emailVerified: false },
		{ id: CHAIR, name: 'Chair', email: 'chair@example.com', emailVerified: false }
	] as never);
	await testDb.insert(group).values([
		{ id: BOOKING, kind: 'committee', name: 'Booking Committee', slug: 'booking-committee' },
		{ id: FACILITY, kind: 'committee', name: 'Facility Committee', slug: 'facility-committee' },
		{ id: A_BAND, kind: 'band', name: 'A Band', slug: 'a-band' }
	] as never);
}

beforeEach(async () => {
	invite.mockClear();
	for (const t of [
		'committee_application_choice',
		'committee_application',
		'group_member',
		'"group"',
		'user'
	]) {
		sqlite.exec(`delete from ${t}`);
	}
	await seed();
});

const answers = { experience: 'Booked a basement series', vision: 'Somewhere to play at 17' };

describe('submitting', () => {
	it('writes one application and a choice per committee', async () => {
		const id = await svc.submitApplication(APPLICANT, { groupIds: [BOOKING, FACILITY], answers });

		const mine = await svc.listForApplicant(APPLICANT);
		expect(mine).toHaveLength(1);
		expect(mine[0].id).toBe(id);
		expect(mine[0].answers).toEqual(answers);
		expect(mine[0].committees.map((c) => c.name).sort()).toEqual([
			'Booking Committee',
			'Facility Committee'
		]);
	});

	it('refuses a band, which has no applications', async () => {
		await expect(
			svc.submitApplication(APPLICANT, { groupIds: [A_BAND], answers })
		).rejects.toBeInstanceOf(svc.NotACommitteeError);
	});

	it('refuses an empty tick list rather than writing an empty application', async () => {
		await expect(
			svc.submitApplication(APPLICANT, { groupIds: [], answers })
		).rejects.toBeInstanceOf(svc.NoCommitteeChosenError);
	});

	it('drops a committee you are already applying to, and keeps the rest', async () => {
		await svc.submitApplication(APPLICANT, { groupIds: [BOOKING], answers });
		await svc.submitApplication(APPLICANT, { groupIds: [BOOKING, FACILITY], answers });

		// Re-ticking a box is a mistake, not a conflict: the second submission
		// carries only Facility rather than erroring on Booking.
		const open = await svc.listForCommittee(BOOKING);
		expect(open).toHaveLength(1);
		expect(await svc.listForCommittee(FACILITY)).toHaveLength(1);
	});

	it('drops a committee you are already on', async () => {
		const { groupMember } = await import('$lib/server/db/schema/group');
		await testDb.insert(groupMember).values({
			id: 'gm-1',
			groupId: BOOKING,
			userId: APPLICANT,
			role: 'member',
			status: 'active'
		} as never);

		await expect(
			svc.submitApplication(APPLICANT, { groupIds: [BOOKING], answers })
		).rejects.toBeInstanceOf(svc.NoCommitteeChosenError);
	});

	it('lets a declined applicant apply again — the whole reason this is not group_member', async () => {
		await svc.submitApplication(APPLICANT, { groupIds: [BOOKING], answers });
		const [first] = await svc.listForCommittee(BOOKING);
		await svc.declineApplication(first.choiceId, BOOKING, CHAIR, 'Not this round');

		await expect(
			svc.submitApplication(APPLICANT, { groupIds: [BOOKING], answers })
		).resolves.toBeTruthy();
		expect(await svc.listForCommittee(BOOKING)).toHaveLength(1);
	});
});

describe('the chair', () => {
	async function submitted() {
		await svc.submitApplication(APPLICANT, { groupIds: [BOOKING, FACILITY], answers });
		const [choice] = await svc.listForCommittee(BOOKING);
		return choice;
	}

	it('sees the answers beside the applicant', async () => {
		const choice = await submitted();
		expect(choice.answers).toEqual(answers);
		expect(choice.applicant.title).toBe('Ada');
	});

	it('sees only their own committee’s half', async () => {
		await submitted();
		// The paper form ticks several; a chair answers for one.
		expect(await svc.listForCommittee(BOOKING)).toHaveLength(1);
		expect(await svc.listForCommittee(FACILITY)).toHaveLength(1);
		expect(await svc.listForCommittee(A_BAND)).toHaveLength(0);
	});

	it('cannot act on another committee’s choice', async () => {
		const choice = await submitted();
		await expect(svc.acceptApplication(choice.choiceId, FACILITY, CHAIR)).rejects.toBeInstanceOf(
			svc.ApplicationNotFoundError
		);
	});

	it('records contact without deciding', async () => {
		const choice = await submitted();
		await svc.markContacted(choice.choiceId, BOOKING, CHAIR);
		const [after] = await svc.listForCommittee(BOOKING);
		expect(after.status).toBe('contacted');
	});

	it('accepts by inviting rather than seating', async () => {
		const choice = await submitted();
		await svc.acceptApplication(choice.choiceId, BOOKING, CHAIR);

		expect(invite).toHaveBeenCalledWith(BOOKING, APPLICANT, 'member', null, CHAIR);
		// Off the open list, and Facility is untouched.
		expect(await svc.listForCommittee(BOOKING)).toHaveLength(0);
		expect(await svc.listForCommittee(FACILITY)).toHaveLength(1);
	});

	it('keeps a declined application, with the reason', async () => {
		const choice = await submitted();
		await svc.declineApplication(choice.choiceId, BOOKING, CHAIR, '  Ask again in spring  ');

		expect(await svc.listForCommittee(BOOKING)).toHaveLength(0);
		const [decided] = await svc.listForCommittee(BOOKING, { includeDecided: true });
		expect(decided.status).toBe('declined');
		expect(decided.reviewNotes).toBe('Ask again in spring');
	});

	it('cannot decide the same choice twice', async () => {
		const choice = await submitted();
		await svc.acceptApplication(choice.choiceId, BOOKING, CHAIR);
		await expect(
			svc.declineApplication(choice.choiceId, BOOKING, CHAIR, null)
		).rejects.toBeInstanceOf(svc.ApplicationNotFoundError);
	});

	it('counts what is still open', async () => {
		const choice = await submitted();
		expect(await svc.countOpenForCommittee(BOOKING)).toBe(1);
		await svc.acceptApplication(choice.choiceId, BOOKING, CHAIR);
		expect(await svc.countOpenForCommittee(BOOKING)).toBe(0);
	});
});

describe('withdrawing', () => {
	it('takes the application off every chair’s list at once', async () => {
		const id = await svc.submitApplication(APPLICANT, { groupIds: [BOOKING, FACILITY], answers });
		await svc.withdrawApplication(id, APPLICANT);

		expect(await svc.listForCommittee(BOOKING)).toHaveLength(0);
		expect(await svc.listForCommittee(FACILITY)).toHaveLength(0);
	});

	it('is scoped to the applicant’s own', async () => {
		const id = await svc.submitApplication(APPLICANT, { groupIds: [BOOKING], answers });
		await expect(svc.withdrawApplication(id, CHAIR)).rejects.toBeInstanceOf(
			svc.ApplicationNotFoundError
		);
	});
});
