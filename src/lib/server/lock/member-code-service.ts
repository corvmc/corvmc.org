import { db } from '$lib/server/db';
import { lockMemberCode, lockFallbackCode } from '$lib/server/db/schema/reservation';
import { user } from '$lib/server/db/schema/authentication';
import { and, eq, isNull } from 'drizzle-orm';
import {
	addLockUser,
	getLockUser,
	listLockUsers,
	removeTemporaryUser,
	generateLockCode
} from './ultraloc-client';
import type { LockMemberCode } from '$lib/server/db/schema/reservation';

// ---------------------------------------------------------------------------
// Persistent member door codes
// ---------------------------------------------------------------------------
// Standing codes are type-0 lock users: no lock-side expiry, so they keep
// working through an outage and keep working after someone leaves. Seventeen
// of them existed only inside the U-tec app before this table.
//
// Nothing here ever deletes a lock user the app did not grant. Reconciliation
// *surfaces* unknown codes for staff to adopt or revoke; a wrong guess locks a
// real person out of their band practice, which is not a mistake worth
// automating.
// ---------------------------------------------------------------------------

/** The self-test's own user, which is not a member code. */
const SELF_TEST_NAME = 'CMC Self-Test';
const FALLBACK_NAME_PREFIX = 'CMC Fallback';

export interface UnmanagedLockUser {
	lockAccessId: number;
	label: string;
	/** Whether the lock has this user, as opposed to it still being queued. */
	synced: boolean;
}

/**
 * Type-0 lock users that no `lockMemberCode` row claims.
 *
 * The app's own service users are filtered out by name — the break-glass code
 * and the self-test are both type 0 and neither is somebody's door code.
 */
export async function listUnmanagedLockUsers(): Promise<UnmanagedLockUser[]> {
	const [users, claimed, fallbacks] = await Promise.all([
		listLockUsers(),
		db.select({ lockAccessId: lockMemberCode.lockAccessId }).from(lockMemberCode),
		db.select({ lockAccessId: lockFallbackCode.lockAccessId }).from(lockFallbackCode)
	]);

	const known = new Set([
		...claimed.map((row) => row.lockAccessId),
		...fallbacks.map((row) => row.lockAccessId).filter((id): id is string => id !== null)
	]);

	return users
		.filter((u) => u.type === 0)
		.filter((u) => !known.has(String(u.id)))
		.filter((u) => u.name !== SELF_TEST_NAME && !u.name.startsWith(FALLBACK_NAME_PREFIX))
		.map((u) => ({ lockAccessId: u.id, label: u.name, synced: u.syncStatus === 1 }));
}

/**
 * Record an existing lock user as a managed member code.
 *
 * This is how the seventeen hand-made codes come under management: staff match
 * one to a member (or leave `userId` null when they cannot yet say whose it is)
 * and the row starts claiming it. Nothing on the lock changes.
 */
export async function adoptLockUser(params: {
	lockAccessId: number;
	label: string;
	userId?: string | null;
}): Promise<void> {
	const detail = await getLockUser(params.lockAccessId);

	await db.insert(lockMemberCode).values({
		userId: params.userId ?? null,
		lockAccessId: String(params.lockAccessId),
		// Read the code back off the lock so staff can tell the member what it is
		// without resetting it — `get` returns the password.
		code: detail?.password ?? null,
		label: params.label,
		adoptedAt: new Date(),
		// Already on the lock, by definition — it was found there.
		syncedAt: detail?.syncStatus === 1 ? new Date() : null
	});
}

/** Grant a member a standing door code. */
export async function grantMemberCode(params: {
	userId: string;
	memberName: string;
	grantedByStaffId: string;
}): Promise<{ code: number; lockAccessId: number | null }> {
	const code = generateLockCode() * 10_000 + generateLockCode();

	const lockAccessId = await addLockUser({
		name: params.memberName,
		type: 0,
		password: code
	});

	if (lockAccessId === null) {
		// Without an id there is no handle to revoke by, and a standing code that
		// cannot be revoked is worse than none.
		throw new Error(
			'The lock accepted the code but did not report an id for it. Check the lock is online and try again.'
		);
	}

	await db.insert(lockMemberCode).values({
		userId: params.userId,
		lockAccessId: String(lockAccessId),
		code: String(code),
		label: params.memberName,
		grantedByStaffId: params.grantedByStaffId
	});

	return { code, lockAccessId };
}

/** Remove a standing code from the lock and mark the row revoked. */
export async function revokeMemberCode(id: string, reason: string): Promise<void> {
	const [row] = await db
		.select()
		.from(lockMemberCode)
		.where(and(eq(lockMemberCode.id, id), isNull(lockMemberCode.revokedAt)))
		.limit(1);

	if (!row) return;

	// By id, never by name: two users on the lock are both called "Sebastian".
	await removeTemporaryUser(Number(row.lockAccessId));

	await db
		.update(lockMemberCode)
		.set({ revokedAt: new Date(), revokedReason: reason })
		.where(eq(lockMemberCode.id, id));
}

/** The live standing codes, with the member each belongs to. */
export async function listMemberCodes(): Promise<
	Array<LockMemberCode & { memberName: string | null }>
> {
	const rows = await db
		.select({ code: lockMemberCode, memberName: user.name })
		.from(lockMemberCode)
		.leftJoin(user, eq(lockMemberCode.userId, user.id))
		.where(isNull(lockMemberCode.revokedAt));

	return rows.map((row) => ({ ...row.code, memberName: row.memberName }));
}

/**
 * Whether this member already holds a standing code.
 *
 * Provisioning skips them: a member who can already open the door does not need
 * a second code per booking, and every code not issued is one less user on the
 * lock's finite table.
 */
export async function hasActiveMemberCode(userId: string): Promise<boolean> {
	const [row] = await db
		.select({ id: lockMemberCode.id })
		.from(lockMemberCode)
		.where(and(eq(lockMemberCode.userId, userId), isNull(lockMemberCode.revokedAt)))
		.limit(1);

	return Boolean(row);
}

/**
 * Confirm standing codes that have reached the lock.
 *
 * Same reason reservations need it: the `add` is queued in U-tec's cloud and
 * acked identically whether the lock is reachable or not.
 */
export async function reconcileMemberCodeSync(errors: string[]): Promise<number> {
	let count = 0;

	const rows = await db
		.select({ id: lockMemberCode.id, lockAccessId: lockMemberCode.lockAccessId })
		.from(lockMemberCode)
		.where(and(isNull(lockMemberCode.syncedAt), isNull(lockMemberCode.revokedAt)));

	for (const row of rows) {
		try {
			const detail = await getLockUser(Number(row.lockAccessId));
			if (detail?.syncStatus !== 1) continue;

			await db
				.update(lockMemberCode)
				.set({ syncedAt: new Date() })
				.where(eq(lockMemberCode.id, row.id));
			count++;
		} catch (err) {
			const msg = `Failed to confirm lock sync for member code ${row.id}: ${(err as Error).message}`;
			console.error(msg);
			errors.push(msg);
		}
	}

	return count;
}
