import { db } from '$lib/server/db';
import { lockFallbackCode, reservation } from '$lib/server/db/schema/reservation';
import { and, desc, eq, isNull, isNotNull } from 'drizzle-orm';
import {
	addLockUser,
	getLockUser,
	removeTemporaryUser,
	generateLockCode,
	LOCK_GRACE_MINUTES
} from './ultraloc-client';
import type { LockFallbackCode } from '$lib/server/db/schema/reservation';

// ---------------------------------------------------------------------------
// The break-glass door code
// ---------------------------------------------------------------------------
// The lock enforces access locally — only *changes* need connectivity. So a
// code that reached the lock last month still opens the door during an outage
// today, which is exactly when a member's freshly-issued reservation code does
// not. One such code is kept alive for that case.
//
// It is a type-0 (normal) lock user: no lock-side expiry, because an expiry is
// a change the lock would have to be online to learn about.
// ---------------------------------------------------------------------------

/** How long a break-glass code stays in service before a successor is minted. */
export const FALLBACK_ROTATION_DAYS = 30;

const FALLBACK_NAME_PREFIX = 'CMC Fallback';

/** The code currently known to be on the lock, or null if there isn't one yet. */
export async function getActiveFallbackCode(): Promise<LockFallbackCode | null> {
	const [row] = await db
		.select()
		.from(lockFallbackCode)
		.where(and(isNotNull(lockFallbackCode.syncedAt), isNull(lockFallbackCode.retiredAt)))
		.orderBy(desc(lockFallbackCode.syncedAt))
		.limit(1);

	return row ?? null;
}

/** A minted successor that has not yet been confirmed on the lock. */
async function getPendingFallbackCode(): Promise<LockFallbackCode | null> {
	const [row] = await db
		.select()
		.from(lockFallbackCode)
		.where(and(isNull(lockFallbackCode.syncedAt), isNull(lockFallbackCode.retiredAt)))
		.orderBy(desc(lockFallbackCode.createdAt))
		.limit(1);

	return row ?? null;
}

/**
 * Keep exactly one confirmed break-glass code in service.
 *
 * Run from the daily job. Three things, in this order:
 *
 * 1. A pending successor that the lock now reports as synced becomes active,
 *    and only *then* is the code it replaces retired and deleted. Retiring
 *    first would leave a window with no working break-glass code.
 * 2. Mint a successor when there is no active code at all, or the active one is
 *    older than the rotation period.
 * 3. Nothing, if the incumbent is current and no successor is outstanding.
 */
export async function maintainFallbackCode(errors: string[]): Promise<{
	active: string | null;
	rotated: boolean;
}> {
	let rotated = false;

	try {
		const pending = await getPendingFallbackCode();

		if (pending?.lockAccessId) {
			const detail = await getLockUser(Number(pending.lockAccessId));
			if (detail?.syncStatus === 1) {
				await promotePendingCode(pending, errors);
				rotated = true;
			}
		} else if (pending) {
			// The add went through but the id was never recovered; the row is
			// unusable as a handle, so drop it and mint again below.
			await db.delete(lockFallbackCode).where(eq(lockFallbackCode.id, pending.id));
		}

		const active = await getActiveFallbackCode();

		if (!active || isDueForRotation(active)) {
			// Only mint if nothing is already in flight, or every run during an
			// outage would add another unusable user to the lock.
			const stillPending = await getPendingFallbackCode();
			if (!stillPending) await mintFallbackCode(errors);
		}

		return { active: (await getActiveFallbackCode())?.code ?? null, rotated };
	} catch (err) {
		const msg = `Failed to maintain the break-glass code: ${(err as Error).message}`;
		console.error(msg);
		errors.push(msg);
		return { active: null, rotated };
	}
}

function isDueForRotation(active: LockFallbackCode): boolean {
	const age = Date.now() - (active.syncedAt?.getTime() ?? 0);
	return age > FALLBACK_ROTATION_DAYS * 24 * 60 * 60_000;
}

/** Mark a confirmed successor active and remove whatever it replaces. */
async function promotePendingCode(pending: LockFallbackCode, errors: string[]): Promise<void> {
	const now = new Date();
	const outgoing = await getActiveFallbackCode();

	await db
		.update(lockFallbackCode)
		.set({ syncedAt: now })
		.where(eq(lockFallbackCode.id, pending.id));

	if (!outgoing) return;

	// The successor is live before the incumbent goes, so there is never a gap.
	await db
		.update(lockFallbackCode)
		.set({ retiredAt: now })
		.where(eq(lockFallbackCode.id, outgoing.id));

	if (!outgoing.lockAccessId) return;

	try {
		await removeTemporaryUser(Number(outgoing.lockAccessId));
	} catch (err) {
		const msg = `Failed to remove the retired break-glass code from the lock: ${(err as Error).message}`;
		console.error(msg);
		errors.push(msg);
	}
}

/** Add a new type-0 lock user and record it as the pending successor. */
async function mintFallbackCode(errors: string[]): Promise<void> {
	// 8 digits: this one is handed out by hand in an emergency and is worth
	// making harder to guess than a 4-digit reservation code.
	const code = generateLockCode() * 10_000 + generateLockCode();
	const name = `${FALLBACK_NAME_PREFIX} ${new Date().toISOString().slice(0, 10)}`;

	try {
		const lockAccessId = await addLockUser({ name, type: 0, password: code });

		await db.insert(lockFallbackCode).values({
			code: String(code),
			lockAccessId: lockAccessId === null ? null : String(lockAccessId)
		});
	} catch (err) {
		const msg = `Failed to mint a break-glass code: ${(err as Error).message}`;
		console.error(msg);
		errors.push(msg);
	}
}

/**
 * Mint a successor now, rather than waiting for the rotation to come due.
 *
 * The incumbent stays live and is only retired once the lock confirms the
 * successor, exactly as in the scheduled path — so this is safe to press during
 * an outage, it simply will not take effect until the lock is back.
 */
export async function rotateFallbackCodeNow(): Promise<{ ok: boolean; error?: string }> {
	const errors: string[] = [];
	const pending = await getPendingFallbackCode();

	if (pending) {
		return {
			ok: false,
			error: 'A replacement code is already waiting for the lock to confirm it.'
		};
	}

	await mintFallbackCode(errors);

	return errors.length ? { ok: false, error: errors[0] } : { ok: true };
}

// ---------------------------------------------------------------------------
// Reveal
// ---------------------------------------------------------------------------

/**
 * Whether this member should be shown the break-glass code, and what it is.
 *
 * Deliberately narrow. All three have to hold:
 *
 * - the reservation is confirmed;
 * - now is inside the access window, with the same grace the lock itself gives;
 * - their own code is not confirmed on the device.
 *
 * A member whose code is known good never sees this, and neither does one whose
 * booking is next week. Revealing stamps `lockFallbackRevealedAt`, which is the
 * record of who was given it.
 */
export async function revealFallbackCodeFor(row: {
	id: string;
	status: string;
	startsAt: Date;
	endsAt: Date;
	lockSyncedAt: Date | null;
}): Promise<string | null> {
	if (row.status !== 'confirmed') return null;
	if (row.lockSyncedAt) return null;

	const now = Date.now();
	const graceMs = LOCK_GRACE_MINUTES * 60_000;
	if (now < row.startsAt.getTime() - graceMs) return null;
	if (now > row.endsAt.getTime() + graceMs) return null;

	const active = await getActiveFallbackCode();
	if (!active) return null;

	await db
		.update(reservation)
		.set({ lockFallbackRevealedAt: new Date() })
		.where(eq(reservation.id, row.id));

	return active.code;
}
