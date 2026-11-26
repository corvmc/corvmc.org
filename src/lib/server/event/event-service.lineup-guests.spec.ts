import { describe, it, expect, beforeEach, vi } from 'vitest';

// The class guard for #3274: a guest ticket is cancelled when its act leaves the
// bill, by any rewrite of the lineup. Against a real SQLite, because the answer
// is a `WHERE` and a `db.batch` ordering a mocked `db` would agree with either way.

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb, getRowCount: () => 0 }));
vi.mock('#lib/server/reservation/reservation-service.js', () => ({
	staffCreate: vi.fn(),
	cancel: vi.fn(),
	ReservationConflictError: class extends Error {}
}));
vi.mock('#lib/server/reservation/conflict-service.js', () => ({ hasConflict: vi.fn() }));
vi.mock('#lib/server/event-bus/event-bus.js', () => ({ domainEvents: { emit: vi.fn() } }));
vi.mock('#lib/server/storage.js', () => ({ uploadFile: vi.fn(), deleteObject: vi.fn() }));
vi.mock('#lib/server/sentry.js', () => ({ captureException: vi.fn() }));

const { setEventLineup } = await import('./event-service');

const statuses = () =>
	Object.fromEntries(
		(
			sqlite.prepare('select id, status, event_band_id as band from ticket order by id').all() as {
				id: string;
				status: string;
				band: string | null;
			}[]
		).map((r) => [r.id, `${r.status}:${r.band}`])
	);

beforeEach(() => {
	for (const t of ['ticket', 'event_band', 'event_listing', '"user"'])
		sqlite.exec(`delete from ${t}`);
	sqlite.exec(
		`insert into "user" (id, name, email, email_verified) values ('u1', 'U', 'u@x.org', 1)`
	);
	sqlite.exec(
		`insert into event_listing (id, title, starts_at, ends_at, status, source, created_by_user_id)
		 values ('evt-1', 'Show', 1000000, 2000000, 'published', 'cmc', 'u1'),
		        ('evt-2', 'Other', 1000000, 2000000, 'published', 'cmc', 'u1')`
	);
	sqlite.exec(
		`insert into event_band (id, event_id, name, billing_order, status) values
		 ('act-a', 'evt-1', 'Alpha', 0, 'unlinked'),
		 ('act-b', 'evt-1', 'Bravo', 1, 'unlinked'),
		 ('act-c', 'evt-2', 'Charlie', 0, 'unlinked')`
	);
	const t = (id: string, event: string, band: string | null, status: string) =>
		`('${id}', '${event}', ${band ? `'${band}'` : 'null'}, 'p-${id}', 'G ${id}', 'g@x.org', 'CODE${id}', '${status}')`;
	sqlite.exec(
		`insert into ticket (id, event_id, event_band_id, purchase_id, attendee_name, attendee_email, code, status) values
		 ${t('a-valid', 'evt-1', 'act-a', 'valid')},
		 ${t('a-pending', 'evt-1', 'act-a', 'pending')},
		 ${t('a-in', 'evt-1', 'act-a', 'checked_in')},
		 ${t('b-valid', 'evt-1', 'act-b', 'valid')},
		 ${t('c-valid', 'evt-2', 'act-c', 'valid')},
		 ${t('plain', 'evt-1', null, 'valid')}`
	);
});

describe('dropping an act from the bill', () => {
	it('cancels its unused guests and leaves every other ticket alone', async () => {
		await setEventLineup('evt-1', [{ name: 'Bravo' }]);

		const rows = statuses();
		expect(rows['a-valid']).toMatch(/^cancelled:/);
		expect(rows['a-pending']).toMatch(/^cancelled:/);
		// Came to the show; stays as the record of it.
		expect(rows['a-in']).toMatch(/^checked_in:/);
		expect(rows['b-valid']).toBe('valid:act-b');
		expect(rows['c-valid']).toBe('valid:act-c');
		expect(rows['plain']).toBe('valid:null');
	});

	it('cancels the guests of every dropped act, including an emptied bill', async () => {
		await setEventLineup('evt-1', []);

		const rows = statuses();
		expect(rows['a-valid']).toMatch(/^cancelled:/);
		expect(rows['b-valid']).toMatch(/^cancelled:/);
		expect(rows['c-valid']).toBe('valid:act-c');
	});

	it('keeps the guests of an act that stays, whatever else is rewritten', async () => {
		await setEventLineup('evt-1', [{ name: 'Alpha' }, { name: 'Bravo' }, { name: 'Delta' }]);

		const rows = statuses();
		expect(rows['a-valid']).toBe('valid:act-a');
		expect(rows['b-valid']).toBe('valid:act-b');
	});
});
