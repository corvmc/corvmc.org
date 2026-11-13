import { describe, it, expect, vi, beforeEach } from 'vitest';

// Get-or-create against a real SQLite (#2681). Two calls that overlap both
// read nothing before either inserts; the unique index on the key has to turn
// the second insert into a no-op, not a second row or a UNIQUE error.

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const { getOrCreateGroupEntryId, ensureUserEntry, getOrCreateUserEntryId } =
	await import('./entry-service');
const { writeActContactUnguarded } = await import('./contact-service');

const rows = <T>(sql: string, ...params: unknown[]) => sqlite.prepare(sql).all(...params) as T[];

beforeEach(() => {
	for (const t of [
		'contact',
		'organization',
		'audience_member',
		'subscriber',
		'directory_entry',
		'"group"',
		'user'
	]) {
		sqlite.exec(`delete from ${t}`);
	}
	sqlite.exec(`insert into user (id, name, email) values ('u1', 'Ada', 'ada@example.com')`);
	sqlite.exec(
		`insert into "group" (id, kind, name, slug) values ('g1', 'band', 'The Band', 'the-band')`
	);
});

describe('directory entries', () => {
	it('creates one group entry when two first reads overlap', async () => {
		const ids = await Promise.all([getOrCreateGroupEntryId('g1'), getOrCreateGroupEntryId('g1')]);

		const entries = rows<{ id: string }>(`select id from directory_entry where group_id = 'g1'`);
		expect(entries).toHaveLength(1);
		expect(ids).toEqual([entries[0].id, entries[0].id]);
	});

	it('creates one user entry when the hook and a profile save overlap', async () => {
		const ids = await Promise.all([ensureUserEntry('u1', 'Ada'), ensureUserEntry('u1', 'Ada')]);

		const entries = rows<{ id: string; visibility: string }>(
			`select id, visibility from directory_entry where user_id = 'u1'`
		);
		expect(entries).toEqual([{ id: ids[0], visibility: 'members' }]);
		expect(ids[1]).toBe(ids[0]);
		await expect(getOrCreateUserEntryId('u1')).resolves.toBe(ids[0]);
	});
});

describe('the consent ledger', () => {
	beforeEach(() => {
		sqlite.exec(
			`insert into organization (id, name) values ('org-1', 'Act One'), ('org-2', 'Act Two')`
		);
	});

	it('registers the address once when two writes share it at the same moment', async () => {
		await Promise.all([
			writeActContactUnguarded('org-1', { email: 'Manager@Example.COM' }),
			writeActContactUnguarded('org-2', { name: 'Booker', email: 'manager@example.com' })
		]);

		const [ledger] = rows<{ id: string }>(`select id from subscriber`);
		expect(rows(`select email from subscriber`)).toEqual([{ email: 'manager@example.com' }]);
		expect(rows(`select distinct subscriber_id from contact`)).toEqual([
			{ subscriber_id: ledger.id }
		]);
	});

	it('reuses an address already in the ledger, suppression and all', async () => {
		sqlite.exec(
			`insert into subscriber (id, email, suppressed_at) values ('sub-old', 'manager@example.com', 1750000000)`
		);

		await writeActContactUnguarded('org-1', { email: 'manager@example.com' });

		expect(rows(`select id, suppressed_at from subscriber`)).toEqual([
			{ id: 'sub-old', suppressed_at: 1750000000 }
		]);
		expect(rows(`select subscriber_id from contact`)).toEqual([{ subscriber_id: 'sub-old' }]);
	});

	it('never enrols that address in an audience', async () => {
		await writeActContactUnguarded('org-1', { email: 'manager@example.com' });

		expect(rows(`select id from audience_member`)).toEqual([]);
	});
});
