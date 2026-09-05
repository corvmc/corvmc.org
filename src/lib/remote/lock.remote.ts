import { z } from 'zod';
import { error } from '@sveltejs/kit';
import { query, command } from '$app/server';
import { requireCapability, requireUser } from '$lib/server/authorization';
import { db } from '$lib/server/db';
import { reservation } from '$lib/server/db/schema/reservation';
import { user } from '$lib/server/db/schema/authentication';
import { eq } from 'drizzle-orm';
import { queryDeviceHealth } from '$lib/server/lock/ultraloc-client';
import { reprovisionAccessFor } from '$lib/server/lock/lock-service';
import {
	getActiveFallbackCode,
	rotateFallbackCodeNow
} from '$lib/server/lock/fallback-code-service';
import {
	listUnmanagedLockUsers,
	adoptLockUser,
	grantMemberCode,
	revokeMemberCode,
	listMemberCodes
} from '$lib/server/lock/member-code-service';

// ---------------------------------------------------------------------------
// Door access
// ---------------------------------------------------------------------------
// Guarded by `lock.manage`, split out of `settings.update`: these are
// member-affecting acts on a physical door, not configuration.
// ---------------------------------------------------------------------------

/**
 * Whether the lock is reachable, plus the break-glass code staff may need to
 * read out over the phone.
 *
 * Only `online` is live. `lockState` and `batteryLevel` are whatever U-tec last
 * heard from the device, which during an outage may be months old.
 */
export const getLockHealth = query(async () => {
	await requireCapability('lock.manage');

	try {
		const [health, fallback] = await Promise.all([queryDeviceHealth(), getActiveFallbackCode()]);

		return {
			ok: true as const,
			online: health.online,
			lockState: health.lockState,
			batteryLevel: health.batteryLevel,
			fallbackCode: fallback?.code ?? null,
			fallbackSyncedAt: fallback?.syncedAt ?? null
		};
	} catch (err) {
		return { ok: false as const, error: (err as Error).message };
	}
});

/** Type-0 lock users the app does not account for, for staff to adopt or revoke. */
export const getUnmanagedLockUsers = query(async () => {
	await requireCapability('lock.manage');
	return listUnmanagedLockUsers();
});

/** Standing member codes, live ones only. */
export const getMemberCodes = query(async () => {
	await requireCapability('lock.manage');
	return listMemberCodes();
});

/** Re-issue door access for one booking, without waiting for tomorrow's cron. */
export const reprovisionReservationAccess = command(z.string(), async (reservationId) => {
	await requireCapability('lock.manage');

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

	if (!row) error(404, 'Reservation not found');
	if (row.status !== 'confirmed') error(400, 'Only a confirmed reservation gets a door code');

	// Keep the existing code when there is one: the member may already have been
	// told it, and changing it under them is its own failure.
	return reprovisionAccessFor({
		id: row.id,
		startsAt: row.startsAt,
		endsAt: row.endsAt,
		memberName: row.memberName,
		code: row.lockCode ? Number(row.lockCode) : undefined
	});
});

/** Mint a successor break-glass code ahead of its scheduled rotation. */
export const rotateFallbackCode = command(async () => {
	await requireCapability('lock.manage');
	return rotateFallbackCodeNow();
});

/** Claim an existing lock user as a managed member code. Changes nothing on the lock. */
export const adoptUnmanagedCode = command(
	z.object({
		lockAccessId: z.number().int(),
		label: z.string().trim().min(1),
		userId: z.string().trim().min(1).nullable()
	}),
	async ({ lockAccessId, label, userId }) => {
		await requireCapability('lock.manage');
		await adoptLockUser({ lockAccessId, label, userId });
		return { adopted: true };
	}
);

/** Give a member a standing door code. */
export const grantStandingCode = command(z.string(), async (userId) => {
	const staff = await requireUser();
	await requireCapability('lock.manage');

	const [member] = await db
		.select({ id: user.id, name: user.name })
		.from(user)
		.where(eq(user.id, userId))
		.limit(1);

	if (!member) error(404, 'Member not found');

	return grantMemberCode({
		userId: member.id,
		memberName: member.name,
		grantedByStaffId: staff.id
	});
});

/** Take a standing door code away. */
export const revokeStandingCode = command(
	z.object({ id: z.string().trim().min(1), reason: z.string().trim().min(1) }),
	async ({ id, reason }) => {
		await requireCapability('lock.manage');
		await revokeMemberCode(id, reason);
		return { revoked: true };
	}
);
