import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Cancelling a reservation series cancels its next booking and deletes the
 * later ones. Which rows go is a `WHERE`, so this runs on real SQLite; the
 * mocked `recurring-series-service.spec.ts` cannot see which rows a predicate
 * keeps.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite({ foreignKeys: true });
});

// D1 runs a batch as one transaction; better-sqlite3's drizzle has no `batch`, so this is it.
vi.mock('$lib/server/db', () => ({
	db: Object.assign(testDb, {
		batch: async (stmts: PromiseLike<unknown>[]) => {
			sqlite.exec('begin');
			try {
				const out = [];
				for (const s of stmts) out.push(await s);
				sqlite.exec('commit');
				return out;
			} catch (e) {
				sqlite.exec('rollback');
				throw e;
			}
		}
	}),
	getRowCount: (r: unknown) => {
		const x = r as { meta?: { changes?: number }; changes?: number };
		return Number(x?.meta?.changes ?? x?.changes ?? 0);
	}
}));

const { emit, refund, promoteNextWaitlisted } = vi.hoisted(() => ({
	emit: vi.fn(),
	refund: vi.fn(),
	promoteNextWaitlisted: vi.fn(async () => ({ promoted: false }))
}));
vi.mock('$lib/server/event-bus/event-bus', () => ({ domainEvents: { emit, on: vi.fn() } }));
vi.mock('$lib/server/finance/payment-service', () => ({ refund }));
vi.mock('./waitlist-service', () => ({ promoteNextWaitlisted }));

const svc = await import('./recurring-series-service');

const MEMBER = 'user-member';
const STAFF = 'user-staff';
const DAY = 86400;

function insertReservation(
	id: string,
	offsetDays: number,
	extra: { status?: string; series?: string; columns?: Record<string, string | number> } = {}
) {
	const cols: Record<string, string | number> = {
		id,
		booker_type: 'user',
		booker_id: MEMBER,
		created_by_user_id: MEMBER,
		status: extra.status ?? 'scheduled',
		recurring_series_id: extra.series ?? 'ser-1',
		...extra.columns
	};
	const names = Object.keys(cols);
	const start = `unixepoch() + ${Math.round(offsetDays * DAY)}`;
	sqlite
		.prepare(
			`INSERT INTO reservation (${names.join(', ')}, starts_at, ends_at)
			 VALUES (${names.map(() => '?').join(', ')}, ${start}, ${start} + 7200)`
		)
		.run(...Object.values(cols));
}

function insertSeries(id: string, prototypeId: string, prototypeType = 'reservation') {
	sqlite
		.prepare(
			`INSERT INTO recurring_series (id, prototype_type, prototype_id, rrule, created_by)
			 VALUES (?, ?, ?, 'FREQ=WEEKLY', ?)`
		)
		.run(id, prototypeType, prototypeId, MEMBER);
}

const statusOf = (id: string) =>
	(
		sqlite.prepare(`SELECT status FROM reservation WHERE id = ?`).get(id) as
			{ status: string } | undefined
	)?.status ?? 'deleted';

beforeEach(() => {
	vi.clearAllMocks();
	sqlite.pragma('foreign_keys = OFF');
	for (const t of ['work_order', 'reservation', 'recurring_series', 'user']) {
		sqlite.exec(`DELETE FROM ${t}`);
	}
	sqlite.pragma('foreign_keys = ON');
	sqlite.exec(
		`INSERT INTO user (id, name, email) VALUES
		 ('${MEMBER}', 'Member', 'm@example.com'), ('${STAFF}', 'Staff', 's@example.com')`
	);

	// The prototype is in the past, so the cascade is about the generated rows.
	insertSeries('ser-1', 'res-proto');
	insertReservation('res-proto', -14, { status: 'completed' });
	insertReservation('res-past', -7, { status: 'confirmed' });
	insertReservation('res-next', 1);
	insertReservation('res-later-a', 8);
	insertReservation('res-later-b', 15, { status: 'waitlisted' });
	insertReservation('res-paid', 22, {
		status: 'confirmed',
		columns: { paid_at: 1, stripe_payment_record_id: 'pr_1' }
	});
	insertReservation('res-credits', 29, {
		status: 'confirmed',
		columns: { credits_used: 2, cash_due_cents: 0 }
	});
	insertReservation('res-gone', 36, { status: 'cancelled' });
	insertReservation('res-staffed', 43);
	sqlite.exec(
		`INSERT INTO work_order (id, title, reservation_id) VALUES ('wo-1', 'Orientation', 'res-staffed')`
	);
});

describe('cancelling a reservation series', () => {
	it('cancels the next booking through the reservation cancel path', async () => {
		await svc.cancel('ser-1', { kind: 'staff', userId: STAFF });

		expect(statusOf('res-next')).toBe('cancelled');
		expect(emit).toHaveBeenCalledWith(
			'reservation.cancelled',
			expect.objectContaining({ reservationId: 'res-next', cancelledBy: 'staff' })
		);
	});

	it('deletes the later bookings that no money touched', async () => {
		await svc.cancel('ser-1', { kind: 'staff', userId: STAFF });

		expect(statusOf('res-later-a')).toBe('deleted');
		expect(statusOf('res-later-b')).toBe('deleted');
		// The freed slots still reach the waitlist, though nothing was cancelled.
		expect(promoteNextWaitlisted).toHaveBeenCalledTimes(2);
	});

	it('cancels, rather than deletes, a later booking that money touched', async () => {
		await svc.cancel('ser-1', { kind: 'staff', userId: STAFF });

		expect(statusOf('res-paid')).toBe('cancelled');
		expect(refund).toHaveBeenCalledWith(expect.objectContaining({ stripePaymentRecordId: 'pr_1' }));
		expect(statusOf('res-credits')).toBe('cancelled');
	});

	it('cancels, rather than deletes, a later booking a shift is pinned to', async () => {
		await svc.cancel('ser-1', { kind: 'staff', userId: STAFF });

		expect(statusOf('res-staffed')).toBe('cancelled');
		expect(emit).toHaveBeenCalledWith(
			'reservation.cancelled',
			expect.objectContaining({ reservationId: 'res-staffed' })
		);
	});

	it('leaves past, completed and already-cancelled bookings alone', async () => {
		await svc.cancel('ser-1', { kind: 'staff', userId: STAFF });

		expect(statusOf('res-proto')).toBe('completed');
		expect(statusOf('res-past')).toBe('confirmed');
		expect(statusOf('res-gone')).toBe('cancelled');
	});

	it('stops generation', async () => {
		await svc.cancel('ser-1', { kind: 'owner', userId: MEMBER });

		const row = sqlite
			.prepare(`SELECT cancelled_at FROM recurring_series WHERE id = 'ser-1'`)
			.get();
		expect(row).toEqual({ cancelled_at: expect.any(Number) });
		expect(emit).toHaveBeenCalledWith(
			'reservation.cancelled',
			expect.objectContaining({ reservationId: 'res-next', cancelledBy: 'member' })
		);
	});

	it('never deletes the prototype, even when it is still ahead', async () => {
		sqlite.exec(`UPDATE reservation SET starts_at = unixepoch() + ${3 * DAY},
		             ends_at = unixepoch() + ${3 * DAY + 7200}, status = 'scheduled' WHERE id = 'res-proto'`);

		await svc.cancel('ser-1', { kind: 'staff', userId: STAFF });

		expect(statusOf('res-proto')).toBe('cancelled');
	});

	it('refuses a series that is already cancelled, touching nothing', async () => {
		sqlite.exec(`UPDATE recurring_series SET cancelled_at = unixepoch() WHERE id = 'ser-1'`);

		await expect(svc.cancel('ser-1', { kind: 'staff', userId: STAFF })).rejects.toThrow(
			svc.RecurringSeriesError
		);
		expect(statusOf('res-next')).toBe('scheduled');
		expect(statusOf('res-later-a')).toBe('scheduled');
	});

	it('leaves an event series’ bookings alone', async () => {
		sqlite.exec(`DELETE FROM work_order`);
		sqlite.exec(`DELETE FROM reservation WHERE recurring_series_id = 'ser-1'`);
		insertSeries('ser-event', 'evt-proto', 'event_listing');
		insertReservation('res-event-next', 1, { series: 'ser-event' });
		insertReservation('res-event-later', 8, { series: 'ser-event' });

		await svc.cancel('ser-event', { kind: 'staff', userId: STAFF });

		expect(statusOf('res-event-next')).toBe('scheduled');
		expect(statusOf('res-event-later')).toBe('scheduled');
		expect(emit).not.toHaveBeenCalled();
	});
});

describe('a lapsed subscription', () => {
	it('cascades the same way, as the system', async () => {
		const count = await svc.cancelAllForUser(MEMBER);

		expect(count).toBe(1);
		expect(statusOf('res-next')).toBe('cancelled');
		expect(statusOf('res-later-a')).toBe('deleted');
		expect(statusOf('res-paid')).toBe('cancelled');
		expect(emit).toHaveBeenCalledWith(
			'reservation.cancelled',
			expect.objectContaining({ reservationId: 'res-next', cancelledBy: 'system' })
		);
	});
});
