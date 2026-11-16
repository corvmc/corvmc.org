import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * An outside act on a bill (#2782), against a real SQLite: a bill names an act
 * by its `directory_entry`, and every path that writes a credit must keep that
 * link rather than fall back to a second act with the same name.
 */
const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', async () => ({
	db: testDb,
	getRowCount: (await import('#lib/server/db/row-count.js')).getRowCount
}));
vi.mock('#lib/server/event-bus/event-bus.js', () => ({
	domainEvents: { emit: vi.fn(), on: vi.fn() }
}));
vi.mock('#lib/server/kv.js', () => ({
	getJson: async () => null,
	putJson: async () => undefined,
	listKeys: async () => [],
	deleteKey: async () => undefined
}));

const events = await import('./event-service');
const { createExternalAct, searchOutsideActs } =
	await import('#lib/server/directory/entry-service.js');

const EVENT = 'evt-recital';

function credits() {
	return sqlite
		.prepare(`select id, name, directory_entry_id as entryId from event_band where event_id = ?`)
		.all(EVENT) as { id: string; name: string; entryId: string | null }[];
}

const actCount = () =>
	(
		sqlite
			.prepare(
				`select count(*) as n from directory_entry where user_id is null and group_id is null`
			)
			.get() as { n: number }
	).n;

beforeEach(() => {
	sqlite.exec(`delete from event_band; delete from event_listing;`);
	const s = Math.floor(Date.UTC(2030, 5, 7, 2) / 1000);
	sqlite
		.prepare(
			`insert into event_listing (id, title, starts_at, ends_at, kind, source, status, created_by_user_id)
			 values (?, 'Classical Recital', ?, ?, 'show', 'cmc', 'draft', 'u-staff')`
		)
		.run(EVENT, s, s + 7200);
});

describe('an outside act on a bill', () => {
	it('is found by the bill search', async () => {
		const harbor = await createExternalAct({ name: 'Harbor Lights', hometown: 'Newport' });
		expect(await searchOutsideActs('harbor')).toEqual([
			expect.objectContaining({ id: harbor, name: 'Harbor Lights' })
		]);
	});

	it('is credited by its entry when picked', async () => {
		const harbor = await createExternalAct({ name: 'Harbor Lights' });
		await events.setEventLineup(
			EVENT,
			[{ name: 'Harbor Lights', actId: harbor, billingOrder: 0 }],
			{ asStaff: true }
		);
		expect(credits()).toEqual([expect.objectContaining({ entryId: harbor })]);
	});

	it('keeps its credit row and link when the bill is saved again', async () => {
		const harbor = await createExternalAct({ name: 'Harbor Lights' });
		await events.setEventLineup(
			EVENT,
			[{ name: 'Harbor Lights', actId: harbor, billingOrder: 0 }],
			{ asStaff: true }
		);
		const [before] = credits();

		const [row] = await events.getEventLineup(EVENT);
		await events.setEventLineup(
			EVENT,
			[{ name: row.name, actId: row.actId ?? undefined, billingOrder: 0 }],
			{ asStaff: true }
		);
		expect(credits()).toEqual([before]);
	});

	// The band panel and community editors cannot search acts, so their chips
	// name an act by its name alone; a save from them must not drop the link.
	it('keeps its link when an editor saves it by name alone', async () => {
		const tide = await createExternalAct({ name: 'Low Tide' });
		await events.setEventLineup(EVENT, [{ name: 'Low Tide', actId: tide, billingOrder: 0 }], {
			asStaff: true
		});
		const [before] = credits();

		await events.setEventLineup(EVENT, [{ name: 'Low Tide', billingOrder: 0 }]);
		expect(credits()).toEqual([before]);
	});

	it('is matched by name when a typed credit is recorded as an act', async () => {
		const before = actCount() + 1;
		const fenwick = await createExternalAct({ name: 'Fenwick' });
		await events.setEventLineup(EVENT, [{ name: ' fenwick ', billingOrder: 0 }], {
			asStaff: true
		});
		const [credit] = credits();

		expect(await events.listCreditInDirectory(credit.id)).toBe(fenwick);
		expect(actCount()).toBe(before);
	});
});
