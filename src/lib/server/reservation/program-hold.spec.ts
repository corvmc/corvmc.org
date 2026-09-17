import { describe, it, expect, beforeEach, vi } from 'vitest';

/** The predicate, against a real SQLite: a mocked `db` would agree either way. */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite();
});

vi.mock('$lib/server/db', () => ({ db: testDb }));

const { notAProgramHold } = await import('./program-hold');
const { reservation } = await import('$lib/server/db/schema/reservation');
const { db } = await import('$lib/server/db');

const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();

beforeEach(() => {
	sqlite.exec('delete from reservation');
	sqlite.exec('delete from "group"');
	sqlite.exec(
		`insert into "group" (id, name, slug, kind) values
			('band-1', 'The Velvets', 'the-velvets', 'band'),
			('facilities', 'Facilities', 'facilities', 'committee'),
			('film-club', 'Film Club', 'film-club', 'club')`
	);
	const row = (id: string, type: string, booker: string) =>
		// A real CHECK enforces ends_at > starts_at, which the replayed schema
		// carries and a hand-built table would not.
		`('${id}', '${type}', '${booker}', 'user-1', 'confirmed', 1000, 2000)`;
	sqlite.exec(
		`insert into reservation (id, booker_type, booker_id, created_by_user_id, status, starts_at, ends_at) values
			${row('own', 'user', 'user-1')},
			${row('band', 'group', 'band-1')},
			${row('committee', 'group', 'facilities')},
			${row('club', 'group', 'film-club')},
			${row('show', 'production', 'prod-1')}`
	);
});

describe('what counts as somebody’s own booking', () => {
	const matching = () =>
		db.select({ id: reservation.id }).from(reservation).where(notAProgramHold());

	it('keeps a member booking and a band rehearsal', async () => {
		expect(ids(await matching())).toEqual(['band', 'own']);
	});

	it('excludes a committee’s hold, which is free room time', async () => {
		// A committee's hold is its own group id since #855, and it is free room
		// time either way — `group.kind` is what says so.
		expect(ids(await matching())).not.toContain('committee');
	});

	it('excludes a club’s hold for the same reason', async () => {
		expect(ids(await matching())).not.toContain('club');
	});

	it("excludes a show's hold, which is the collective's own room time", async () => {
		expect(ids(await matching())).not.toContain('show');
	});

	it('does not exclude a band whose group row is gone', async () => {
		// A booker pointing at nothing is a member's booking as far as this is
		// concerned: the exclusion has to prove the group is a program, not
		// assume it when it cannot find one.
		sqlite.exec(`delete from "group" where id = 'band-1'`);

		expect(ids(await matching())).toContain('band');
	});
});
