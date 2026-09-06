import { db } from '$lib/server/db';
import { reservation } from '$lib/server/db/schema/reservation';
import { user } from '$lib/server/db/schema/authentication';
import { and, eq, isNull, isNotNull, gte, lt } from 'drizzle-orm';
import { buildDateInTz } from '$lib/server/reservation/timezone';
import {
	createTemporaryUser,
	removeTemporaryUser,
	updateLockUser,
	listLockUsers,
	getLockUser,
	queryDeviceHealth,
	generateLockCode,
	lockDateTime,
	LOCK_GRACE_MINUTES,
	type LockDeviceHealth
} from './ultraloc-client';
import { maintainFallbackCode } from './fallback-code-service';
import { hasActiveMemberCode, reconcileMemberCodeSync } from './member-code-service';
import { getJson, putJson } from '$lib/server/kv';
import { dispatchEmailOnly } from '$lib/server/notification';
import { env } from '$env/dynamic/private';
import { DEFAULT_TIMEZONE, CONFIRMATION_WINDOW_DAYS } from '$lib/config';

// ---------------------------------------------------------------------------
// LockService — provision and clean up Ultraloc temporary users
// ---------------------------------------------------------------------------

/**
 * KV key holding the last health reading, so alerts are edge-triggered.
 *
 * KV rather than site-config: this is a cached observation, not a setting, and
 * `getConfigsByPrefix('integration.utec')` backs the credentials form — a
 * health reading has no business appearing there. Sits beside `ultraloc:token`.
 */
const LAST_ONLINE_KEY = 'ultraloc:lastSeenOnline';

/**
 * Run the daily lock job: check the lock is reachable, clean up yesterday's
 * access, provision today's, then confirm which codes have actually landed.
 *
 * An offline lock is reported but does not stop the run. Writes are queued in
 * U-tec's cloud and pushed down when the lock reconnects, so provisioning into
 * an outage is still worth doing — it is only the *promise* that a code works
 * that has to wait for `reconcileSyncState`.
 */
export async function runDailyLockJob(): Promise<{
	provisioned: number;
	cleaned: number;
	confirmed: number;
	online: boolean | null;
	/** Whether a break-glass code is confirmed on the lock right now. */
	fallbackActive: boolean;
	errors: string[];
}> {
	const errors: string[] = [];

	const online = await checkDeviceHealth(errors);
	const cleaned = await cleanupPreviousDayAccess(errors);
	const provisioned = await provisionDailyAccess(errors);
	const confirmed = (await reconcileSyncState(errors)) + (await reconcileMemberCodeSync(errors));
	const fallback = await maintainFallbackCode(errors);

	return {
		provisioned,
		cleaned,
		confirmed,
		online,
		fallbackActive: fallback.active !== null,
		errors
	};
}

/**
 * Read the lock's health and tell staff when it goes offline.
 *
 * Edge-triggered against the last reading in site-config: a week-long outage
 * should be one email, not seven identical ones. Returns null when the health
 * check itself failed, which is not the same as the lock being offline.
 */
async function checkDeviceHealth(errors: string[]): Promise<boolean | null> {
	let health: Awaited<ReturnType<typeof queryDeviceHealth>>;
	try {
		health = await queryDeviceHealth();
	} catch (err) {
		const msg = `Failed to read lock health: ${(err as Error).message}`;
		console.error(msg);
		errors.push(msg);
		return null;
	}

	// Absent means we have never looked; treat that as "was online" so the first
	// run during an outage still alerts.
	const previous = (await getJson<boolean>(LAST_ONLINE_KEY)) ?? true;
	await putJson(LAST_ONLINE_KEY, health.online);

	if (!health.online) {
		errors.push(
			'Lock is offline — door codes are queued but will not reach it until it reconnects'
		);
		if (previous) await notifyStaffLockOffline(health);
	}

	return health.online;
}

async function notifyStaffLockOffline(health: LockDeviceHealth): Promise<void> {
	try {
		await dispatchEmailOnly({
			type: 'lock_offline',
			toEmail: env.STAFF_CONTACT_EMAIL ?? 'staff@corvmc.org',
			templateAlias: 'notification',
			model: {
				subject: 'The practice space lock is offline',
				heading: 'Door lock unreachable',
				paragraphs: [
					{
						text: 'U-tec reports the lock as offline. Door codes are still being issued, but they are queued in U-tec’s cloud and will not open the door until the lock reconnects. Members with a booking today may not be able to get in.'
					},
					{ text: 'Most often this is the building’s internet rather than the lock itself.' }
				],
				details: [
					{ label: 'Lock state (last known)', value: health.lockState ?? 'unknown' },
					{
						label: 'Battery (last known)',
						value: health.batteryLevel === null ? 'unknown' : `${health.batteryLevel} of 5`
					}
				],
				cta: {
					url: `${env.PUBLIC_SITE_URL ?? 'https://corvmc.org'}/staff/settings`,
					label: 'Open lock settings'
				}
			}
		});
	} catch (err) {
		// An alert that cannot be sent must not take the job down with it.
		console.error(`Failed to send lock-offline alert: ${(err as Error).message}`);
	}
}

/**
 * Promote issued codes to "known good".
 *
 * U-tec accepts every write into a cloud queue and acks it identically whether
 * the lock is reachable or not, so an `add` succeeding says nothing. Only
 * `sync_status` on the user itself says the code is on the device — that is
 * what `lockSyncedAt` records, and what the member-facing surfaces key on.
 */
async function reconcileSyncState(errors: string[]): Promise<number> {
	let count = 0;

	const rows = await db
		.select({ id: reservation.id, lockAccessId: reservation.lockAccessId })
		.from(reservation)
		.where(
			and(
				eq(reservation.status, 'confirmed'),
				isNotNull(reservation.lockAccessId),
				isNull(reservation.lockSyncedAt)
			)
		);

	for (const row of rows) {
		try {
			const detail = await getLockUser(Number(row.lockAccessId));
			if (detail?.syncStatus !== 1) continue;

			await db
				.update(reservation)
				.set({ lockSyncedAt: new Date(), updatedAt: new Date() })
				.where(eq(reservation.id, row.id));
			count++;
		} catch (err) {
			const msg = `Failed to confirm lock sync for reservation ${row.id}: ${(err as Error).message}`;
			console.error(msg);
			errors.push(msg);
		}
	}

	return count;
}

/**
 * Create Ultraloc temporary users for confirmed reservations starting inside
 * the confirmation window that don't already have lock access.
 *
 * The window used to be a single day, which left no slack at all: the job runs
 * once each morning, so a lock that was offline then meant a member with a
 * booking that evening had a code queued in U-tec's cloud and no way in. Over
 * `CONFIRMATION_WINDOW_DAYS` the queue has days to drain instead of hours, and
 * the two numbers stop being independently chosen.
 *
 * The probe that prompted this measured 22 users on the lock, only four of them
 * temporary, so a three-day window is nowhere near the device's ceiling —
 * especially now a member holding a standing code is skipped entirely.
 */
async function provisionDailyAccess(errors: string[]): Promise<number> {
	const tz = DEFAULT_TIMEZONE;
	const now = new Date();
	const todayStr = now.toLocaleDateString('en-CA', { timeZone: tz });

	const dayStart = buildDateInTz(todayStr, '00:00', tz);
	const windowEnd = new Date(
		buildDateInTz(todayStr, '23:59', tz).getTime() + CONFIRMATION_WINDOW_DAYS * 24 * 60 * 60 * 1000
	);

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
				lt(reservation.startsAt, windowEnd)
			)
		);

	let count = 0;

	for (const row of rows) {
		try {
			// A member with a standing door code can already get in. Issuing a
			// second code per booking would only consume the lock's finite user
			// table for no gain.
			if (await hasActiveMemberCode(row.createdByUserId)) continue;

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

/**
 * Re-issue door access for one booking on demand.
 *
 * The staff lever for a booking the daily job could not provision — otherwise
 * the only recourse is waiting for tomorrow's run. Errors are returned rather
 * than thrown so the page can say what went wrong.
 */
export async function reprovisionAccessFor(row: {
	id: string;
	startsAt: Date;
	endsAt: Date;
	memberName: string;
	code?: number;
}): Promise<{ ok: boolean; code?: number; error?: string }> {
	try {
		const code = await provisionAccessFor(row);
		return { ok: true, code };
	} catch (err) {
		return { ok: false, error: (err as Error).message };
	}
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

	const lockAccessId = await createTemporaryUser({
		name: row.memberName,
		startTime: row.startsAt,
		endTime: row.endsAt,
		code
	});

	// lockSyncedAt stays null: the add is queued in U-tec's cloud and only
	// reaches the lock when the lock is next online. The reconciliation pass is
	// what promotes it to "known good".
	await db
		.update(reservation)
		.set({
			lockCode: String(code),
			lockAccessId: lockAccessId === null ? null : String(lockAccessId),
			lockSyncedAt: null,
			updatedAt: new Date()
		})
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
 *   push a show later and the code stops working at the old end time. Re-point
 *   that user at the new window, keeping the **same code** — staff have already
 *   been told what it is.
 *
 * When `lockAccessId` is known the re-point is a single `update`, which leaves
 * the member's code untouched on the lock. Rows provisioned before the id was
 * recorded fall back to deleting the old user and re-adding it.
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
			lockAccessId: reservation.lockAccessId,
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
	// Preferred path: re-point the existing lock user in place. The member keeps
	// the same code and we never have a moment with no user on the lock.
	if (row.lockAccessId) {
		try {
			const graceEnd = new Date(row.endsAt.getTime() + LOCK_GRACE_MINUTES * 60_000);
			await updateLockUser(Number(row.lockAccessId), {
				daterange: [lockDateTime(row.startsAt), lockDateTime(graceEnd)]
			});
			await db
				.update(reservation)
				.set({ lockSyncedAt: null, updatedAt: new Date() })
				.where(eq(reservation.id, row.id));
			return { synced: true, errors };
		} catch (err) {
			// Fall through to delete-and-re-add rather than leaving the member
			// pointed at the old window.
			const msg = `Failed to re-point lock access for reservation ${row.id}: ${(err as Error).message}`;
			console.error(msg);
			errors.push(msg);
		}
	}

	// Legacy rows have no id, so the old user has to be found by its window.
	try {
		const previousStart = lockDateTime(previousStartsAt);

		for (const u of await listLockUsers()) {
			if (u.type !== 2) continue;
			const detail = await getLockUser(u.id);
			if (detail?.daterange?.[0] !== previousStart) continue;
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
 *
 * The window has to come from `getLockUser`, not from the list row: `list`
 * returns only `{id, name, type, status, sync_status}`. Filtering the list rows
 * on `daterange` — which is what this did until #637 — skipped every user, so
 * nothing was ever deleted and temporary users from months earlier were still
 * on the lock.
 *
 * Only type-2 users are touched. Type-0 users are members' persistent door
 * codes, granted by hand, and deleting one locks a real person out.
 */
async function cleanupPreviousDayAccess(errors: string[]): Promise<number> {
	const tz = DEFAULT_TIMEZONE;
	const now = new Date();

	let count = 0;

	// --- Lock side: delete expired temporary users ---------------------------
	try {
		const users = await listLockUsers();

		for (const u of users) {
			if (u.type !== 2) continue;

			try {
				const detail = await getLockUser(u.id);
				if (!detail?.daterange) continue;

				const [datePart, timePart] = detail.daterange[1].split(' ');
				const end = buildDateInTz(datePart, timePart, tz);
				if (end >= now) continue;

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

	// --- DB hygiene: clear codes on reservations that have been and gone ------
	// Anything before today, not yesterday specifically. The one-day window meant
	// a code the job missed once — because the lock was unreachable that morning
	// — was never cleared again, and it is the wrong shape now that provisioning
	// looks days ahead rather than one.
	try {
		const todayStr = now.toLocaleDateString('en-CA', { timeZone: tz });
		const todayStart = buildDateInTz(todayStr, '00:00', tz);

		await db
			.update(reservation)
			.set({
				lockCode: null,
				lockAccessId: null,
				lockSyncedAt: null,
				updatedAt: new Date()
			})
			.where(and(isNotNull(reservation.lockCode), lt(reservation.startsAt, todayStart)));
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

/** How long a self-test code stays usable. The lock enforces this itself. */
const SELF_TEST_MINUTES = 15;

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
 * A type-2 temporary user with a real 15-minute window, which is what a
 * reservation gets — the thing actually worth testing. It used to create a
 * type-0 user with no expiry, on the since-disproven suspicion that the
 * schedule fields were what U-tec rejected, so a self-test left a permanent
 * working door code behind unless somebody clicked Revoke.
 *
 * Steps are captured rather than thrown so partial failures still report.
 */
export async function issueLockSelfTest(): Promise<LockSelfTestResult> {
	const steps: LockSelfTestStep[] = [];
	const code = generateLockCode();

	const now = new Date();
	const expiresAt = new Date(now.getTime() + SELF_TEST_MINUTES * 60_000);

	try {
		await createTemporaryUser({
			name: SELF_TEST_NAME,
			startTime: now,
			endTime: expiresAt,
			code
		});
		steps.push({
			name: 'create',
			ok: true,
			detail: `Issued a ${SELF_TEST_MINUTES}-minute test code on the lock.`
		});
	} catch (err) {
		steps.push({ name: 'create', ok: false, detail: (err as Error).message });
		return { ok: false, code, expiresAt, steps };
	}

	try {
		const users = await listLockUsers();
		steps.push({ name: 'list', ok: true, detail: `Lock returned ${users.length} user(s).` });
	} catch (err) {
		steps.push({ name: 'list', ok: false, detail: (err as Error).message });
		return { ok: false, code, expiresAt, steps };
	}

	return { ok: true, code, expiresAt, steps };
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
