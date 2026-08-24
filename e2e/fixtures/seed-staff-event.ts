/**
 * Prepare the practice space for the staff event-creation e2e.
 *
 * Mostly this *clears* rather than seeds: the test creates its event through the
 * real UI, and what it needs is the absence of last run's event. That event
 * holds a confirmed practice-space reservation for a fixed window, so a second
 * run booking the same window is rejected as a genuine conflict and the suite
 * fails on a stale row rather than on the code under test.
 *
 * It does seed one row: a reservation blocking a *second* window, giving the
 * conflict-warning path something deterministic to collide with.
 *
 * Idempotent: deletes and recreates its own rows on every run.
 *
 * Mirrors the D1 access pattern in seed-staff-user.ts.
 */
import { and, eq, inArray, like } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { withPlatformDb } from './platform-db';
import { event } from '../../src/lib/server/db/schema/event';
import { reservation } from '../../src/lib/server/db/schema/reservation';
import { buildTimeRangeInTz } from '../../src/lib/server/reservation/timezone';
import { SEED_STAFF_ID } from './seed-staff-user';

/** Titles the test creates are prefixed with this so they can be found again. */
export const SEED_EVENT_TITLE_PREFIX = 'E2E Reserved Show';

/**
 * How many times CI may run one test: the first attempt plus `retries`, from
 * `playwright.config.ts`. Also the width of the day block each booking test
 * owns, because each attempt books a day of its own — see `bookingDate`.
 */
const ATTEMPTS_PER_TEST = 3;

/** The first day the suite books. Far enough out that no other fixture collides. */
const FIRST_BOOKING_DAY = '2030-06-15';

function addDays(date: string, days: number): string {
	const [year, month, day] = date.split('-').map(Number);
	return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** The first day of the `index`th block of ATTEMPTS_PER_TEST consecutive days. */
function bookingBlock(index: number): string {
	return addDays(FIRST_BOOKING_DAY, index * ATTEMPTS_PER_TEST);
}

/**
 * The day a given attempt books.
 *
 * A retry has to book a day the attempt before it did not, because nothing
 * between attempts clears what that one left behind: this fixture runs once,
 * before the preview server boots, and a test may not write to the state
 * directory the server holds (see `platform-db.ts`). Re-running against the same
 * window therefore meets the confirmed hold the last attempt raised,
 * `POST /staff/events` rejects it as a genuine double-booking, and every retry
 * fails the same way — so whatever reddened the *first* attempt was permanent
 * for the rest of the run, and got reported as a create that never navigated.
 *
 * Each booking test owns ATTEMPTS_PER_TEST consecutive days, one per attempt, so
 * no offset can reach into the next test's block.
 */
export function bookingDate(base: string, retry: number): string {
	if (retry >= ATTEMPTS_PER_TEST) {
		throw new Error(
			`Attempt ${retry + 1} has no day of its own: raise ATTEMPTS_PER_TEST in ` +
				`e2e/fixtures/seed-staff-event.ts to match playwright.config.ts's retries.`
		);
	}
	return addDays(base, retry);
}

/** The window every booking test holds, on whichever day of its block it draws. */
export const SEED_EVENT_START = '19:00';
export const SEED_EVENT_END = '22:00';

/** The creation test's block. */
export const SEED_EVENT_DATE = bookingBlock(0);

/**
 * A block each for the two edit tests. Each books a hold of its own, so they get
 * a block each — sharing one would make the second test collide with the first
 * test's booking rather than with the thing it means to assert.
 */
export const SEED_EDIT_EVENT_DATE = bookingBlock(1);
export const SEED_SELF_CONFLICT_DATE = bookingBlock(2);

/** The reservation-list test's block, for the same reason. */
export const SEED_LIST_LINK_DATE = bookingBlock(3);

/**
 * A day already fully booked, for the conflict-warning test. That test never
 * submits, so it raises no hold and needs only its first day — but it still gets
 * a whole block, so that a test which starts submitting cannot silently land on
 * a neighbour's day.
 */
export const SEED_CONFLICT_ID = 'e2e-staff-event-conflict';
export const SEED_CONFLICT_DATE = bookingBlock(4);
export const SEED_CONFLICT_START = '19:00';
export const SEED_CONFLICT_END = '22:00';

/** The club's wall clock — the times above are entered in it, as staff would. */
const CLUB_TZ = 'America/Los_Angeles';

export async function seedStaffEvent() {
	await withPlatformDb(async (db) => {
		await clearStaleEvents(db);
		await seedBlockedWindow(db);
	});
}

/** Drop the event (and held space) the previous run created through the UI. */
async function clearStaleEvents(db: DrizzleD1Database) {
	const stale = await db
		.select({ id: event.id, reservationId: event.reservationId })
		.from(event)
		.where(like(event.title, `${SEED_EVENT_TITLE_PREFIX}%`));

	if (stale.length === 0) return;
	const ids = stale.map((e) => e.id);

	// Events first: `event.reservation_id` is a foreign key into reservation, so
	// the held rows can only go once nothing points at them.
	await db.delete(event).where(inArray(event.id, ids));

	const reservationIds = stale.map((e) => e.reservationId).filter((id): id is string => !!id);
	if (reservationIds.length > 0) {
		await db.delete(reservation).where(inArray(reservation.id, reservationIds));
	}

	// A reservation whose event insert was rolled back carries no link back, so
	// sweep by booker as well.
	await db
		.delete(reservation)
		.where(and(eq(reservation.bookerType, 'event'), inArray(reservation.bookerId, ids)));
}

/** Hold SEED_CONFLICT_DATE so the modal's conflict warning has to fire. */
async function seedBlockedWindow(db: DrizzleD1Database) {
	await db.delete(reservation).where(eq(reservation.id, SEED_CONFLICT_ID));

	const { startsAt, endsAt } = buildTimeRangeInTz(
		SEED_CONFLICT_DATE,
		SEED_CONFLICT_START,
		SEED_CONFLICT_END,
		CLUB_TZ
	);

	await db.insert(reservation).values({
		id: SEED_CONFLICT_ID,
		bookerType: 'user',
		bookerId: SEED_STAFF_ID,
		createdByUserId: SEED_STAFF_ID,
		status: 'confirmed',
		startsAt,
		endsAt,
		notes: 'e2e: blocks the window the conflict-warning test books'
	});
}
