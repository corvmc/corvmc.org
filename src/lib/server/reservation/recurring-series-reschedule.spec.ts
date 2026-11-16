import { describe, it, expect, beforeEach, vi } from 'vitest';
import { forEachClockEdge, addCalendarDays } from '#lib/test/clock-edges.js';

/**
 * A schedule change writes a new series, supersedes the old one and sorts the
 * old bookings by a `WHERE`, so this runs on real SQLite at the clock edges:
 * the change day, the new prototype and the generated window are all club time.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite({ foreignKeys: true });
});

vi.mock('#lib/server/db/index.js', async () => ({
	db: testDb,
	getRowCount: (await import('#lib/server/db/row-count.js')).getRowCount
}));

const { emit, refund, promoteNextWaitlisted } = vi.hoisted(() => ({
	emit: vi.fn(),
	refund: vi.fn(),
	promoteNextWaitlisted: vi.fn(async () => ({ promoted: false }))
}));
vi.mock('#lib/server/event-bus/event-bus.js', () => ({ domainEvents: { emit, on: vi.fn() } }));
vi.mock('#lib/server/finance/payment-service.js', () => ({ refund }));
vi.mock('./waitlist-service', () => ({ promoteNextWaitlisted }));
vi.mock('#lib/server/site-config/site-config-service.js', () => ({
	config: vi.fn(async () => ''),
	getConfigsByPrefix: vi.fn(async () => ({}))
}));

const { reschedule, previewReschedule } = await import('./recurring-series-reschedule');
const { RecurringSeriesError } = await import('./recurring-series-service');
const { buildRRule } = await import('./rrule-helpers');
const { buildDateInTz, formatDateInTz, formatTimeInTz } = await import('./timezone');

const TZ = 'America/Los_Angeles';
const MEMBER = 'user-member';
const OTHER = 'user-other';
const STAFF = 'user-staff';
const OLD = 'ser-old';

const at = (date: string, time: string) => buildDateInTz(date, time, TZ);
const secs = (d: Date) => Math.floor(d.getTime() / 1000);

function booking(
	id: string,
	startsAt: Date,
	extra: {
		status?: string;
		series?: string | null;
		by?: string;
		columns?: Record<string, unknown>;
	} = {}
) {
	const cols: Record<string, unknown> = {
		id,
		booker_type: 'user',
		booker_id: extra.by ?? MEMBER,
		created_by_user_id: extra.by ?? MEMBER,
		status: extra.status ?? 'confirmed',
		recurring_series_id: extra.series === undefined ? OLD : extra.series,
		starts_at: secs(startsAt),
		ends_at: secs(startsAt) + 7200,
		...extra.columns
	};
	const names = Object.keys(cols);
	sqlite
		.prepare(
			`INSERT INTO reservation (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`
		)
		.run(...Object.values(cols));
}

const statusOf = (id: string) =>
	(
		sqlite.prepare(`SELECT status FROM reservation WHERE id = ?`).get(id) as
			{ status: string } | undefined
	)?.status ?? 'deleted';

const series = (id: string) =>
	sqlite.prepare(`SELECT * FROM recurring_series WHERE id = ?`).get(id) as {
		prototype_id: string;
		cancelled_at: number | null;
		superseded_by: string | null;
	};

const rowsOf = (seriesId: string) =>
	(
		sqlite
			.prepare(
				`SELECT id, status, starts_at, ends_at FROM reservation WHERE recurring_series_id = ? ORDER BY starts_at`
			)
			.all(seriesId) as { id: string; status: string; starts_at: number; ends_at: number }[]
	).map((r) => ({ ...r, startsAt: new Date(r.starts_at * 1000) }));

/** Old weekly series at 19:00, prototype two weeks back; bookings around `clubDate`. */
function seed(clubDate: string) {
	sqlite.pragma('foreign_keys = OFF');
	for (const t of ['work_order_link', 'work_order', 'reservation', 'recurring_series', 'user']) {
		sqlite.exec(`DELETE FROM ${t}`);
	}
	sqlite.pragma('foreign_keys = ON');
	sqlite.exec(
		`INSERT INTO user (id, name, email) VALUES
		 ('${MEMBER}', 'Member', 'm@example.com'), ('${OTHER}', 'Other', 'o@example.com'),
		 ('${STAFF}', 'Staff', 's@example.com')`
	);
	const protoStart = at(addCalendarDays(clubDate, -14), '19:00');
	sqlite
		.prepare(
			`INSERT INTO recurring_series (id, prototype_type, prototype_id, rrule, created_by)
			 VALUES (?, 'reservation', 'res-proto', ?, ?)`
		)
		.run(OLD, buildRRule(protoStart, 'weekly'), MEMBER);
	booking('res-proto', protoStart, { status: 'completed' });
	booking('res-before', at(addCalendarDays(clubDate, 1), '19:00'));
	booking('res-untouched', at(addCalendarDays(clubDate, 4), '19:00'));
	booking('res-paid', at(addCalendarDays(clubDate, 5), '19:00'), {
		columns: { paid_at: 1, stripe_payment_record_id: 'pr_1' }
	});
	booking('res-queued', at(addCalendarDays(clubDate, 6), '19:00'), { status: 'waitlisted' });
}

/** Weekly at 18:00–20:00 from three club days ahead. */
const schedule = (clubDate: string) => ({
	startsAt: at(addCalendarDays(clubDate, 3), '18:00'),
	endsAt: at(addCalendarDays(clubDate, 3), '20:00'),
	frequency: 'weekly' as const
});

beforeEach(() => {
	vi.clearAllMocks();
});

describe('changing the schedule of a recurring booking', () => {
	forEachClockEdge(
		'supersedes the old series and starts the new one on the chosen club day',
		async ({ clubDate }) => {
			seed(clubDate);
			const outcome = await reschedule(OLD, schedule(clubDate), { kind: 'staff', userId: STAFF });
			expect(outcome.errors).toEqual([]);

			const old = series(OLD);
			expect(old.superseded_by).toBe(outcome.seriesId);
			expect(old.cancelled_at).not.toBeNull();

			const next = series(outcome.seriesId);
			expect(next.cancelled_at).toBeNull();
			const [first, ...rest] = rowsOf(outcome.seriesId);
			expect(first.id).toBe(next.prototype_id);
			expect(first.status).toBe('confirmed');
			expect(formatDateInTz(first.startsAt, TZ)).toBe(addCalendarDays(clubDate, 3));
			// Generated at once, and every session keeps the club's 18:00 across a changeover.
			expect(rest.length).toBeGreaterThan(0);
			for (const row of [first, ...rest]) {
				expect(formatTimeInTz(row.startsAt, TZ)).toBe('18:00');
				expect(row.ends_at - row.starts_at).toBe(7200);
			}
		},
		{ fakeTimers: true }
	);

	forEachClockEdge(
		'keeps old bookings before the change day and paid ones after it',
		async ({ clubDate }) => {
			seed(clubDate);
			const outcome = await reschedule(OLD, schedule(clubDate), { kind: 'staff', userId: STAFF });

			expect(statusOf('res-before')).toBe('confirmed');
			expect(statusOf('res-untouched')).toBe('deleted');
			expect(statusOf('res-queued')).toBe('deleted');
			expect(statusOf('res-paid')).toBe('confirmed');
			expect(refund).not.toHaveBeenCalled();
			expect(outcome.kept.map((k) => k.id)).toEqual(['res-paid']);
			expect(outcome.removed.sort()).toEqual(['res-queued', 'res-untouched']);
			expect(promoteNextWaitlisted).toHaveBeenCalledTimes(2);
		},
		{ fakeTimers: true, only: ['noon', 'fallBackBefore', 'yearEnd'] }
	);

	// The edges above start the new schedule after their changeover; these cross one.
	it.each([
		['spring forward', '2026-02-28'],
		['fall back', '2026-10-25']
	])('keeps the club hour across %s inside the new window', async (_, today) => {
		vi.useFakeTimers({ toFake: ['Date'] });
		try {
			vi.setSystemTime(at(today, '12:00'));
			seed(today);
			const outcome = await reschedule(OLD, schedule(today), { kind: 'staff', userId: STAFF });

			const rows = rowsOf(outcome.seriesId);
			expect(rows.length).toBeGreaterThanOrEqual(3);
			expect(rows.map((r) => formatTimeInTz(r.startsAt, TZ))).toEqual(rows.map(() => '18:00'));
		} finally {
			vi.useRealTimers();
		}
	});

	it('waitlists a new session that someone else has booked, as generation does', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		try {
			vi.setSystemTime(new Date('2026-06-15T19:00:00Z'));
			seed('2026-06-15');
			booking('res-taken', at('2026-06-18', '18:30'), { series: null, by: OTHER });

			const outcome = await reschedule(OLD, schedule('2026-06-15'), {
				kind: 'staff',
				userId: STAFF
			});

			expect(outcome.waitlisted).toBe(true);
			expect(statusOf(series(outcome.seriesId).prototype_id)).toBe('waitlisted');
			expect(statusOf('res-taken')).toBe('confirmed');
		} finally {
			vi.useRealTimers();
		}
	});

	it('shows the conflicts and what goes before anything is written', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		try {
			vi.setSystemTime(new Date('2026-06-15T19:00:00Z'));
			seed('2026-06-15');
			booking('res-taken', at('2026-06-25', '18:00'), { series: null, by: OTHER });

			const preview = await previewReschedule(OLD, schedule('2026-06-15'));

			expect(preview.sessions[0].conflict).toBeNull();
			expect(preview.sessions[1]).toMatchObject({ conflict: 'booked' });
			expect(preview.kept.map((k) => k.id)).toEqual(['res-paid']);
			expect(preview.removed).toBe(2);
			expect(series(OLD).superseded_by).toBeNull();
		} finally {
			vi.useRealTimers();
		}
	});

	it('tells the booker when staff make the change', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		try {
			vi.setSystemTime(new Date('2026-06-15T19:00:00Z'));
			seed('2026-06-15');
			await reschedule(OLD, schedule('2026-06-15'), { kind: 'staff', userId: STAFF });

			expect(emit).toHaveBeenCalledWith(
				'reservation.recurring_rescheduled',
				expect.objectContaining({ userId: MEMBER, date: '2026-06-18', keptCount: 1 })
			);
		} finally {
			vi.useRealTimers();
		}
	});

	it('cancels a still-ahead untouched old prototype rather than deleting it', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		try {
			vi.setSystemTime(new Date('2026-06-15T19:00:00Z'));
			seed('2026-06-15');
			sqlite
				.prepare(
					`UPDATE reservation SET status = 'confirmed', starts_at = ?, ends_at = ? WHERE id = 'res-proto'`
				)
				.run(secs(at('2026-06-22', '19:00')), secs(at('2026-06-22', '21:00')));

			const outcome = await reschedule(OLD, schedule('2026-06-15'), {
				kind: 'owner',
				userId: MEMBER
			});

			expect(statusOf('res-proto')).toBe('cancelled');
			expect(outcome.removed).toContain('res-proto');
			expect(emit).not.toHaveBeenCalledWith('reservation.recurring_rescheduled', expect.anything());
		} finally {
			vi.useRealTimers();
		}
	});

	it('refuses a first session on a closure, writing nothing', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		try {
			vi.setSystemTime(new Date('2026-06-15T19:00:00Z'));
			seed('2026-06-15');
			sqlite
				.prepare(
					`INSERT INTO closure (id, starts_at, ends_at, reason) VALUES ('c1', ?, ?, 'Floor repair')`
				)
				.run(secs(at('2026-06-18', '00:00')), secs(at('2026-06-19', '00:00')));

			await expect(
				reschedule(OLD, schedule('2026-06-15'), { kind: 'staff', userId: STAFF })
			).rejects.toThrow(RecurringSeriesError);
			expect(series(OLD).superseded_by).toBeNull();
			expect(statusOf('res-untouched')).toBe('confirmed');
		} finally {
			vi.useRealTimers();
		}
	});

	it('refuses a series that has already been replaced', async () => {
		seed(formatDateInTz(new Date(), TZ));
		sqlite.exec(`UPDATE recurring_series SET cancelled_at = unixepoch() WHERE id = '${OLD}'`);

		await expect(
			reschedule(OLD, schedule(formatDateInTz(new Date(), TZ)), { kind: 'staff', userId: STAFF })
		).rejects.toThrow(RecurringSeriesError);
		expect(sqlite.prepare(`SELECT count(*) AS n FROM recurring_series`).get()).toEqual({ n: 1 });
	});
});
