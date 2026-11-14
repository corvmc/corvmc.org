import { describe, it, expect, vi, beforeEach } from 'vitest';
import { venue } from '#lib/server/db/schema/venue.js';

/** Which venues a list returns is a WHERE clause, so it runs against a real SQLite. */

const { testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const { listVenues } = await import('./venue-service');

const at = new Date('2026-01-01T00:00:00Z');

beforeEach(async () => {
	await testDb.delete(venue);
	await testDb.insert(venue).values([
		{ id: 'room', name: 'Practice Room', slug: 'practice-room', isPrimary: true },
		{ id: 'offsite', name: 'Riverfront Stage', slug: 'riverfront-stage' },
		{ id: 'archived', name: 'Closed Hall', slug: 'closed-hall', deletedAt: at }
	]);
});

describe('listVenues', () => {
	// The default is what the event form's venue picker reads.
	it('leaves an archived venue out unless asked for', async () => {
		const ids = (await listVenues()).map((v) => v.id);

		expect(ids).toContain('offsite');
		expect(ids).not.toContain('archived');
	});

	it('returns an archived venue beside the live ones when asked', async () => {
		const ids = (await listVenues({ includeArchived: true })).map((v) => v.id);

		expect(ids).toEqual(expect.arrayContaining(['room', 'offsite', 'archived']));
	});

	it('puts the room first, ahead of names that sort before it', async () => {
		await testDb.insert(venue).values({ id: 'early', name: 'Aardvark Hall', slug: 'aardvark' });

		expect((await listVenues())[0].id).toBe('room');
	});
});
