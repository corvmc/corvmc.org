import { describe, it, expect, beforeEach, vi } from 'vitest';
import { forEachClockEdge, addCalendarDays } from '#lib/test/clock-edges.js';

/**
 * #2719: a program's series moves with its room holds. Real SQLite, because
 * which occurrences go is a `WHERE` over every record that can point at one.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite({ foreignKeys: true });
});

vi.mock('#lib/server/db/index.js', async () => ({
	db: testDb,
	getRowCount: (await import('#lib/server/db/row-count.js')).getRowCount
}));

const { emit, programRole } = vi.hoisted(() => ({
	emit: vi.fn(),
	programRole: vi.fn(async () => ({}))
}));
vi.mock('#lib/server/event-bus/event-bus.js', () => ({ domainEvents: { emit, on: vi.fn() } }));
vi.mock('#lib/server/finance/payment-service.js', () => ({ refund: vi.fn() }));
vi.mock('./waitlist-service', () => ({
	promoteNextWaitlisted: vi.fn(async () => ({ promoted: false }))
}));
vi.mock('#lib/server/site-config/site-config-service.js', () => ({
	config: vi.fn(async () => ''),
	getConfigsByPrefix: vi.fn(async () => ({}))
}));
vi.mock('#lib/server/authorization.js', async (orig) => ({
	...(await orig<typeof import('#lib/server/authorization.js')>()),
	can: vi.fn(async () => false),
	requireUser: () => ({ id: MEMBER })
}));
vi.mock('#lib/server/group/group-context.js', async (orig) => ({
	...(await orig<typeof import('#lib/server/group/group-context.js')>()),
	requireProgramRole: programRole
}));

const { rescheduleEventSeries, previewEventReschedule } = await import('./event-series-reschedule');
const { requireSeriesWriter } = await import('#lib/server/event/listing-guard.js');
const { buildRRule } = await import('./rrule-helpers');
const { buildDateInTz, formatDateInTz, formatTimeInTz } = await import('./timezone');

const TZ = 'America/Los_Angeles';
const MEMBER = 'user-leader';
const PROGRAM = 'film-club';
const OLD = 'ser-old';
const HALF_HOUR = 1800;

const at = (date: string, time: string) => buildDateInTz(date, time, TZ);
const secs = (d: Date) => Math.floor(d.getTime() / 1000);

function insert(table: string, cols: Record<string, unknown>) {
	const names = Object.keys(cols);
	sqlite
		.prepare(
			`INSERT INTO "${table}" (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`
		)
		.run(...Object.values(cols));
}

/** A session 19:00–21:00 whose hold runs half an hour either side. */
function session(id: string, startsAt: Date, opts: { hold?: boolean; status?: string } = {}) {
	const start = secs(startsAt);
	const holdId = opts.hold === false ? null : `hold-${id}`;
	if (holdId) {
		insert('reservation', {
			id: holdId,
			booker_type: 'group',
			booker_id: PROGRAM,
			created_by_user_id: MEMBER,
			status: 'confirmed',
			hard_hold: 1,
			starts_at: start - HALF_HOUR,
			ends_at: start + 7200 + HALF_HOUR
		});
	}
	insert('event_listing', {
		id,
		title: 'Film night',
		source: 'group',
		group_id: PROGRAM,
		status: opts.status ?? 'published',
		starts_at: start,
		ends_at: start + 7200,
		reservation_id: holdId,
		recurring_series_id: OLD,
		created_by_user_id: MEMBER
	});
}

const holdOf = (eventId: string) =>
	sqlite
		.prepare(
			`SELECT r.status, r.hard_hold, r.booker_id, r.starts_at, r.ends_at, e.starts_at AS event_starts
			 FROM event_listing e JOIN reservation r ON r.id = e.reservation_id WHERE e.id = ?`
		)
		.get(eventId) as
		| {
				status: string;
				hard_hold: number;
				booker_id: string;
				starts_at: number;
				ends_at: number;
				event_starts: number;
		  }
		| undefined;

const statusOf = (table: string, id: string) =>
	(
		sqlite.prepare(`SELECT status FROM "${table}" WHERE id = ?`).get(id) as
			{ status: string } | undefined
	)?.status ?? 'deleted';

const series = (id: string) =>
	sqlite.prepare(`SELECT * FROM recurring_series WHERE id = ?`).get(id) as {
		prototype_id: string;
		prototype_type: string;
		cancelled_at: number | null;
		superseded_by: string | null;
	};

const listingsOf = (seriesId: string) =>
	(
		sqlite
			.prepare(
				`SELECT id, starts_at FROM event_listing WHERE recurring_series_id = ? ORDER BY starts_at`
			)
			.all(seriesId) as { id: string; starts_at: number }[]
	).map((r) => ({ ...r, startsAt: new Date(r.starts_at * 1000) }));

/** Weekly program series at 19:00, prototype two weeks back, occurrences around `clubDate`. */
function seed(clubDate: string) {
	sqlite.pragma('foreign_keys = OFF');
	for (const t of [
		'event_rsvp',
		'event_group',
		'ticket_sale',
		'event_listing',
		'reservation',
		'recurring_series',
		'group',
		'user'
	]) {
		sqlite.exec(`DELETE FROM "${t}"`);
	}
	sqlite.pragma('foreign_keys = ON');
	insert('user', { id: MEMBER, name: 'Leader', email: 'l@example.com' });
	insert('group', { id: PROGRAM, name: 'Film Club', slug: 'film-club', kind: 'club' });
	const protoStart = at(addCalendarDays(clubDate, -14), '19:00');
	insert('recurring_series', {
		id: OLD,
		prototype_type: 'event_listing',
		prototype_id: 'evt-proto',
		rrule: buildRRule(protoStart, 'weekly'),
		created_by: MEMBER
	});
	session('evt-proto', protoStart);
	session('evt-before', at(addCalendarDays(clubDate, 1), '19:00'));
	session('evt-untouched', at(addCalendarDays(clubDate, 4), '19:00'));
	session('evt-rsvp', at(addCalendarDays(clubDate, 5), '19:00'));
	insert('event_rsvp', {
		id: 'rsvp-1',
		event_id: 'evt-rsvp',
		user_id: MEMBER,
		attendee_name: 'Guest',
		attendee_email: 'g@example.com'
	});
}

/** Weekly at 18:00–20:00 from three club days ahead. */
const schedule = (clubDate: string) => ({
	startsAt: at(addCalendarDays(clubDate, 3), '18:00'),
	endsAt: at(addCalendarDays(clubDate, 3), '20:00'),
	frequency: 'weekly' as const
});

const staff = { kind: 'staff', userId: MEMBER } as const;

beforeEach(() => {
	vi.clearAllMocks();
});

describe('changing the schedule of a program series', () => {
	forEachClockEdge(
		'moves the sessions and their room holds together',
		async ({ clubDate }) => {
			seed(clubDate);
			const outcome = await rescheduleEventSeries(OLD, schedule(clubDate), staff);
			expect(outcome.errors).toEqual([]);

			const old = series(OLD);
			expect(old.superseded_by).toBe(outcome.seriesId);
			expect(old.cancelled_at).not.toBeNull();
			const next = series(outcome.seriesId);
			expect(next).toMatchObject({
				prototype_type: 'event_listing',
				prototype_id: outcome.eventId
			});

			const listings = listingsOf(outcome.seriesId);
			expect(listings[0].id).toBe(outcome.eventId);
			expect(formatDateInTz(listings[0].startsAt, TZ)).toBe(addCalendarDays(clubDate, 3));
			// Generated at once, each at the club's 18:00 and each holding the room.
			expect(listings.length).toBeGreaterThan(1);
			for (const listing of listings) {
				expect(formatTimeInTz(listing.startsAt, TZ)).toBe('18:00');
				const hold = holdOf(listing.id)!;
				expect(hold).toMatchObject({ status: 'confirmed', hard_hold: 1, booker_id: PROGRAM });
				// The old setup and teardown carry over.
				expect(hold.event_starts - hold.starts_at).toBe(HALF_HOUR);
				expect(hold.ends_at - hold.event_starts).toBe(7200 + HALF_HOUR);
			}
		},
		{ fakeTimers: true, only: ['noon', 'springForwardBefore', 'fallBackBefore', 'yearEnd'] }
	);

	it('leaves sessions before the change day alone and keeps one someone answered', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		try {
			vi.setSystemTime(at('2026-06-15', '12:00'));
			seed('2026-06-15');
			const outcome = await rescheduleEventSeries(OLD, schedule('2026-06-15'), staff);

			expect(statusOf('event_listing', 'evt-proto')).toBe('published');
			expect(statusOf('event_listing', 'evt-before')).toBe('published');
			expect(holdOf('evt-before')?.status).toBe('confirmed');

			expect(statusOf('event_listing', 'evt-untouched')).toBe('deleted');
			expect(statusOf('reservation', 'hold-evt-untouched')).toBe('cancelled');

			expect(statusOf('event_listing', 'evt-rsvp')).toBe('published');
			expect(holdOf('evt-rsvp')?.status).toBe('confirmed');
			expect(outcome.kept.map((k) => k.id)).toEqual(['evt-rsvp']);
			expect(outcome.removed).toEqual(['evt-untouched']);
		} finally {
			vi.useRealTimers();
		}
	});

	it('waitlists the first hold behind a booking, and does not count the holds it gives back', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		try {
			vi.setSystemTime(at('2026-06-15', '12:00'));
			seed('2026-06-15');
			// Overlaps the new first session, on the day of an old one that goes.
			insert('reservation', {
				id: 'res-taken',
				booker_type: 'user',
				booker_id: MEMBER,
				created_by_user_id: MEMBER,
				status: 'confirmed',
				starts_at: secs(at('2026-06-18', '17:00')),
				ends_at: secs(at('2026-06-18', '18:00'))
			});
			const moved = { ...schedule('2026-06-15'), startsAt: at('2026-06-19', '19:30') };
			moved.endsAt = at('2026-06-19', '21:30');

			const preview = await previewEventReschedule(OLD, moved);
			// 19:00–21:30 on the 19th is evt-untouched's own hold, which goes.
			expect(preview.sessions[0].conflict).toBeNull();
			expect(preview.removed).toBe(1);

			const outcome = await rescheduleEventSeries(OLD, schedule('2026-06-15'), staff);
			expect(outcome.waitlisted).toBe(true);
			expect(holdOf(outcome.eventId)?.status).toBe('waitlisted');
			expect(statusOf('reservation', 'res-taken')).toBe('confirmed');
		} finally {
			vi.useRealTimers();
		}
	});

	it('refuses a first session on another show', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		try {
			vi.setSystemTime(at('2026-06-15', '12:00'));
			seed('2026-06-15');
			insert('reservation', {
				id: 'res-show',
				booker_type: 'production',
				booker_id: 'prod-1',
				created_by_user_id: MEMBER,
				status: 'confirmed',
				hard_hold: 1,
				starts_at: secs(at('2026-06-18', '19:00')),
				ends_at: secs(at('2026-06-18', '23:00'))
			});

			await expect(rescheduleEventSeries(OLD, schedule('2026-06-15'), staff)).rejects.toThrow();
			expect(series(OLD).superseded_by).toBeNull();
			expect(statusOf('event_listing', 'evt-untouched')).toBe('published');
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('who may change it', () => {
	it('asks the program for a leader', async () => {
		seed('2026-06-15');
		await expect(requireSeriesWriter('evt-proto')).resolves.toBe('owner');
		expect(programRole).toHaveBeenCalledWith({ id: PROGRAM }, 'admin');
	});

	it('refuses a member who does not lead the program', async () => {
		seed('2026-06-15');
		programRole.mockRejectedValueOnce(new Error('403'));
		await expect(requireSeriesWriter('evt-proto')).rejects.toThrow(/403/);
	});
});
