import { describe, it, expect, vi } from 'vitest';

// `ensureSystemAudiences` runs on staff page loads, so two loads at once both
// see the same built-ins missing (#2681). Real SQLite: the unique
// `system_key` has to make the second insert a no-op rather than an error.

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const { ensureSystemAudiences, SYSTEM_AUDIENCES } = await import('./system-audiences');

describe('ensureSystemAudiences', () => {
	it('provisions each built-in once when two loads overlap', async () => {
		sqlite.exec('delete from audience');

		await Promise.all([ensureSystemAudiences(), ensureSystemAudiences()]);

		const keys = sqlite
			.prepare('select system_key from audience where system_key is not null order by system_key')
			.all()
			.map((r) => (r as { system_key: string }).system_key);
		expect(keys).toEqual(Object.keys(SYSTEM_AUDIENCES).sort());
	});
});
