import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Group applications, against a real SQLite.
 *
 * The rules worth pinning are all `WHERE` clauses a mocked `db` would agree
 * with either way: which groups a submission drops, which choices a reviewer
 * may act on, and that a decline keeps the row so the applicant can come back.
 */

/** The whole schema, replayed from the committed migrations. Why: #847. */
const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite();
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

const emit = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock('$lib/server/event-bus/event-bus', () => ({
	domainEvents: { emit: (...a: unknown[]) => emit(...a) }
}));

const svc = await import('./application-service');

const BOOKING = 'grp-booking';
const FACILITY = 'grp-facility';
const CLOSED_COMMITTEE = 'grp-closed';
const JAZZ = 'grp-jazz';
const CHOIR = 'grp-choir';
const DROP_IN = 'grp-drop-in';
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
	const g = (id: string, kind: string, name: string, joinPolicy: string) => ({
		id,
		kind,
		name,
		slug: name.toLowerCase().replaceAll(' ', '-'),
		joinPolicy
	});
	await testDb
		.insert(group)
		.values([
			g(BOOKING, 'committee', 'Booking Committee', 'by_application'),
			g(FACILITY, 'committee', 'Facility Committee', 'by_application'),
			g(CLOSED_COMMITTEE, 'committee', 'Closed Committee', 'invite_only'),
			g(JAZZ, 'club', 'Jazz Club', 'by_application'),
			g(CHOIR, 'club', 'Choir Club', 'by_application'),
			g(DROP_IN, 'club', 'Drop In Club', 'open'),
			g(A_BAND, 'band', 'A Band', 'invite_only')
		] as never);
}

beforeEach(async () => {
	invite.mockClear();
	emit.mockClear();
	for (const t of [
		'group_application_choice',
		'group_application',
		'group_member',
		'"group"',
		'user'
	]) {
		sqlite.exec(`delete from ${t}`);
	}
	await seed();
});

const answers = { experience: 'Booked a basement series', vision: 'Somewhere to play at 17' };

async function onRoster(groupId: string, status: 'active' | 'pending') {
	const { groupMember } = await import('$lib/server/db/schema/group');
	await testDb.insert(groupMember).values({
		id: `gm-${groupId}`,
		groupId,
		userId: APPLICANT,
		role: 'member',
		status
	} as never);
}

describe('submitting', () => {
	it('writes one application and a choice per committee', async () => {
		const id = await svc.submitApplication(APPLICANT, { groupIds: [BOOKING, FACILITY], answers });

		const mine = await svc.listForApplicant(APPLICANT);
		expect(mine).toHaveLength(1);
		expect(mine[0].id).toBe(id);
		expect(mine[0].answers).toEqual(answers);
		expect(mine[0].groups.map((c) => c.name).sort()).toEqual([
			'Booking Committee',
			'Facility Committee'
		]);
	});

	it('takes a club application with its own question, dropping answers the kind does not ask', async () => {
		await svc.submitApplication(APPLICANT, {
			groupIds: [JAZZ],
			answers: { note: '  I play upright bass  ', experience: 'not asked of a club' }
		});

		const [app] = await svc.listForGroup(JAZZ);
		expect(app.answers).toEqual({ note: 'I play upright bass' });
	});

	// #1726: an application nobody hears about waits on a chair opening the page.
	it('announces each group it actually lands on, not the ones it dropped', async () => {
		await svc.submitApplication(APPLICANT, { groupIds: [BOOKING], answers });
		emit.mockClear();

		await svc.submitApplication(APPLICANT, { groupIds: [BOOKING, FACILITY], answers });

		expect(emit.mock.calls).toEqual([
			['group.application_submitted', { groupId: FACILITY, applicantUserId: APPLICANT }]
		]);
	});

	it.each([
		['an invite-only committee', CLOSED_COMMITTEE],
		['an open club', DROP_IN],
		['a band', A_BAND],
		['a group that does not exist', 'grp-missing']
	])('refuses %s', async (_label, groupId) => {
		await expect(
			svc.submitApplication(APPLICANT, { groupIds: [groupId], answers })
		).rejects.toBeInstanceOf(svc.NotAcceptingApplicationsError);
	});

	it('refuses a club alongside another group — only committees share one application', async () => {
		await expect(
			svc.submitApplication(APPLICANT, { groupIds: [JAZZ, CHOIR], answers: {} })
		).rejects.toBeInstanceOf(svc.OneGroupPerApplicationError);
		await expect(
			svc.submitApplication(APPLICANT, { groupIds: [JAZZ, BOOKING], answers: {} })
		).rejects.toBeInstanceOf(svc.OneGroupPerApplicationError);
	});

	it('refuses an empty tick list rather than writing an empty application', async () => {
		await expect(
			svc.submitApplication(APPLICANT, { groupIds: [], answers })
		).rejects.toBeInstanceOf(svc.NothingToApplyForError);
	});

	it('drops a committee you are already applying to, and keeps the rest', async () => {
		await svc.submitApplication(APPLICANT, { groupIds: [BOOKING], answers });
		await svc.submitApplication(APPLICANT, { groupIds: [BOOKING, FACILITY], answers });

		expect(await svc.listForGroup(BOOKING)).toHaveLength(1);
		expect(await svc.listForGroup(FACILITY)).toHaveLength(1);
	});

	it('drops a group you are already on', async () => {
		await onRoster(BOOKING, 'active');
		await expect(
			svc.submitApplication(APPLICANT, { groupIds: [BOOKING], answers })
		).rejects.toBeInstanceOf(svc.NothingToApplyForError);
	});

	it('counts a pending invitation as already on', async () => {
		await onRoster(JAZZ, 'pending');
		await expect(
			svc.submitApplication(APPLICANT, { groupIds: [JAZZ], answers: {} })
		).rejects.toBeInstanceOf(svc.NothingToApplyForError);
	});

	it('lets a declined applicant apply again, keeping the old decision as a record', async () => {
		await svc.submitApplication(APPLICANT, { groupIds: [JAZZ], answers: {} });
		const [first] = await svc.listForGroup(JAZZ);
		await svc.declineApplication(first.choiceId, JAZZ, CHAIR, 'Not this round');

		await expect(
			svc.submitApplication(APPLICANT, { groupIds: [JAZZ], answers: {} })
		).resolves.toBeTruthy();

		const all = await svc.listForGroup(JAZZ, { includeDecided: true });
		expect(all.map((c) => c.status).sort()).toEqual(['declined', 'submitted']);
		expect(all.find((c) => c.status === 'declined')?.choiceId).toBe(first.choiceId);
	});

	it('reports whether an open application exists, for the public page', async () => {
		const id = await svc.submitApplication(APPLICANT, { groupIds: [JAZZ], answers: {} });
		expect(await svc.hasOpenApplication(JAZZ, APPLICANT)).toBe(true);
		await svc.withdrawApplication(id, APPLICANT);
		expect(await svc.hasOpenApplication(JAZZ, APPLICANT)).toBe(false);
	});
});

describe('the reviewer', () => {
	async function submitted() {
		await svc.submitApplication(APPLICANT, { groupIds: [BOOKING, FACILITY], answers });
		const [choice] = await svc.listForGroup(BOOKING);
		return choice;
	}

	it('sees the answers beside the applicant', async () => {
		const choice = await submitted();
		expect(choice.answers).toEqual(answers);
		expect(choice.applicant.title).toBe('Ada');
	});

	it('sees only their own group’s half', async () => {
		await submitted();
		expect(await svc.listForGroup(BOOKING)).toHaveLength(1);
		expect(await svc.listForGroup(FACILITY)).toHaveLength(1);
		expect(await svc.listForGroup(A_BAND)).toHaveLength(0);
	});

	it('cannot act on another group’s choice', async () => {
		const choice = await submitted();
		await expect(svc.acceptApplication(choice.choiceId, FACILITY, CHAIR)).rejects.toBeInstanceOf(
			svc.ApplicationNotFoundError
		);
	});

	it('records contact without deciding', async () => {
		const choice = await submitted();
		await svc.markContacted(choice.choiceId, BOOKING, CHAIR);
		const [after] = await svc.listForGroup(BOOKING);
		expect(after.status).toBe('contacted');
	});

	it('accepts by inviting rather than seating, for a club as for a committee', async () => {
		const choice = await submitted();
		await svc.acceptApplication(choice.choiceId, BOOKING, CHAIR);
		expect(invite).toHaveBeenCalledWith(BOOKING, APPLICANT, 'member', null, CHAIR);
		expect(await svc.listForGroup(BOOKING)).toHaveLength(0);
		expect(await svc.listForGroup(FACILITY)).toHaveLength(1);

		await svc.submitApplication(APPLICANT, { groupIds: [JAZZ], answers: {} });
		const [club] = await svc.listForGroup(JAZZ);
		await svc.acceptApplication(club.choiceId, JAZZ, CHAIR);
		expect(invite).toHaveBeenLastCalledWith(JAZZ, APPLICANT, 'member', null, CHAIR);
	});

	it('keeps a declined application, with the reason', async () => {
		const choice = await submitted();
		await svc.declineApplication(choice.choiceId, BOOKING, CHAIR, '  Ask again in spring  ');

		expect(await svc.listForGroup(BOOKING)).toHaveLength(0);
		const [decided] = await svc.listForGroup(BOOKING, { includeDecided: true });
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
		expect(await svc.countOpenForGroup(BOOKING)).toBe(1);
		await svc.acceptApplication(choice.choiceId, BOOKING, CHAIR);
		expect(await svc.countOpenForGroup(BOOKING)).toBe(0);
	});
});

describe('withdrawing', () => {
	it('takes the application off every reviewer’s list at once', async () => {
		const id = await svc.submitApplication(APPLICANT, { groupIds: [BOOKING, FACILITY], answers });
		await svc.withdrawApplication(id, APPLICANT);

		expect(await svc.listForGroup(BOOKING)).toHaveLength(0);
		expect(await svc.listForGroup(FACILITY)).toHaveLength(0);
	});

	it('is scoped to the applicant’s own', async () => {
		const id = await svc.submitApplication(APPLICANT, { groupIds: [BOOKING], answers });
		await expect(svc.withdrawApplication(id, CHAIR)).rejects.toBeInstanceOf(
			svc.ApplicationNotFoundError
		);
	});
});

describe('the applicant’s list', () => {
	it('can be narrowed to one kind', async () => {
		await svc.submitApplication(APPLICANT, { groupIds: [BOOKING], answers });
		await svc.submitApplication(APPLICANT, { groupIds: [JAZZ], answers: {} });

		const committees = await svc.listForApplicant(APPLICANT, { kind: 'committee' });
		expect(committees.flatMap((a) => a.groups.map((g) => g.id))).toEqual([BOOKING]);
		expect(await svc.listForApplicant(APPLICANT)).toHaveLength(2);
	});
});

describe('the committee apply page', () => {
	it('offers only committees that take applications', async () => {
		const accepting = await svc.listCommittees({ acceptingOnly: true });
		expect(accepting.map((c) => c.id)).toEqual([BOOKING, FACILITY]);
		expect((await svc.listCommittees()).map((c) => c.id)).toContain(CLOSED_COMMITTEE);
	});
});

describe('the staff list badge', () => {
	async function counts() {
		const { group } = await import('$lib/server/db/schema/group');
		const rows = await testDb
			.select({ id: group.id, open: svc.openApplicationCount(group.id) })
			.from(group);
		return Object.fromEntries(rows.map((r) => [r.id, Number(r.open)]));
	}

	it('counts each group’s open choices, whatever its kind', async () => {
		await svc.submitApplication(APPLICANT, { groupIds: [BOOKING, FACILITY], answers });
		await svc.submitApplication(APPLICANT, { groupIds: [JAZZ], answers: {} });
		const [choice] = await svc.listForGroup(FACILITY);
		await svc.acceptApplication(choice.choiceId, FACILITY, CHAIR);

		const c = await counts();
		expect([c[BOOKING], c[FACILITY], c[JAZZ], c[A_BAND]]).toEqual([1, 0, 1, 0]);
	});

	it('leaves out a withdrawn application', async () => {
		const id = await svc.submitApplication(APPLICANT, { groupIds: [BOOKING], answers });
		await svc.withdrawApplication(id, APPLICANT);

		expect((await counts())[BOOKING]).toBe(0);
	});
});
