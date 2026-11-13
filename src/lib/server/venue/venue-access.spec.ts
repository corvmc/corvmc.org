import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Access answers against a real SQLite: the column default is what makes an
 * unchecked room `unknown` rather than `no`, and a mocked `db` would not know it.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const svc = await import('./venue-service');

beforeEach(() => {
	sqlite.exec('delete from venue');
});

describe('venue access', () => {
	it('starts unknown, and a listing there shows nothing', async () => {
		const row = await svc.createVenue({ name: 'Unchecked Hall' });

		expect([row.stepFreeEntry, row.accessibleRestroom, row.seating]).toEqual([
			'unknown',
			'unknown',
			'unknown'
		]);
		expect(await svc.getVenueAccess(row.id)).toEqual([]);
	});

	it('saves yes and no, and reads them back in display order without unknowns', async () => {
		const row = await svc.createVenue({ name: 'Checked Hall' });
		await svc.updateVenue(row.id, { seating: 'no', stepFreeEntry: 'yes' });

		expect(await svc.getVenueAccess(row.id)).toEqual([
			{ field: 'stepFreeEntry', answer: 'yes' },
			{ field: 'seating', answer: 'no' }
		]);
	});

	it('leaves answers alone when an update does not name them', async () => {
		const row = await svc.createVenue({ name: 'Hall' });
		await svc.updateVenue(row.id, { accessibleRestroom: 'yes' });
		await svc.updateVenue(row.id, { name: 'Hall', capacity: 80 });

		expect((await svc.getVenue(row.id)).accessibleRestroom).toBe('yes');
	});

	it('can move an answer back to unknown', async () => {
		const row = await svc.createVenue({ name: 'Hall' });
		await svc.updateVenue(row.id, { seating: 'no' });
		await svc.updateVenue(row.id, { seating: 'unknown' });

		expect(await svc.getVenueAccess(row.id)).toEqual([]);
	});

	it('is empty for an event with no venue or a missing one', async () => {
		expect(await svc.getVenueAccess(null)).toEqual([]);
		expect(await svc.getVenueAccess('no-such-venue')).toEqual([]);
	});
});
