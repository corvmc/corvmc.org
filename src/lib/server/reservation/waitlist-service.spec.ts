/**
 * What `expireWaitlisted()` tells the rest of the system when a waitlist entry
 * runs out of time.
 *
 * The expiry path cancels the reservation with its own `db.update` rather than
 * going through `cancel()`, so for a long time it emitted only
 * `reservation.waitlist_expired` — and every listener keyed on
 * `reservation.cancelled` (waitlist promotion, the member cancellation email,
 * the rehearsal-orientation cascade) was skipped for a row that had, in fact,
 * been cancelled.
 *
 * Run against **real SQLite** on the real migrated tables: the assertions here
 * are about which rows the conditional update actually touches, which a mocked
 * `db.update` cannot see.
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

const emit = vi.fn();
vi.mock('$lib/server/event-bus/event-bus', () => ({ domainEvents: { emit } }));

const { client } = (await import('$lib/server/db')) as unknown as {
	client: import('node:sqlite').DatabaseSync;
};
const { expireWaitlisted } = await import('./waitlist-service');

const USER = 'user-member';

/** One waitlisted reservation whose 24h confirmation window closed an hour ago. */
function seed() {
	client.exec(
		`INSERT INTO user (id, name, email, email_verified, created_at, updated_at)
		 VALUES ('${USER}', 'Wanda Waitlist', 'wanda@example.com', 0, unixepoch(), unixepoch())`
	);
	client.exec(
		`INSERT INTO reservation (id, booker_type, booker_id, created_by_user_id, status,
		                          starts_at, ends_at, waitlist_notified_at, waitlist_expires_at,
		                          created_at, updated_at)
		 VALUES ('res-expired', 'user', '${USER}', '${USER}', 'waitlisted',
		         unixepoch() + 86400, unixepoch() + 90000,
		         unixepoch() - 90000, unixepoch() - 3600,
		         unixepoch(), unixepoch())`
	);
}

function emitted(name: string) {
	return emit.mock.calls.filter(([event]) => event === name);
}

beforeEach(() => {
	emit.mockClear();
	client.exec('DELETE FROM reservation');
	client.exec('DELETE FROM user');
	seed();
});

afterAll(() => client.close());

describe('expireWaitlisted', () => {
	it('cancels the row and says so on the bus', async () => {
		// The regression. Cancelling in silence leaves every `reservation.cancelled`
		// listener — waitlist promotion, the cancellation email, the orientation
		// cascade — with no idea the slot was released.
		const result = await expireWaitlisted();

		expect(result.expired).toBe(1);

		const row = client.prepare(`SELECT status FROM reservation WHERE id = 'res-expired'`).get() as {
			status: string;
		};
		expect(row.status).toBe('cancelled');

		expect(emitted('reservation.cancelled')).toHaveLength(1);
	});

	it('attributes the cancellation to the system and names the cause', async () => {
		// `cause` is what stops the member being told twice: the listeners that
		// already handle this path — the cancellation email and the promotion
		// cascade — key on it to stand down. A cancellation that arrived without
		// it would send a second email on top of `waitlist_expired`.
		await expireWaitlisted();

		const [[, payload]] = emitted('reservation.cancelled') as [[string, Record<string, unknown>]];
		expect(payload).toMatchObject({
			reservationId: 'res-expired',
			userId: USER,
			userEmail: 'wanda@example.com',
			cancelledBy: 'system',
			cause: 'waitlist_expired'
		});
	});

	it('still emits the expiry event the member hears about', async () => {
		// Guards the change above from being made by swapping one event for the
		// other: `waitlist_expired` carries the wording that fits this path.
		await expireWaitlisted();

		expect(emitted('reservation.waitlist_expired')).toHaveLength(1);
	});

	it('leaves a waitlist entry still inside its window alone', async () => {
		// Keeps the assertions above from passing on a query that cancels
		// everything waitlisted.
		client.exec(
			`UPDATE reservation SET waitlist_expires_at = unixepoch() + 3600 WHERE id = 'res-expired'`
		);

		const result = await expireWaitlisted();

		expect(result.expired).toBe(0);
		expect(emitted('reservation.cancelled')).toHaveLength(0);
	});
});
