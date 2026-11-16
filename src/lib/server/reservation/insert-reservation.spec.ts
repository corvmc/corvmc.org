import { describe, it, expect, beforeEach, vi } from 'vitest';

/** The price a new booking is written with, against a real SQLite. */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const { insertReservation } = await import('./insert-reservation');

beforeEach(() => {
	sqlite.exec('delete from reservation');
	sqlite.exec('delete from "group"');
	sqlite.exec(
		`insert into "group" (id, name, slug, kind) values
			('band-1', 'The Velvets', 'the-velvets', 'band'),
			('facilities', 'Facilities', 'facilities', 'committee'),
			('real-book', 'Real Book Club', 'real-book', 'club')`
	);
});

const book = (bookerType: 'user' | 'group', bookerId: string) =>
	insertReservation({
		bookerType,
		bookerId,
		createdByUserId: 'user-1',
		status: 'confirmed',
		startsAt: new Date(1_800_000_000_000),
		endsAt: new Date(1_800_003_600_000)
	});

describe('the price a new booking is written with', () => {
	it('settles a club’s booking at nothing', async () => {
		expect((await book('group', 'real-book')).cashDueCents).toBe(0);
	});

	it('settles a committee’s booking at nothing', async () => {
		expect((await book('group', 'facilities')).cashDueCents).toBe(0);
	});

	it('leaves a band’s booking to be priced', async () => {
		expect((await book('group', 'band-1')).cashDueCents).toBeNull();
	});

	it('leaves a member’s booking to be priced', async () => {
		expect((await book('user', 'user-1')).cashDueCents).toBeNull();
	});
});
