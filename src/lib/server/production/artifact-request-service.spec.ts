import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Asking, and deriving whether it came. Against a real SQLite because the
 * uniqueness rule — one live ask per artifact per act — is a constraint, and a
 * mocked `db` has none.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	// `await import`, not `require`: the helper is TypeScript, which Node's
	// require cannot load. An async hoisted factory still resolves before the
	// mock below is asked for a database.
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite();
});

vi.mock('$lib/server/db', () => ({ db: testDb }));

const riderSummaries = vi.fn(async () => [] as { name: string; empty: boolean }[]);
vi.mock('$lib/server/band/rider-service', () => ({
	getEventRiderSummaries: () => riderSummaries()
}));

const { cancelArtifactRequest, listRequests, outstandingCount, requestArtifact, requestableActs } =
	await import('./artifact-request-service');

const EVENT = 'evt-1';
const ENTRY = 'entry-1';

beforeEach(() => {
	for (const t of ['artifact_request', 'directory_entry', 'event_band', 'media_attachment']) {
		sqlite.exec(`delete from ${t}`);
	}
	sqlite.exec(
		`insert into directory_entry (id, name, visibility) values ('${ENTRY}', 'The Wrens', 'public')`
	);
	riderSummaries.mockResolvedValue([]);
});

describe('asking', () => {
	it('records the ask and its deadline', async () => {
		const due = new Date('2026-10-01T00:00:00Z');
		await requestArtifact({ eventId: EVENT, entryId: ENTRY, artifact: 'tech_rider', dueAt: due });

		const [req] = await listRequests(EVENT);
		expect(req).toMatchObject({ artifact: 'tech_rider', actName: 'The Wrens', fulfilled: false });
		expect(req.dueAt?.toISOString()).toBe(due.toISOString());
	});

	it('treats asking again as a reminder, not a second request', async () => {
		// Two rows would double what the show appears to be waiting on.
		await requestArtifact({ eventId: EVENT, entryId: ENTRY, artifact: 'tech_rider' });
		await requestArtifact({
			eventId: EVENT,
			entryId: ENTRY,
			artifact: 'tech_rider',
			dueAt: new Date('2026-10-05T00:00:00Z')
		});

		const reqs = await listRequests(EVENT);
		expect(reqs).toHaveLength(1);
		expect(reqs[0].dueAt).not.toBeNull();
	});

	it('drops a withdrawn ask out of what is outstanding', async () => {
		await requestArtifact({ eventId: EVENT, entryId: ENTRY, artifact: 'epk' });
		const [req] = await listRequests(EVENT);
		await cancelArtifactRequest(req.id);
		expect(await listRequests(EVENT)).toHaveLength(0);
	});
});

describe('deriving whether it came', () => {
	it('counts a rider that arrived, asked for or not', async () => {
		riderSummaries.mockResolvedValue([{ name: 'The Wrens', empty: false }]);
		await requestArtifact({ eventId: EVENT, entryId: ENTRY, artifact: 'tech_rider' });

		const [req] = await listRequests(EVENT);
		expect(req.fulfilled).toBe(true);
		expect(await outstandingCount(EVENT)).toBe(0);
	});

	it('leaves an empty rider outstanding', async () => {
		riderSummaries.mockResolvedValue([{ name: 'The Wrens', empty: true }]);
		await requestArtifact({ eventId: EVENT, entryId: ENTRY, artifact: 'tech_rider' });
		expect(await outstandingCount(EVENT)).toBe(1);
	});

	it('counts a rider file, which is the only kind an act with no account can send', async () => {
		// `rider` is keyed on `group_id` and an external act has no group, so the
		// structured summary is empty however much they sent. Before #863 that
		// made the ask permanently outstanding.
		riderSummaries.mockResolvedValue([{ name: 'The Wrens', empty: true }]);
		sqlite.exec(
			`insert into media_attachment (id, media_id, attachable_type, attachable_id, slot)
			 values ('att-1', 'med-1', 'directory_entry', '${ENTRY}', 'rider')`
		);
		await requestArtifact({ eventId: EVENT, entryId: ENTRY, artifact: 'tech_rider' });

		expect((await listRequests(EVENT))[0].fulfilled).toBe(true);
		expect(await outstandingCount(EVENT)).toBe(0);
	});

	it('does not read a file in another slot as a rider', async () => {
		riderSummaries.mockResolvedValue([{ name: 'The Wrens', empty: true }]);
		sqlite.exec(
			`insert into media_attachment (id, media_id, attachable_type, attachable_id, slot)
			 values ('att-2', 'med-2', 'directory_entry', '${ENTRY}', 'stage_plot')`
		);
		await requestArtifact({ eventId: EVENT, entryId: ENTRY, artifact: 'tech_rider' });

		expect(await outstandingCount(EVENT)).toBe(1);
	});

	it('reads a press kit off the listing having a bio', async () => {
		sqlite.exec(`update directory_entry set bio = 'Four of them, from Corvallis.'`);
		await requestArtifact({ eventId: EVENT, entryId: ENTRY, artifact: 'epk' });
		expect((await listRequests(EVENT))[0].fulfilled).toBe(true);
	});

	it('treats whitespace as no bio at all', async () => {
		sqlite.exec(`update directory_entry set bio = '   '`);
		await requestArtifact({ eventId: EVENT, entryId: ENTRY, artifact: 'epk' });
		expect((await listRequests(EVENT))[0].fulfilled).toBe(false);
	});
});

describe('overdue', () => {
	const past = new Date('2026-01-01T00:00:00Z');
	const now = new Date('2026-02-01T00:00:00Z');

	it('flags an unfulfilled ask past its date', async () => {
		await requestArtifact({ eventId: EVENT, entryId: ENTRY, artifact: 'epk', dueAt: past });
		expect((await listRequests(EVENT, now))[0].overdue).toBe(true);
	});

	it('does not flag one that arrived late', async () => {
		// The deadline mattered before it came; afterwards it is just done.
		sqlite.exec(`update directory_entry set bio = 'Here at last.'`);
		await requestArtifact({ eventId: EVENT, entryId: ENTRY, artifact: 'epk', dueAt: past });
		expect((await listRequests(EVENT, now))[0].overdue).toBe(false);
	});

	it('does not flag an ask with no deadline', async () => {
		await requestArtifact({ eventId: EVENT, entryId: ENTRY, artifact: 'epk' });
		expect((await listRequests(EVENT, now))[0].overdue).toBe(false);
	});
});

describe('who can be asked', () => {
	const credit = (id: string, name: string, order: number, entry: string | null) =>
		sqlite.exec(
			`insert into event_band (id, event_id, name, billing_order, directory_entry_id) values ('${id}', '${EVENT}', '${name}', ${order}, ${entry ? `'${entry}'` : 'null'})`
		);

	it('offers the bill in billing order', async () => {
		credit('eb-2', 'Second', 2, ENTRY);
		sqlite.exec(
			`insert into directory_entry (id, name, visibility) values ('entry-2', 'Openers', 'public')`
		);
		credit('eb-1', 'First', 1, 'entry-2');

		expect(await requestableActs(EVENT)).toEqual([
			{ entryId: 'entry-2', name: 'First' },
			{ entryId: ENTRY, name: 'Second' }
		]);
	});

	it('leaves out a credit with no listing, which has nowhere to receive an ask', async () => {
		credit('eb-1', 'Bare name', 1, null);
		expect(await requestableActs(EVENT)).toEqual([]);
	});
});
