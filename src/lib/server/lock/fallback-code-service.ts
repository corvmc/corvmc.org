import { db } from '$lib/server/db';
import { lockFallbackCode, reservation } from '$lib/server/db/schema/reservation';
import { and, asc, count, eq, inArray, isNotNull, isNull, lt, or } from 'drizzle-orm';
import {
	addLockUser,
	getLockUser,
	listLockUsers,
	removeTemporaryUser,
	generateLockCode,
	LOCK_GRACE_MINUTES
} from './ultraloc-client';
import { getJson, putJson } from '$lib/server/kv';
import { dispatchEmailOnly } from '$lib/server/notification';
import { env } from '$env/dynamic/private';
import { DOOR_CODE_POOL_SIZE } from '$lib/config';
import type { LockFallbackCode } from '$lib/server/db/schema/reservation';

// The door-code pool (#2120). The lock checks codes locally, so a code minted
// while it is online still opens the door during an outage — which is exactly
// when a code minted for one booking never arrives. Codes are type-0 users with
// no lock-side expiry, since an expiry is itself a change the lock must learn.

/** Name on the lock for a pool code. The unmanaged-code list filters on it. */
export const POOL_NAME_PREFIX = 'CMC Door';

const POOL_EMPTY_ALERT_KEY = 'ultraloc:poolEmptyAlertedOn';

const graceMs = () => LOCK_GRACE_MINUTES * 60_000;

/** Synced, never handed to anyone, still on the lock. */
const available = () =>
	and(
		eq(lockFallbackCode.pooled, true),
		isNotNull(lockFallbackCode.syncedAt),
		isNull(lockFallbackCode.claimedByReservationId),
		isNull(lockFallbackCode.revealedAt),
		isNull(lockFallbackCode.removedAt)
	);

/** Counts towards the pool's depth: available, or minted and still on its way. */
const inPool = () =>
	and(
		eq(lockFallbackCode.pooled, true),
		isNull(lockFallbackCode.claimedByReservationId),
		isNull(lockFallbackCode.revealedAt),
		isNull(lockFallbackCode.removedAt)
	);

/** How many codes can be handed out right now. */
export async function poolDepth(): Promise<number> {
	const [row] = await db.select({ n: count() }).from(lockFallbackCode).where(available());
	return row?.n ?? 0;
}

// ---------------------------------------------------------------------------
// Claims
// ---------------------------------------------------------------------------

/** The live code this booking already holds, if any. */
async function heldBy(reservationId: string): Promise<LockFallbackCode | null> {
	const [row] = await db
		.select()
		.from(lockFallbackCode)
		.where(
			and(
				eq(lockFallbackCode.claimedByReservationId, reservationId),
				isNull(lockFallbackCode.removedAt)
			)
		)
		.limit(1);
	return row ?? null;
}

/**
 * The booking's code, claiming one from the pool the first time. The same code
 * serves the whole booking. Null when the pool is empty, which alerts staff.
 *
 * The update re-checks the claim, and a unique index allows one live code per
 * booking, so two loads racing for one code or one booking both end on one row.
 */
export async function claimPoolCode(
	reservationId: string,
	now: Date = new Date()
): Promise<LockFallbackCode | null> {
	for (let attempt = 0; attempt < 3; attempt++) {
		const held = await heldBy(reservationId);
		if (held) return held;

		const [candidate] = await db
			.select({ id: lockFallbackCode.id })
			.from(lockFallbackCode)
			.where(available())
			.orderBy(asc(lockFallbackCode.syncedAt), asc(lockFallbackCode.id))
			.limit(1);

		if (!candidate) {
			await alertPoolEmpty(now);
			return null;
		}

		try {
			const [won] = await db
				.update(lockFallbackCode)
				.set({ claimedByReservationId: reservationId, claimedAt: now })
				.where(and(eq(lockFallbackCode.id, candidate.id), available()))
				.returning();
			if (won) return won;
		} catch {
			// The unique index: another load claimed for this booking first.
		}
	}
	return heldBy(reservationId);
}

/** Claim and mark shown. A revealed code is burned once the booking is over. */
export async function revealPoolCode(
	reservationId: string,
	now: Date = new Date()
): Promise<LockFallbackCode | null> {
	const code = await claimPoolCode(reservationId, now);
	if (!code || code.revealedAt) return code;

	await db
		.update(lockFallbackCode)
		.set({ revealedAt: now })
		.where(eq(lockFallbackCode.id, code.id));
	return { ...code, revealedAt: now };
}

/** One email a day while the pool is empty, not one per page load. */
async function alertPoolEmpty(now: Date): Promise<void> {
	try {
		const today = now.toISOString().slice(0, 10);
		if ((await getJson<string>(POOL_EMPTY_ALERT_KEY)) === today) return;
		await putJson(POOL_EMPTY_ALERT_KEY, today, 2 * 24 * 60 * 60);

		await dispatchEmailOnly({
			type: 'lock_pool_empty',
			toEmail: env.STAFF_CONTACT_EMAIL ?? 'staff@corvmc.org',
			email: {
				subject: 'No door codes left for bookings',
				heading: 'Door code pool is empty',
				paragraphs: [
					{
						text: 'A member with a booking needed a door code and none was left. Members are being told to call staff. The daily lock job mints more once the lock is online.'
					}
				],
				cta: { url: '/staff/keys', label: 'See door codes' }
			}
		});
	} catch (err) {
		console.error(`Failed to send the empty-pool alert: ${(err as Error).message}`);
	}
}

// ---------------------------------------------------------------------------
// The daily job's stage
// ---------------------------------------------------------------------------

export interface PoolSummary {
	confirmed: number;
	released: number;
	burned: number;
	awaitingRemoval: number;
	minted: number;
	available: number;
}

/**
 * Keep the pool at depth, in order: confirm minted codes that reached the lock,
 * release unrevealed claims whose booking is over, burn revealed ones (and the
 * legacy break-glass codes), then mint back up to `DOOR_CODE_POOL_SIZE`.
 */
export async function maintainCodePool(
	errors: string[],
	now: Date = new Date()
): Promise<PoolSummary> {
	const summary: PoolSummary = {
		confirmed: 0,
		released: 0,
		burned: 0,
		awaitingRemoval: 0,
		minted: 0,
		available: 0
	};

	// Each stage on its own: a failed burn must not stop the pool refilling.
	async function stage(name: string, fn: () => Promise<void>) {
		try {
			await fn();
		} catch (err) {
			const msg = `Door code pool: ${name} failed: ${(err as Error).message}`;
			console.error(msg);
			errors.push(msg);
		}
	}

	await stage('confirm', async () => {
		summary.confirmed = await confirmMinted(errors);
	});
	await stage('release', async () => {
		summary.released = await releaseUnrevealed(now);
	});
	await stage('burn', async () => {
		const burn = await burnSpent(errors, now);
		summary.burned = burn.removed;
		summary.awaitingRemoval = burn.awaiting;
	});
	await stage('mint', async () => {
		summary.minted = await refill(errors);
	});
	await stage('count', async () => {
		summary.available = await poolDepth();
	});

	return summary;
}

async function confirmMinted(errors: string[]): Promise<number> {
	const pending = await db
		.select()
		.from(lockFallbackCode)
		.where(
			and(
				eq(lockFallbackCode.pooled, true),
				isNull(lockFallbackCode.syncedAt),
				isNull(lockFallbackCode.removedAt)
			)
		);

	let confirmed = 0;
	for (const row of pending) {
		if (!row.lockAccessId) {
			// The add went through but its id was never recovered; with no handle
			// the row is useless, and refill mints a replacement.
			await db.delete(lockFallbackCode).where(eq(lockFallbackCode.id, row.id));
			continue;
		}
		try {
			const detail = await getLockUser(Number(row.lockAccessId));
			if (detail?.syncStatus !== 1) continue;
			await db
				.update(lockFallbackCode)
				.set({ syncedAt: new Date() })
				.where(eq(lockFallbackCode.id, row.id));
			confirmed++;
		} catch (err) {
			errors.push(`Door code pool: could not read code ${row.id}: ${(err as Error).message}`);
		}
	}
	return confirmed;
}

/** Bookings whose claim is spent: over (plus grace), or cancelled. */
async function finishedBookingIds(now: Date): Promise<string[]> {
	const rows = await db
		.select({ id: reservation.id })
		.from(lockFallbackCode)
		.innerJoin(reservation, eq(reservation.id, lockFallbackCode.claimedByReservationId))
		.where(
			and(
				isNull(lockFallbackCode.removedAt),
				or(
					eq(reservation.status, 'cancelled'),
					lt(reservation.endsAt, new Date(now.getTime() - graceMs()))
				)
			)
		);
	return rows.map((r) => r.id);
}

async function releaseUnrevealed(now: Date): Promise<number> {
	const ids = await finishedBookingIds(now);
	if (ids.length === 0) return 0;

	const released = await db
		.update(lockFallbackCode)
		.set({ claimedByReservationId: null, claimedAt: null })
		.where(
			and(
				inArray(lockFallbackCode.claimedByReservationId, ids),
				isNull(lockFallbackCode.revealedAt),
				isNull(lockFallbackCode.removedAt)
			)
		)
		.returning({ id: lockFallbackCode.id });
	return released.length;
}

/**
 * Codes that must come off the lock: revealed ones whose booking is over (or
 * gone), and break-glass codes from before the pool — those only once the pool
 * has a code to offer, so there is never a moment with no fallback at all.
 */
async function spentCodes(now: Date): Promise<LockFallbackCode[]> {
	const finished = await finishedBookingIds(now);
	const revealedAndOver = and(
		isNotNull(lockFallbackCode.revealedAt),
		isNull(lockFallbackCode.removedAt),
		or(
			isNull(lockFallbackCode.claimedByReservationId),
			finished.length ? inArray(lockFallbackCode.claimedByReservationId, finished) : undefined
		)
	);
	const legacy = and(
		eq(lockFallbackCode.pooled, false),
		isNull(lockFallbackCode.retiredAt),
		isNull(lockFallbackCode.removedAt)
	);

	const conditions = [revealedAndOver];
	if ((await poolDepth()) > 0) conditions.push(legacy);
	return db
		.select()
		.from(lockFallbackCode)
		.where(or(...conditions));
}

/**
 * Remove each spent code. A delete for an offline lock queues at U-tec and the
 * code keeps working until it lands, so `removedAt` waits for the user to be
 * gone from the list. One still listed with a change pending (sync 0) is left
 * alone rather than sent a second delete.
 */
async function burnSpent(
	errors: string[],
	now: Date
): Promise<{ removed: number; awaiting: number }> {
	const spent = await spentCodes(now);
	if (spent.length === 0) return { removed: 0, awaiting: 0 };

	const onLock = new Map((await listLockUsers()).map((u) => [String(u.id), u]));
	let removed = 0;
	let awaiting = 0;

	for (const row of spent) {
		const user = row.lockAccessId ? onLock.get(row.lockAccessId) : undefined;
		if (!user) {
			await db
				.update(lockFallbackCode)
				.set({ removedAt: now })
				.where(eq(lockFallbackCode.id, row.id));
			removed++;
			continue;
		}
		awaiting++;
		if (user.syncStatus !== 1) continue;
		try {
			await removeTemporaryUser(user.id);
		} catch (err) {
			errors.push(`Door code pool: could not remove code ${row.id}: ${(err as Error).message}`);
		}
	}
	return { removed, awaiting };
}

/** Mint up to depth, counting codes still on their way so an outage cannot over-mint. */
async function refill(errors: string[]): Promise<number> {
	const [row] = await db.select({ n: count() }).from(lockFallbackCode).where(inPool());
	const missing = DOOR_CODE_POOL_SIZE - (row?.n ?? 0);

	let minted = 0;
	for (let i = 0; i < missing; i++) {
		// 8 digits: a type-0 code opens the door at any hour until it is removed.
		const code = generateLockCode() * 10_000 + generateLockCode();
		try {
			const lockAccessId = await addLockUser({
				name: `${POOL_NAME_PREFIX} ${code % 1000}`,
				type: 0,
				password: code
			});
			await db.insert(lockFallbackCode).values({
				code: String(code),
				pooled: true,
				lockAccessId: lockAccessId === null ? null : String(lockAccessId)
			});
			minted++;
		} catch (err) {
			errors.push(`Door code pool: could not mint a code: ${(err as Error).message}`);
			// The lock is refusing writes; the rest would fail the same way.
			break;
		}
	}
	return minted;
}

// ---------------------------------------------------------------------------
// Handing it out (until the door page replaces this, #2120 phase 3)
// ---------------------------------------------------------------------------

/**
 * Whether the booking is live right now, counting the grace the lock itself
 * gives either side. A pool code opens the door at any hour, so it is only
 * ever handed to someone whose session is actually happening.
 */
export function isInAccessWindow(
	row: { startsAt: Date; endsAt: Date },
	at: Date = new Date()
): boolean {
	const now = at.getTime();
	return now >= row.startsAt.getTime() - graceMs() && now <= row.endsAt.getTime() + graceMs();
}

type FallbackRow = { status: string; startsAt: Date; endsAt: Date; lockSyncedAt: Date | null };

/** Confirmed, its own code not on the device, and inside the access window. */
export function fallbackApplies(row: FallbackRow): boolean {
	return row.status === 'confirmed' && !row.lockSyncedAt && isInAccessWindow(row);
}

/**
 * What the member's page shows in place of their own code, for staff (#1814):
 * the booking's pool code while the window is open, or when it opens. Claims
 * but does not reveal — a staff look is not a member being shown it.
 */
export async function fallbackShownFor(
	row: FallbackRow & { id: string }
): Promise<{ code: string | null; showsFrom: Date | null } | null> {
	if (row.status !== 'confirmed' || row.lockSyncedAt) return null;
	if (fallbackApplies(row)) {
		const claimed = await claimPoolCode(row.id);
		return { code: claimed?.code ?? null, showsFrom: null };
	}
	const showsFrom = new Date(row.startsAt.getTime() - graceMs());
	return showsFrom.getTime() > Date.now() ? { code: null, showsFrom } : null;
}

/**
 * The booking's pool code, or null, when it is confirmed, inside the access
 * window, and its own code is not on the device. Every page that shows a door
 * code calls this on load (#780); the stamp on the booking stays the record
 * that it fell back.
 */
export async function revealFallbackCodeFor(row: {
	id: string;
	status: string;
	startsAt: Date;
	endsAt: Date;
	lockSyncedAt: Date | null;
}): Promise<string | null> {
	if (!fallbackApplies(row)) return null;

	const code = await revealPoolCode(row.id);
	if (!code) return null;

	await db
		.update(reservation)
		.set({ lockFallbackRevealedAt: new Date() })
		.where(eq(reservation.id, row.id));

	return code.code;
}

// ---------------------------------------------------------------------------
// Key Holders
// ---------------------------------------------------------------------------

export interface PoolCodeRow {
	id: string;
	code: string;
	state: 'pending' | 'available' | 'claimed' | 'awaiting_removal' | 'removed';
	legacy: boolean;
	reservationId: string | null;
	bookingStartsAt: Date | null;
	bookingEndsAt: Date | null;
	claimedAt: Date | null;
	revealedAt: Date | null;
	removedAt: Date | null;
}

/** Every code the pool accounts for, plus those removed in the last week. */
export async function listPoolCodes(now: Date = new Date()): Promise<PoolCodeRow[]> {
	const rows = await db
		.select({
			code: lockFallbackCode,
			startsAt: reservation.startsAt,
			endsAt: reservation.endsAt,
			status: reservation.status
		})
		.from(lockFallbackCode)
		.leftJoin(reservation, eq(reservation.id, lockFallbackCode.claimedByReservationId))
		.where(isNull(lockFallbackCode.retiredAt))
		.orderBy(asc(lockFallbackCode.createdAt), asc(lockFallbackCode.id));

	const over = (endsAt: Date | null, status: string | null) =>
		status === 'cancelled' || !endsAt || endsAt.getTime() + graceMs() < now.getTime();

	return rows
		.map(({ code: c, startsAt, endsAt, status }) => {
			let state: PoolCodeRow['state'];
			if (c.removedAt) state = 'removed';
			else if (!c.pooled || (c.revealedAt && over(endsAt, status))) state = 'awaiting_removal';
			else if (c.claimedByReservationId || c.revealedAt) state = 'claimed';
			else state = c.syncedAt ? 'available' : 'pending';
			return {
				id: c.id,
				code: c.code,
				state,
				legacy: !c.pooled,
				reservationId: c.claimedByReservationId,
				bookingStartsAt: startsAt,
				bookingEndsAt: endsAt,
				claimedAt: c.claimedAt,
				revealedAt: c.revealedAt,
				removedAt: c.removedAt
			};
		})
		.filter(
			(r) =>
				r.state !== 'removed' ||
				(r.removedAt && now.getTime() - r.removedAt.getTime() < 7 * 86_400_000)
		);
}
