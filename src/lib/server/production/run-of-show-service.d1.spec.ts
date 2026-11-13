import { describe, it, expect, vi, beforeEach } from 'vitest';

/** An act booked into two sets, against a real SQLite behind the D1 driver. */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));
vi.mock('./production-scope', () => ({ assertNotTerminal: async () => undefined }));

const { addSlot, SlotExistsError } = await import('./run-of-show-service');

beforeEach(() => {
	sqlite.exec('delete from production_slot');
});

describe('addSlot', () => {
	it('refuses a second set for the same act', async () => {
		await addSlot('prod-1', { eventBandId: 'eb-1', setLengthMinutes: 30 });
		await expect(
			addSlot('prod-1', { eventBandId: 'eb-1', setLengthMinutes: 30 })
		).rejects.toBeInstanceOf(SlotExistsError);
	});
});
