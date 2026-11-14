import { describe, it, expect, beforeEach, vi } from 'vitest';

// Committee positions (#2988) against a real SQLite: the unique name, the
// cascades from a roster row, and holders scoped to the position's committee.

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite({ foreignKeys: true });
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const {
	createPosition,
	deletePosition,
	listPositions,
	listPositionsHeld,
	renamePosition,
	setHolders,
	PositionError
} = await import('./position-service');

const holders = () =>
	sqlite
		.prepare(`select position_id, member_id from group_position_holder order by member_id`)
		.all();

beforeEach(() => {
	for (const t of ['group_position_holder', 'group_position', 'group_member', 'group', 'user']) {
		sqlite.exec(`delete from "${t}"`);
	}
	sqlite.exec(`insert into user (id, name, email) values
		('u-ada', 'Ada', 'ada@example.com'),
		('u-bo', 'Bo', 'bo@example.com'),
		('u-cy', 'Cy', 'cy@example.com')`);
	sqlite.exec(`insert into "group" (id, kind, name, slug) values
		('g-book', 'committee', 'Booking', 'booking'),
		('g-fac', 'committee', 'Facilities', 'facilities'),
		('g-band', 'band', 'Plumfoot', 'plumfoot')`);
	sqlite.exec(`insert into group_member (id, group_id, user_id, role, status) values
		('m-ada', 'g-book', 'u-ada', 'admin', 'active'),
		('m-bo', 'g-book', 'u-bo', 'member', 'active'),
		('m-cy', 'g-book', 'u-cy', 'member', 'pending'),
		('m-cy-fac', 'g-fac', 'u-cy', 'member', 'active')`);
});

describe('createPosition', () => {
	it('refuses a band, whose seat title stays free text', async () => {
		await expect(createPosition('g-band', 'Bass')).rejects.toBeInstanceOf(PositionError);
	});

	it('refuses a second position of the same name in one committee, but not in another', async () => {
		await createPosition('g-book', 'Treasurer');
		await expect(createPosition('g-book', ' Treasurer ')).rejects.toMatchObject({
			httpStatus: 409
		});
		await expect(createPosition('g-fac', 'Treasurer')).resolves.toBeTruthy();
	});
});

describe('setHolders', () => {
	it('replaces the holders, adding and removing', async () => {
		const { id } = await createPosition('g-book', 'Booker');
		await setHolders('g-book', id, ['m-ada'], 'u-ada');
		expect(await setHolders('g-book', id, ['m-bo'], 'u-ada')).toEqual({
			added: ['m-bo'],
			removed: ['m-ada']
		});
		expect(holders()).toEqual([{ position_id: id, member_id: 'm-bo' }]);
	});

	it('refuses a pending row and a member of another committee', async () => {
		const { id } = await createPosition('g-book', 'Booker');
		await expect(setHolders('g-book', id, ['m-cy'], 'u-ada')).rejects.toBeInstanceOf(PositionError);
		await expect(setHolders('g-book', id, ['m-cy-fac'], 'u-ada')).rejects.toBeInstanceOf(
			PositionError
		);
		expect(holders()).toEqual([]);
	});

	it('refuses a position that belongs to another committee', async () => {
		const { id } = await createPosition('g-fac', 'Key holder');
		await expect(setHolders('g-book', id, ['m-ada'], 'u-ada')).rejects.toMatchObject({
			httpStatus: 404
		});
	});
});

describe('cascades', () => {
	it('vacates a position when its holder leaves the committee', async () => {
		const { id } = await createPosition('g-book', 'Booker');
		await setHolders('g-book', id, ['m-ada', 'm-bo'], 'u-ada');
		sqlite.exec(`delete from group_member where id = 'm-bo'`);
		expect(holders()).toEqual([{ position_id: id, member_id: 'm-ada' }]);
	});

	it('takes the holders with a removed position', async () => {
		const { id } = await createPosition('g-book', 'Booker');
		await setHolders('g-book', id, ['m-ada'], 'u-ada');
		await deletePosition('g-book', id);
		expect(holders()).toEqual([]);
	});
});

describe('reads', () => {
	it('lists positions with holders, and what one person holds', async () => {
		const booker = await createPosition('g-book', 'Booker');
		await createPosition('g-book', 'Secretary');
		await renamePosition('g-book', booker.id, 'Show booker');
		await setHolders('g-book', booker.id, ['m-ada'], 'u-ada');

		const listed = await listPositions('g-book');
		expect(listed.map((p) => [p.name, p.holders.map((h) => h.memberId)])).toEqual([
			['Secretary', []],
			['Show booker', ['m-ada']]
		]);
		expect(await listPositionsHeld('u-ada')).toEqual([
			expect.objectContaining({ name: 'Show booker', groupName: 'Booking', groupSlug: 'booking' })
		]);
	});
});
