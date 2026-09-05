import { db } from '$lib/server/db';
import { reservation } from '$lib/server/db/schema/reservation';
import { user } from '$lib/server/db/schema/authentication';
import { and, eq, isNull, isNotNull, gte, lt } from 'drizzle-orm';
import { buildDateInTz } from '$lib/server/reservation/timezone';
import {
	createTemporaryUser,
	addLockUser,
	removeTemporaryUser,
	listLockUsers,
	generateLockCode,
	lockDateTime
} from './ultraloc-client';
import { DEFAULT_TIMEZONE } from '$lib/config';

// ---------------------------------------------------------------------------
// LockService — provision and clean up Ultraloc temporary users
// ---------------------------------------------------------------------------

/**
 * Run the daily lock job: clean up yesterday's access, then provision today's.
 */
export async function runDailyLockJob(): Promise<{
	provisioned: number;
	cleaned: number;
	errors: string[];
}> {
	const errors: string[] = [];

	const cleaned = await cleanupPreviousDayAccess(errors);
	const provisioned = await provisionDailyAccess(errors);

	return { provisioned, cleaned, errors };
}

/**
 * Create Ultraloc temporary users for all confirmed reservations today
 * that don't already have lock access.
 */
async function provisionDailyAccess(errors: string[]): Promise<number> {
	const tz = DEFAULT_TIMEZONE;
	const now = new Date();
	const todayStr = now.toLocaleDateString('en-CA', { timeZone: tz });

	// Day boundaries in UTC
	const dayStart = buildDateInTz(todayStr, '00:00', tz);
	const dayEnd = buildDateInTz(todayStr, '23:59', tz);

	const rows = await db
		.select({
			id: reservation.id,
			startsAt: reservation.startsAt,
			endsAt: reservation.endsAt,
			createdByUserId: reservation.createdByUserId,
			memberName: user.name
		})
		.from(reservation)
		.innerJoin(user, eq(reservation.createdByUserId, user.id))
		.where(
			and(
				eq(reservation.status, 'confirmed'),
				isNull(reservation.lockCode),
				gte(reservation.startsAt, dayStart),
				lt(reservation.startsAt, dayEnd)
			)
		);

	let count = 0;

	for (const row of rows) {
		try {
			await provisionAccessFor(row);
			count++;
		} catch (err) {
			const msg = `Failed to provision lock access for reservation ${row.id}: ${(err as Error).message}`;
			console.error(msg);
			errors.push(msg);
		}
	}

	return count;
}

/** One reservation's worth of provisioning: mint a code, open the window, record it. */
async function provisionAccessFor(row: {
	id: string;
	startsAt: Date;
	endsAt: Date;
	memberName: string;
	code?: number;
}): Promise<number> {
	const code = row.code ?? generateLockCode();

	await createTemporaryUser({
		name: row.memberName,
		startTime: row.startsAt,
		endTime: row.endsAt,
		code
	});

	await db
		.update(reservation)
		.set({ lockCode: String(code), updatedAt: new Date() })
		.where(eq(reservation.id, row.id));

	return code;
}

// ---------------------------------------------------------------------------
// syncAccessWindow — follow a booking that moved
// ---------------------------------------------------------------------------

/**
 * Re-point the lock at a reservation whose window has changed.
 *
 * Two cases, and the daily cron covers neither:
 *
 * - **No code yet, and the booking now starts today.** `provisionDailyAccess`
 *   runs once, in the morning. A show re-timed — or moved onto today — after
 *   that has already been passed over, so mint here or nobody gets in.
 * - **A code already issued, and the window moved.** The lock enforces access
 *   through the temporary user's `daterange`, which still pins the old window:
 *   push a show later and the code stops working at the old end time. Delete
 *   that user and re-add it against the new window, keeping the **same code** —
 *   staff have already been told what it is.
 *
 * Matching the lock user by its `daterange` start is what `cleanupPreviousDayAccess`
 * already does. `createTemporaryUser` resolves on a deferred ack that carries no
 * user id, which is why `reservation.lockAccessId` has never been written and
 * cannot be used as the handle here.
 *
 * Errors are collected, not thrown: a lock outage must not fail the booking
 * change that prompted it.
 */
export async function syncAccessWindow(
	reservationId: string,
	previousStartsAt: Date,
	previousEndsAt: Date
): Promise<{ synced: boolean; errors: string[] }> {
	const errors: string[] = [];
	const tz = DEFAULT_TIMEZONE;

	const [row] = await db
		.select({
			id: reservation.id,
			status: reservation.status,
			startsAt: reservation.startsAt,
			endsAt: reservation.endsAt,
			lockCode: reservation.lockCode,
			memberName: user.name
		})
		.from(reservation)
		.innerJoin(user, eq(reservation.createdByUserId, user.id))
		.where(eq(reservation.id, reservationId))
		.limit(1);

	if (!row || row.status !== 'confirmed') return { synced: false, errors };

	const unmoved =
		row.startsAt.getTime() === previousStartsAt.getTime() &&
		row.endsAt.getTime() === previousEndsAt.getTime();

	// --- Nothing provisioned yet -------------------------------------------
	if (!row.lockCode) {
		const now = new Date();
		const todayStr = now.toLocaleDateString('en-CA', { timeZone: tz });
		const startsToday =
			row.startsAt >= buildDateInTz(todayStr, '00:00', tz) &&
			row.startsAt < buildDateInTz(todayStr, '23:59', tz);

		// Tomorrow's cron will pick it up; only today's has already gone past.
		if (!startsToday) return { synced: false, errors };

		try {
			await provisionAccessFor(row);
			return { synced: true, errors };
		} catch (err) {
			const msg = `Failed to provision lock access for reservation ${row.id}: ${(err as Error).message}`;
			console.error(msg);
			errors.push(msg);
			return { synced: false, errors };
		}
	}

	if (unmoved) return { synced: false, errors };

	// --- A code is live against the old window ------------------------------
	try {
		const users = await listLockUsers();
		const previousStart = lockDateTime(previousStartsAt);

		for (const u of users) {
			if (u.type !== 2 || !u.daterange) continue;
			if (u.daterange[0] !== previousStart) continue;
			await removeTemporaryUser(u.id);
		}
	} catch (err) {
		// Fall through and re-add anyway: a duplicate window on the lock is
		// recoverable by the daily cleanup, a member locked out is not.
		const msg = `Failed to remove stale lock access for reservation ${row.id}: ${(err as Error).message}`;
		console.error(msg);
		errors.push(msg);
	}

	try {
		await provisionAccessFor({ ...row, code: Number(row.lockCode) });
		return { synced: true, errors };
	} catch (err) {
		const msg = `Failed to re-provision lock access for reservation ${row.id}: ${(err as Error).message}`;
		console.error(msg);
		errors.push(msg);
		return { synced: false, errors };
	}
}

/**
 * Remove expired temporary lock users and clear stale door codes.
 *
 * The lock enforces access via each temporary user's daterange, so we delete
 * any temporary user (type 2) whose window has fully passed, then null out the
 * door code on yesterday's reservations for DB hygiene. The two steps are
 * independent — a failure in one does not block the other.
 */
async function cleanupPreviousDayAccess(errors: string[]): Promise<number> {
	const tz = DEFAULT_TIMEZONE;
	const now = new Date();

	let count = 0;

	// --- Lock side: delete expired temporary users ---------------------------
	try {
		const users = await listLockUsers();

		for (const u of users) {
			if (u.type !== 2 || !u.daterange) continue;

			const [datePart, timePart] = u.daterange[1].split(' ');
			const end = buildDateInTz(datePart, timePart, tz);
			if (end >= now) continue;

			try {
				await removeTemporaryUser(u.id);
				count++;
			} catch (err) {
				const msg = `Failed to remove expired lock user ${u.id}: ${(err as Error).message}`;
				console.error(msg);
				errors.push(msg);
			}
		}
	} catch (err) {
		const msg = `Failed to list lock users for cleanup: ${(err as Error).message}`;
		console.error(msg);
		errors.push(msg);
	}

	// --- DB hygiene: clear codes on yesterday's reservations -----------------
	try {
		const yesterday = new Date(now);
		yesterday.setDate(yesterday.getDate() - 1);
		const yesterdayStr = yesterday.toLocaleDateString('en-CA', { timeZone: tz });

		const dayStart = buildDateInTz(yesterdayStr, '00:00', tz);
		const dayEnd = buildDateInTz(yesterdayStr, '23:59', tz);

		await db
			.update(reservation)
			.set({ lockCode: null, updatedAt: new Date() })
			.where(
				and(
					isNotNull(reservation.lockCode),
					gte(reservation.startsAt, dayStart),
					lt(reservation.startsAt, dayEnd)
				)
			);
	} catch (err) {
		const msg = `Failed to clear stale door codes: ${(err as Error).message}`;
		console.error(msg);
		errors.push(msg);
	}

	return count;
}

// ---------------------------------------------------------------------------
// One-click self-test — exercise the real st.lockUser command path end to end
// (create → list), beyond the token-only "Test Connection". Issues a temporary
// code valid for a short window so staff can physically try the door.
// ---------------------------------------------------------------------------

const SELF_TEST_NAME = 'CMC Self-Test';

export interface LockSelfTestStep {
	name: 'create' | 'list';
	ok: boolean;
	detail: string;
}

export interface LockSelfTestResult {
	ok: boolean;
	code?: number;
	/** When the issued code stops working (window + the client's grace period). */
	expiresAt?: Date;
	steps: LockSelfTestStep[];
}

/**
 * Issue a short-lived test code and verify the lock command path works.
 *
 * `add` returns a deferred ack (no id) and the lock applies it asynchronously,
 * so the new user may not appear in the immediate `list`. We therefore assert
 * each command returns without an API error rather than requiring the new user
 * to be listed. Each step is captured (not thrown) so partial failures report.
 */
export async function issueLockSelfTest(): Promise<LockSelfTestResult> {
	const steps: LockSelfTestStep[] = [];
	const code = generateLockCode();

	// Use the proven-working normal-user (type 0) `add` to validate the command
	// path end to end. A normal user has no lock-side expiry, so the code stays
	// active until "Revoke test codes" is clicked (or the daily cleanup removes
	// it). This isolates the integration plumbing from the temporary-user schedule
	// fields that U-tec has been rejecting with BAD-REQUEST.
	try {
		await addLockUser({ name: SELF_TEST_NAME, type: 0, password: code });
		steps.push({
			name: 'create',
			ok: true,
			detail: 'Issued test code on the lock. It stays active until you click "Revoke test codes".'
		});
	} catch (err) {
		steps.push({ name: 'create', ok: false, detail: (err as Error).message });
		return { ok: false, code, steps };
	}

	try {
		const users = await listLockUsers();
		steps.push({ name: 'list', ok: true, detail: `Lock returned ${users.length} user(s).` });
	} catch (err) {
		steps.push({ name: 'list', ok: false, detail: (err as Error).message });
		return { ok: false, code, steps };
	}

	return { ok: true, code, steps };
}

/** Remove any lingering self-test users from the lock. */
export async function revokeLockSelfTest(): Promise<{ removed: number; errors: string[] }> {
	const errors: string[] = [];
	let removed = 0;

	const users = await listLockUsers();
	for (const u of users) {
		// Match by name only — the self-test now issues a normal (type 0) user.
		if (u.name !== SELF_TEST_NAME) continue;
		try {
			await removeTemporaryUser(u.id);
			removed++;
		} catch (err) {
			errors.push(`Failed to remove self-test user ${u.id}: ${(err as Error).message}`);
		}
	}

	return { removed, errors };
}
