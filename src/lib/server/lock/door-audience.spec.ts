import { describe, it, expect, beforeEach, vi } from 'vitest';

/** Who a band booking's door code goes to, against a real SQLite: a mocked `db` would agree either way. */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const { bandIdsFor, bandmatesOn } = await import('./door-audience');

beforeEach(() => {
	for (const t of ['reservation', 'group_member', '"group"']) sqlite.exec(`delete from ${t}`);
	sqlite.exec(
		`insert into "group" (id, name, slug, kind) values
			('band-1', 'The Velvets', 'the-velvets', 'band'),
			('band-2', 'The Others', 'the-others', 'band')`
	);
	// A removed member has no row: removal deletes it.
	sqlite.exec(
		`insert into group_member (id, group_id, user_id, role, status) values
			('gm-1', 'band-1', 'booker', 'owner', 'active'),
			('gm-2', 'band-1', 'bandmate', 'member', 'active'),
			('gm-3', 'band-1', 'invitee', 'member', 'pending'),
			('gm-4', 'band-2', 'outsider', 'member', 'active')`
	);
	sqlite.exec(
		`insert into reservation (id, booker_type, booker_id, created_by_user_id, status, starts_at, ends_at) values
			('res-band', 'group', 'band-1', 'booker', 'confirmed', 1000, 2000),
			('res-own', 'user', 'booker', 'booker', 'confirmed', 1000, 2000)`
	);
});

describe('bandmatesOn', () => {
	it('names every active member of the booking band', async () => {
		expect((await bandmatesOn('res-band')).sort()).toEqual(['bandmate', 'booker']);
	});

	it('leaves out a pending invite and members of other bands', async () => {
		const members = await bandmatesOn('res-band');
		expect(members).not.toContain('invitee');
		expect(members).not.toContain('outsider');
	});

	it('names nobody for a member’s own booking', async () => {
		expect(await bandmatesOn('res-own')).toEqual([]);
	});
});

describe('bandIdsFor', () => {
	it('counts an active membership and not a pending one', async () => {
		expect(await bandIdsFor('bandmate')).toEqual(['band-1']);
		expect(await bandIdsFor('invitee')).toEqual([]);
	});
});
