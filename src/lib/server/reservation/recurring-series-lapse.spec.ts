/**
 * What a lapsed subscription cancels, run against **real SQLite** on the real
 * migrated tables.
 *
 * The entire fix here is a `WHERE` clause, and the existing
 * `recurring-series-service.spec.ts` mocks `db.update` wholesale — so it asserts
 * that *something* was cancelled and cannot see *which rows*. A mocked test
 * would pass with the predicate deleted.
 *
 * Its own file rather than merged into that one: the two carry opposite
 * fixtures, and a unioned `vi.mock` would replace this database with that
 * spec's stub, silently turning this back into the test that cannot fail.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

vi.mock('$lib/server/db', async () => {
	const { DatabaseSync } = await import('node:sqlite');
	const { drizzle } = await import('drizzle-orm/node-sqlite');
	const { migrate } = await import('drizzle-orm/node-sqlite/migrator');
	const { join } = await import('node:path');

	const client = new DatabaseSync(':memory:');
	const orm = drizzle({ client });
	migrate(orm, {
		migrationsFolder: join(import.meta.dirname, '..', '..', '..', '..', 'migrations')
	});

	return {
		db: orm,
		client,
		getRowCount: (r: unknown) => {
			const x = r as { meta?: { changes?: number }; changes?: number | bigint };
			return Number(x?.meta?.changes ?? x?.changes ?? 0);
		}
	};
});

const { client } = (await import('$lib/server/db')) as unknown as {
	client: import('node:sqlite').DatabaseSync;
};
const svc = await import('./recurring-series-service');

const USER = 'user-teacher';

function seed() {
	client.exec(
		`INSERT INTO user (id, name, email, email_verified, created_at, updated_at)
		 VALUES ('${USER}', 'Teacher', 't@example.com', 0, unixepoch(), unixepoch())`
	);
	client.exec(
		`INSERT INTO instructor (id, user_id, status, created_at, updated_at)
		 VALUES ('instr-1', '${USER}', 'active', unixepoch(), unixepoch())`
	);

	// Two prototypes by the same person: one rehearsal, one teaching.
	for (const [id, bookerType, bookerId] of [
		['res-rehearsal', 'user', USER],
		['res-teaching', 'instructor', 'instr-1']
	]) {
		client.exec(
			`INSERT INTO reservation (id, booker_type, booker_id, created_by_user_id, status,
			                          starts_at, ends_at, created_at, updated_at)
			 VALUES ('${id}', '${bookerType}', '${bookerId}', '${USER}', 'confirmed',
			         unixepoch() + 86400, unixepoch() + 90000, unixepoch(), unixepoch())`
		);
	}

	for (const [id, proto] of [
		['ser-rehearsal', 'res-rehearsal'],
		['ser-teaching', 'res-teaching']
	]) {
		client.exec(
			`INSERT INTO recurring_series (id, prototype_type, prototype_id, rrule, created_by, created_at)
			 VALUES ('${id}', 'reservation', '${proto}', 'FREQ=WEEKLY', '${USER}', unixepoch())`
		);
	}
}

function cancelledAt(seriesId: string) {
	const row = client
		.prepare(`SELECT cancelled_at FROM recurring_series WHERE id = ?`)
		.get(seriesId);
	return (row as { cancelled_at: number | null } | undefined)?.cancelled_at ?? null;
}

beforeEach(() => {
	client.exec('DELETE FROM recurring_series');
	client.exec('DELETE FROM reservation');
	client.exec('DELETE FROM instructor');
	client.exec('DELETE FROM user');
	seed();
});

afterAll(() => client.close());

describe('a lapsed subscription', () => {
	it('cancels the rehearsal series and leaves the teaching series alone', async () => {
		// The regression this module is most likely to ship by accident. A
		// recurring rehearsal series is a membership benefit, so a lapse ends it.
		// Teaching time is a rental at a rate CMC granted directly — the
		// subscription never bought it, so a lapse must not take it away.
		const count = await svc.cancelAllForUser(USER);

		expect(count).toBe(1);
		expect(cancelledAt('ser-rehearsal')).not.toBeNull();
		expect(cancelledAt('ser-teaching')).toBeNull();
	});

	it('would fail loudly if the teaching series were caught too', async () => {
		// Guards the assertion above against becoming vacuous: if the fixture ever
		// stops containing a teaching series, the test above still passes while
		// testing nothing.
		const teaching = client
			.prepare(`SELECT count(*) n FROM reservation WHERE booker_type = 'instructor'`)
			.get() as { n: number };
		expect(teaching.n).toBe(1);
	});

	it('cancels nothing for a member who only teaches', async () => {
		client.exec(`DELETE FROM recurring_series WHERE id = 'ser-rehearsal'`);
		expect(await svc.cancelAllForUser(USER)).toBe(0);
		expect(cancelledAt('ser-teaching')).toBeNull();
	});
});
