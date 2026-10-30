import { z } from 'zod';
import { titleCase } from '$lib/utils/format';
import {
	CONFIRMATION_WINDOW_DAYS,
	LONG_TEXT_MAX,
	SHORT_TEXT_MAX,
	confirmationHorizon,
	creditCompCeiling,
	creditsToHours,
	hoursToCredits
} from '$lib/config';
import { mapDomainError } from '$lib/server/errors';
import { error, invalid } from '@sveltejs/kit';
import { query, getRequestEvent } from '$app/server';
import { form } from './_remote';
import { getUserTotals } from '$lib/server/user/user-totals-service';
import { listAllStaffUsers, listStaffUsers, userRosterFilters } from '$lib/server/user/user-roster';
import { rosterEmails } from '$lib/server/roster/roster';

import { requireCapability, can, requireUser } from '$lib/server/authorization';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema/authentication';
import { directoryEntry } from '$lib/server/db/schema/directory';
import { role, modelHasRole } from '$lib/server/db/schema/authorization';
import { reservation } from '$lib/server/db/schema/reservation';
import { groupMember } from '$lib/server/db/schema/group';
import { group } from '$lib/server/db/schema/group';
import { eq, or, gt, gte, lte, ne, inArray, isNull, sql, and } from 'drizzle-orm';
import { getUserRoles } from '$lib/server/authorization';
import { positionChangeRefusal } from '$lib/server/access/position-service';
import { toEventRef } from '$lib/server/entity/refs';
import { jsonArrayField } from '$lib/utils/zod-json';
import { listByUser, list as listPayments } from '$lib/server/finance/payment-cache-service';
import {
	getAllBalances,
	getBalance,
	getUsageSinceLastAllocation,
	addCredits,
	deductCredits,
	listTransactions,
	InsufficientCreditsError
} from '$lib/server/finance/credit-service';
import { getMemberSubscription, mapDbSubscription } from '$lib/server/finance/subscription-service';
import { listUpcoming } from '$lib/server/event/event-service';
import { getUserOverview as getUserOverviewService } from '$lib/server/user/user-overview-service';
import { listNeedsYou } from '$lib/server/user/needs-you-service';
import {
	coveredByFreeHours,
	freeHoursResetAt
} from '$lib/server/reservation/reservation-credit-service';
import { getReservationConfig } from '$lib/server/reservation/config';
import { listForMember as listReservationsForMember } from '$lib/server/reservation/reservation-service';
import { listActiveSessions, getLastLoginAt } from '$lib/server/user/user-service';
import { inviteMember, listInviteGroups } from '$lib/server/user/member-invite-service';
import {
	deactivateUser as deactivateUserService,
	deactivateUsers as deactivateUsersService,
	reactivateUser as reactivateUserService,
	purgeUser as purgeUserService,
	banUser as banUserService,
	unbanUser as unbanUserService
} from '$lib/server/user/user-service';
import { resolveImageUrl } from '$lib/server/storage';
import { recordAuditEntry, listAuditEntriesForSubject } from '$lib/server/audit/audit-service';
import type { AuditProfileField } from '$lib/types/audit';
import { findMatchesFor, isProfileComplete } from '$lib/server/directory/directory-service';
import { startOfWeek, endOfWeek } from 'date-fns';
import type { CreditType } from '$lib/server/db/schema/finance';
import type { BatchItem } from 'drizzle-orm/batch';
import { parseBirthDateInput } from '$lib/utils/age';

// ---------------------------------------------------------------------------
// Staff list queries
// ---------------------------------------------------------------------------

/** The totals strip above the staff Users table; org-wide, so it takes no filters. */
export const getStaffUserTotals = query(async () => {
	await requireCapability('user.list');
	return getUserTotals();
});

const yesNoFilter = z.boolean().optional();
const staffUsersFilters = z.object({
	search: z.string().optional(),
	status: z.enum(['active', 'deactivated', 'all']).optional(),
	sustaining: yesNoFilter,
	inBand: yesNoFilter,
	staff: yesNoFilter,
	instructor: yesNoFilter,
	page: z.number().optional()
});

export const getStaffUsers = query(staffUsersFilters, async ({ page, ...filters }) => {
	await requireCapability('user.list');
	return listStaffUsers(filters, { page });
});

/** Every address the All view's filters match, not just this page's. */
export const getStaffUserEmails = query(userRosterFilters, async (f) => {
	await requireCapability('user.list');
	return rosterEmails(await listAllStaffUsers(f));
});

const staffPaymentsFilters = z.object({
	search: z.string().optional(),
	method: z.string().optional(),
	status: z.string().optional(),
	from: z.string().optional(),
	to: z.string().optional(),
	page: z.number().optional()
});

export const getStaffPayments = query(staffPaymentsFilters, async (filters) => {
	await requireCapability('finance.read');
	return listPayments(
		{
			search: filters.search || undefined,
			method: filters.method || undefined,
			status: filters.status || undefined,
			from: filters.from || undefined,
			to: filters.to || undefined
		},
		{ page: filters.page ?? 1, pageSize: 50 }
	);
});

const staffCreditsFilters = z.object({
	search: z.string().optional(),
	creditType: z.string().optional(),
	source: z.string().optional(),
	from: z.string().optional(),
	to: z.string().optional(),
	page: z.number().optional()
});

export const getStaffCredits = query(staffCreditsFilters, async (filters) => {
	await requireCapability('credit.read');
	return listTransactions(
		{
			search: filters.search || undefined,
			creditType: (filters.creditType || undefined) as CreditType | undefined,
			source: (filters.source ||
				undefined) as import('$lib/server/finance/credit-service').CreditTransactionFilters['source'],
			from: filters.from || undefined,
			to: filters.to || undefined
		},
		{ page: filters.page ?? 1, pageSize: 50 }
	);
});

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const getUser = query(z.string(), async (id) => {
	await requireCapability('user.read');
	const [found] = await db
		.select({
			id: user.id,
			name: user.name,
			email: user.email,
			emailVerified: user.emailVerified,
			pronouns: user.pronouns,
			phone: user.phone,
			dateOfBirth: user.dateOfBirth,
			image: user.image,
			memberNumber: user.memberNumber,
			directoryVisibility: directoryEntry.visibility,
			stripeId: user.stripeId,
			subscription: user.subscription,
			createdAt: user.createdAt,
			deletedAt: user.deletedAt,
			bannedAt: user.bannedAt,
			bannedById: user.bannedById,
			banReason: user.banReason
		})
		.from(user)
		// LEFT: staff must be able to open any account, including one whose
		// listing is missing. `?? 'members'` below matches the default a new entry
		// is created with.
		.leftJoin(directoryEntry, eq(directoryEntry.userId, user.id))
		.where(eq(user.id, id))
		.limit(1);

	if (!found) error(404, 'User not found');

	const roles = await getUserRoles(id);

	// Not an FK, so the staffer may since have been purged; the name is then null.
	const [bannedBy] = found.bannedById
		? await db.select({ name: user.name }).from(user).where(eq(user.id, found.bannedById))
		: [];

	// `subscription` is a stored JSON blob that only staff-side code reads for
	// its presence. It is reduced to a boolean here rather than shipped: the
	// blob carries a Stripe subscription id, and the identity header only ever
	// asks "are they sustaining?".
	const { subscription, image, directoryVisibility, ...rest } = found;

	return {
		...rest,
		bannedByName: bannedBy?.name ?? null,
		// Matches the default `ensureUserEntry` creates an entry with, so a staff
		// page never renders a blank where a visibility should be.
		directoryVisibility: directoryVisibility ?? 'members',
		avatarUrl: resolveImageUrl(image),
		sustaining: subscription != null,
		roles
	};
});

/**
 * The role catalogue, plus whether this caller may actually assign one.
 *
 * Guarded on `user.update` rather than `user.setRole` so the panel still
 * renders for someone who may edit a profile but not its roles — throwing 403
 * here would take the whole Account tab down with it. The boolean is what the
 * UI hides the picker on; the real guard is in `updateUser`, which rejects a
 * changed role set from a caller without `user.setRole`. Hiding a control is
 * not a guard, it just stops someone walking into a 403.
 */
export const getRoleCatalog = query(async () => {
	await requireCapability('user.update');
	const canSetRole = await can('user.setRole');
	if (!canSetRole) return { canSetRole, roles: [] as { id: number; name: string }[] };
	return { canSetRole, roles: await db.select({ id: role.id, name: role.name }).from(role) };
});

export const getUserPayments = query(z.string(), async (userId) => {
	await requireCapability('finance.read');
	return listByUser(userId);
});

export const getUserCredits = query(z.string(), async (userId) => {
	await requireCapability('credit.read');
	return getAllBalances(userId);
});

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

const updateUserSchema = z.object({
	// The target is an explicit, validated field rather than `params.id`: for a
	// remote call SvelteKit derives params from the caller-supplied
	// `x-sveltekit-pathname` header, so params are request input, not a
	// trustworthy identifier. Matches deactivateUser/reactivateUser/purgeUser.
	id: z.string().min(1),
	name: z.string().trim().min(1).max(SHORT_TEXT_MAX),
	pronouns: z.string().trim().max(50),
	phone: z.string().trim().max(30),
	// `YYYY-MM-DD`, or empty to clear. Unlike the member's own form this is not
	// write-once: staff are who a member asks when the date is wrong, and this is
	// the only place it can be put right.
	dateOfBirth: z.string().trim().max(10).optional().default(''),
	// `.optional()`, not `.default([])`, and still no `.catch([])`. Once the role
	// picker is hidden from a caller without `user.setRole`, an absent field
	// means "not submitted" — which is not the same as `[]`, "remove every
	// role". Conflating them is how a profile edit silently strips somebody's
	// access, which is the same hazard the missing `.catch` guards against.
	roles: jsonArrayField(
		z.string().regex(/^\d+$/, 'Invalid role ID'),
		'Invalid role selection'
	).optional()
});

export const updateUser = form(updateUserSchema, async (rawData) => {
	const data = rawData as z.infer<typeof updateUserSchema>;
	// The broad guard stays at the top so a caller who may edit a profile can
	// edit ANY profile, including an admin's — fixing a phone number is not a
	// privileged act. Only a change to the role set is, and that is checked
	// below, once we know whether one was actually submitted.
	const actor = await requireCapability('user.update');
	const id = data.id;

	const targetCurrentRoles = await getUserRoles(id);
	// `undefined` means the form did not carry the field at all — the caller
	// cannot edit roles, so leave them alone. An empty array is a real request
	// to remove every role and is handled as one.
	let roleIds: number[] | null = null;
	let roleChange: { added: string[]; removed: string[] } | null = null;

	if (data.roles !== undefined) {
		const namesById = new Map(
			(await db.select({ id: role.id, name: role.name }).from(role)).map((r) => [r.id, r.name])
		);
		const submitted = data.roles.map(Number);
		const nextRoleNames = submitted.map((rid) => namesById.get(rid)).filter(Boolean) as string[];

		const unchanged =
			nextRoleNames.length === targetCurrentRoles.length &&
			nextRoleNames.every((n) => targetCurrentRoles.includes(n));

		if (!unchanged) {
			if (!(await can('user.setRole'))) {
				error(403, 'You cannot change roles.');
			}

			// Self-demotion and the last admin are refused here and on /staff/access.
			const refusal = await positionChangeRefusal({
				actorId: actor.id,
				targetId: id,
				current: targetCurrentRoles,
				next: nextRoleNames
			});
			if (refusal) error(refusal.httpStatus, refusal.message);

			roleIds = submitted;
			roleChange = {
				added: nextRoleNames.filter((n) => !targetCurrentRoles.includes(n)),
				removed: targetCurrentRoles.filter((n) => !nextRoleNames.includes(n))
			};
		}
	}

	// Read before the write so the audit entry can name which fields changed.
	const [before] = await db
		.select({
			name: user.name,
			pronouns: user.pronouns,
			phone: user.phone,
			dateOfBirth: user.dateOfBirth
		})
		.from(user)
		.where(eq(user.id, id))
		.limit(1);
	const next = {
		name: data.name,
		pronouns: data.pronouns || null,
		phone: data.phone || null,
		dateOfBirth: parseBirthDateInput(data.dateOfBirth)
	};

	// D1 has no interactive transactions; these writes are independent, so batch
	// them for atomicity (db.batch runs in a single implicit transaction).
	const ops: BatchItem<'sqlite'>[] = [
		db
			.update(user)
			.set({ ...next, updatedAt: new Date() })
			.where(eq(user.id, id))
	];

	// Only when the set actually changed. A profile-only edit used to delete and
	// re-insert every role row on every save, which is churn the audit trail
	// does not need and a window in which the rows do not exist.
	if (roleIds !== null) {
		ops.push(db.delete(modelHasRole).where(eq(modelHasRole.userId, id)));
		if (roleIds.length > 0) {
			ops.push(
				db.insert(modelHasRole).values(roleIds.map((roleId: number) => ({ roleId, userId: id })))
			);
		}
	}

	await db.batch(ops as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);

	const subject = { type: 'user' as const, id, label: data.name };
	if (roleChange) {
		await recordAuditEntry({ action: 'user.roles_changed', subject, details: roleChange });
	}
	const fields = before
		? (Object.keys(next) as AuditProfileField[]).filter(
				(f) => String(before[f] ?? '') !== String(next[f] ?? '')
			)
		: [];
	if (fields.length > 0) {
		await recordAuditEntry({ action: 'user.profile_updated', subject, details: { fields } });
	}

	void getUserPage(id).refresh();

	return { success: true };
});

/**
 * The one message for "you asked to deduct more than they have", used both by
 * the pre-check and by the race that slips past it.
 *
 * Deliberately not `InsufficientCreditsError.message`, which reads
 * "Insufficient free_hours: requested 300, available 200" — that leaks the raw
 * enum into something a staff member reads.
 */
function overdrawn(type: CreditType, available: number, requested: number): string {
	const show = (credits: number) =>
		type === 'free_hours' ? `${creditsToHours(credits)} hrs` : `${credits}`;
	return `${titleCase(type)} balance is ${show(available)} — cannot deduct ${show(requested)}.`;
}

/** What a comp-only staffer reads when an adjustment is beyond them. */
function compRefusal(type: CreditType, ceiling: number): string {
	if (ceiling === 0) return `An admin adjusts ${titleCase(type).toLowerCase()}.`;
	const limit = type === 'free_hours' ? `${creditsToHours(ceiling)} hrs` : `${ceiling}`;
	return `Up to ${limit} of ${titleCase(type).toLowerCase()} can be added here. An admin can do more, or deduct.`;
}

export const adjustCredits = form(
	z.object({
		userId: z.string(),
		creditType: z.enum(['free_hours', 'equipment_credits']),
		amount: z.string(),
		description: z.string().min(1)
	}),
	async (data, issue) => {
		// `credit.comp` alone is bounded by `creditCompCeiling`; see below.
		const unbounded = await can('credit.adjust');
		if (!unbounded) await requireCapability('credit.comp');

		const userId = data.userId as string;
		const type = data.creditType as CreditType;
		const entered = Number(data.amount);
		const description = data.description as string;

		// Everything a staffer can get wrong here is a field they can see and fix,
		// so all of it resolves to an issue on `amount` rather than a thrown
		// status. A thrown error tears the modal down through the error boundary
		// and takes the description they already typed with it.
		if (!Number.isFinite(entered)) invalid(issue.amount('Enter a number.'));
		if (entered === 0) invalid(issue.amount('Enter an amount above or below zero.'));

		// Free hours are entered in hours, as the panel shows them, and stored as
		// 30-minute credits; a fraction that does not convert exactly is refused.
		const amount = type === 'free_hours' ? hoursToCredits(entered) : entered;
		if (type === 'free_hours' && creditsToHours(amount) !== entered) {
			invalid(issue.amount('Enter hours in half-hour steps.'));
		}

		let balanceAfter: number;
		if (!unbounded) {
			const ceiling = creditCompCeiling[type];
			if (amount < 0 || amount > ceiling) invalid(issue.amount(compRefusal(type, ceiling)));
			balanceAfter = await addCredits(userId, type, amount, 'staff_comp', undefined, description);
		} else if (amount > 0) {
			balanceAfter = await addCredits(
				userId,
				type,
				amount,
				'admin_adjustment',
				undefined,
				description
			);
		} else {
			const units = Math.abs(amount);

			// Checked before deducting so the staffer gets the balance under the
			// field. deductCredits still guards the write — this read only exists to
			// produce a better message than "the request failed".
			const available = await getBalance(userId, type);
			if (units > available) invalid(issue.amount(overdrawn(type, available, units)));

			try {
				balanceAfter = await deductCredits(
					userId,
					type,
					units,
					'admin_adjustment',
					undefined,
					description
				);
			} catch (e) {
				// Someone spent between the read above and this write. Same message,
				// re-read so the number in it is the one that actually applies.
				if (e instanceof InsufficientCreditsError) {
					invalid(issue.amount(overdrawn(type, await getBalance(userId, type), units)));
				}
				throw e;
			}
		}

		await recordAuditEntry({
			action: 'credits.adjusted',
			subject: { type: 'user', id: userId },
			details: { creditType: type, delta: amount, balanceAfter, description }
		});

		void getUserCredits(userId).refresh();
		return { success: true };
	}
);

export const deactivateUser = form(
	z.object({
		id: z.string().min(1)
	}),
	async (data) => {
		await requireCapability('user.deactivate');
		try {
			await deactivateUserService(data.id, { actor: 'staff' });
		} catch (err) {
			mapDomainError(err);
		}
		void getUserPage(data.id).refresh();
		return { success: true };
	}
);

const bulkDeactivateSchema = z.object({
	ids: jsonArrayField(z.string().min(1), 'Invalid selection').pipe(
		z.array(z.string().min(1)).min(1).max(100)
	)
});

export const bulkDeactivateUsers = form(bulkDeactivateSchema, async (rawData) => {
	await requireCapability('user.deactivate');
	const data = rawData as z.infer<typeof bulkDeactivateSchema>;
	const me = requireUser();
	return deactivateUsersService(data.ids, { skipUserId: me.id });
});

export const reactivateUser = form(
	z.object({
		id: z.string().min(1)
	}),
	async (data) => {
		await requireCapability('user.deactivate');
		let subscription: 'resumed' | 'active' | 'lapsed' | 'none' = 'none';
		try {
			({ subscription } = await reactivateUserService(data.id));
		} catch (err) {
			mapDomainError(err);
		}
		void getUserPage(data.id).refresh();
		// `lapsed` is the one outcome staff have to act on: the membership needs a
		// fresh checkout rather than the resume the other cases got.
		return { success: true, subscription };
	}
);

/** The actor is the caller, never a field: the ban record is attribution. */
export const banUser = form(
	z.object({
		id: z.string().min(1),
		reason: z.string().trim().min(1, 'Say why, for the record').max(LONG_TEXT_MAX)
	}),
	async (data) => {
		const me = await requireCapability('user.ban');
		try {
			await banUserService(data.id, { actorId: me.id, reason: data.reason });
		} catch (err) {
			mapDomainError(err);
		}
		void getUserPage(data.id).refresh();
		return { success: true };
	}
);

export const unbanUser = form(
	z.object({
		id: z.string().min(1)
	}),
	async (data) => {
		await requireCapability('user.ban');
		let subscription: 'resumed' | 'active' | 'lapsed' | 'none' = 'none';
		try {
			({ subscription } = await unbanUserService(data.id));
		} catch (err) {
			mapDomainError(err);
		}
		void getUserPage(data.id).refresh();
		return { success: true, subscription };
	}
);

export const purgeUser = form(
	z.object({
		id: z.string().min(1)
	}),
	async (data) => {
		await requireCapability('user.purge');
		try {
			await purgeUserService(data.id);
		} catch (err) {
			// Every refusal purgeUser can raise carries its own status now, including
			// the published-listings guard that a hand-written ladder here once
			// omitted (and so returned 500). See errors.spec.ts.
			mapDomainError(err);
		}
		return { success: true };
	}
);

export const getLocalUser = query(async () => {
	const { locals } = await getRequestEvent();

	return locals.user;
});

// ---------------------------------------------------------------------------
// Member dashboard
// ---------------------------------------------------------------------------

export const getMemberDashboard = query(async () => {
	const currentUser = requireUser();

	const nowDate = new Date();
	const weekStart = startOfWeek(nowDate, { weekStartsOn: 1 });
	const weekEnd = endOfWeek(nowDate, { weekStartsOn: 1 });

	const userBands = await db
		.select({ bandId: groupMember.groupId, bandName: group.name })
		.from(groupMember)
		.innerJoin(group, eq(group.id, groupMember.groupId))
		.where(and(eq(groupMember.userId, currentUser.id), eq(groupMember.status, 'active')));

	const activeBandIds = userBands.map((b) => b.bandId);
	const bandNameMap = Object.fromEntries(userBands.map((b) => [b.bandId, b.bandName]));

	const [{ count: pendingInviteCount }] = await db
		.select({ count: sql<number>`cast(count(*) as integer)` })
		.from(groupMember)
		.where(and(eq(groupMember.userId, currentUser.id), eq(groupMember.status, 'pending')));

	const [
		weekReservations,
		bandWeekReservations,
		upcomingEvents,
		credits,
		dbSubscription,
		profileComplete,
		matches,
		unconfirmed
	] = await Promise.all([
		db
			.select()
			.from(reservation)
			.where(
				and(
					eq(reservation.createdByUserId, currentUser.id),
					eq(reservation.bookerType, 'user'),
					gte(reservation.startsAt, weekStart),
					lte(reservation.startsAt, weekEnd),
					ne(reservation.status, 'cancelled')
				)
			)
			.orderBy(reservation.startsAt),
		activeBandIds.length > 0
			? db
					.select()
					.from(reservation)
					.where(
						and(
							eq(reservation.bookerType, 'group'),
							inArray(reservation.bookerId, activeBandIds),
							gte(reservation.startsAt, weekStart),
							lte(reservation.startsAt, weekEnd),
							ne(reservation.status, 'cancelled')
						)
					)
					.orderBy(reservation.startsAt)
			: Promise.resolve([]),
		listUpcoming(4),
		getAllBalances(currentUser.id),
		getMemberSubscription(currentUser.id),
		isProfileComplete(currentUser.id),
		// Into the existing Promise.all rather than a query of its own. The page
		// is on one load-bearing query (`custom/no-concurrent-remote-queries`),
		// and a card that fanned out a second one would not render past kit 2.64.
		findMatchesFor(currentUser.id),
		// Bookings inside their confirmation window that still need paying or
		// confirming, whatever week they fall in (#964). Bounded at the window in
		// SQL so out-of-window rows cannot use up the five (#2107).
		db
			.select()
			.from(reservation)
			.where(
				and(
					or(
						eq(reservation.status, 'scheduled'),
						and(
							eq(reservation.status, 'confirmed'),
							isNull(reservation.paidAt),
							or(isNull(reservation.cashDueCents), gt(reservation.cashDueCents, 0))
						)
					),
					gte(reservation.startsAt, nowDate),
					lte(reservation.startsAt, confirmationHorizon(nowDate)),
					or(
						and(
							eq(reservation.createdByUserId, currentUser.id),
							eq(reservation.bookerType, 'user')
						),
						activeBandIds.length > 0
							? and(
									eq(reservation.bookerType, 'group'),
									inArray(reservation.bookerId, activeBandIds)
								)
							: undefined
					)
				)
			)
			.orderBy(reservation.startsAt)
			.limit(5)
	]);

	const subscription = mapDbSubscription(dbSubscription);

	// Only read when there is a booking to price; the figure is live, never held.
	const reservationConfig = unconfirmed.length > 0 ? await getReservationConfig() : null;
	const freeHoursWallet = {
		balance: credits.free_hours ?? 0,
		resetAt: freeHoursResetAt(dbSubscription)
	};

	// After the fan-out above rather than inside it: it needs three of its
	// results. Its own five reads are parallel, so this is one extra round of
	// work on the server, not five.
	const needsYou = await listNeedsYou({
		userId: currentUser.id,
		reservations: unconfirmed.map((r) => ({
			id: r.id,
			startsAt: r.startsAt,
			status: r.status,
			paidAt: r.paidAt,
			cashDueCents: r.cashDueCents,
			bandName: r.bookerType === 'group' ? (bandNameMap[r.bookerId] ?? null) : null,
			coveredByFreeHours:
				r.createdByUserId === currentUser.id &&
				reservationConfig != null &&
				coveredByFreeHours(r, freeHoursWallet, reservationConfig)
		})),
		pendingInviteCount,
		profileComplete,
		now: nowDate
	});

	const allReservations = [...weekReservations, ...bandWeekReservations].sort(
		(a, b) => a.startsAt.getTime() - b.startsAt.getTime()
	);

	// Allocation/usage tracked in credits (30-min blocks); the UI converts to
	// hours. Usage comes from the ledger (see getMemberMembership) with the
	// balance shortcut as fallback when no allocation has ever run.
	const allocatedThisMonth = dbSubscription?.hoursPerReset ?? 0;
	const ledgerUsage = await getUsageSinceLastAllocation(currentUser.id, 'free_hours');
	const usedThisMonth = ledgerUsage ?? Math.max(0, allocatedThisMonth - (credits.free_hours ?? 0));

	return {
		/**
		 * What the member has to act on, soonest deadline first. The page leads
		 * with it; everything below is the calm half (#1245).
		 */
		needsYou,
		weekReservations: allReservations.map((r) => ({
			id: r.id,
			bookerType: r.bookerType,
			bookerId: r.bookerId,
			bandName: r.bookerType === 'group' ? (bandNameMap[r.bookerId] ?? null) : null,
			status: r.status,
			startsAt: r.startsAt,
			endsAt: r.endsAt,
			notes: r.notes
		})),
		upcomingEvents: upcomingEvents.map((e) => ({
			id: e.id,
			title: e.title,
			startsAt: e.startsAt,
			endsAt: e.endsAt,
			doorsAt: e.doorsAt ? e.doorsAt : null,
			posterUrl: resolveImageUrl(e.posterKey),
			/** For `EntityCard`, which keeps the tile portrait with no artwork (#1047). */
			ref: toEventRef(e)
		})),
		credits,
		subscription,
		allocatedThisMonth,
		usedThisMonth,
		pendingInviteCount,
		profileComplete,
		matches,
		unconfirmed: unconfirmed.map((r) => ({
			id: r.id,
			startsAt: r.startsAt,
			endsAt: r.endsAt,
			bandName: r.bookerType === 'group' ? (bandNameMap[r.bookerId] ?? null) : null,
			confirmFrom: new Date(r.startsAt.getTime() - CONFIRMATION_WINDOW_DAYS * 24 * 60 * 60 * 1000)
		}))
	};
});

// ---------------------------------------------------------------------------
// Staff user record — the cross-section behind /staff/members/[id]
// ---------------------------------------------------------------------------
//
// The page is tabbed and each tab fetches its own data on first open, so these
// are read one tab at a time rather than all at once. `getUserOverview` is the
// exception: it backs the header, the scoreboard and every tab badge, all of
// which have to be right before anyone clicks anything.
//
// Every query below takes the target as a validated argument. `params.id` is
// derived from a caller-supplied header on a remote call and is not a
// trustworthy identifier — the same rule updateUser/deactivateUser follow.
// ---------------------------------------------------------------------------

export const getUserOverview = query(z.string(), async (userId) => {
	await requireCapability('user.read');
	return getUserOverviewService(userId);
});

/**
 * The staff member page's one load-bearing query.
 *
 * Both halves are first paint: `getUser` backs the identity header, and the
 * overview backs the scoreboard, every tab badge and the whole Overview tab.
 * Reading them as two queries from the component made the page wait on the
 * slower of two round trips; assembled here they are one request and two
 * local reads. See `custom/no-concurrent-remote-queries`.
 */
export const getUserPage = query(z.string(), async (id) => {
	await requireCapability('user.read');

	const [member, overview] = await Promise.all([getUser(id), getUserOverview(id)]);

	return { member, overview };
});

export const getUserReservations = query(z.string(), async (userId) => {
	await requireCapability('reservation.read');
	return listReservationsForMember(userId);
});

export const getUserMembership = query(z.string(), async (userId) => {
	await requireCapability('user.read');

	const dbSubscription = await getMemberSubscription(userId);
	const subscription = mapDbSubscription(dbSubscription);

	// Usage comes from the ledger, falling back to the balance shortcut when no
	// allocation has ever run — the same derivation getMemberDashboard uses, so
	// the two pages cannot disagree about how many hours someone has spent.
	const allocated = dbSubscription?.hoursPerReset ?? 0;
	const balances = await getAllBalances(userId);
	const ledgerUsage = await getUsageSinceLastAllocation(userId, 'free_hours');
	const used = ledgerUsage ?? Math.max(0, allocated - (balances.free_hours ?? 0));

	return {
		sustaining: dbSubscription != null,
		subscription,
		coveringFees: dbSubscription?.coveringFees ?? false,
		startedAt: dbSubscription?.startedAt ?? null,
		allocated,
		used
	};
});

export const getUserCreditHistory = query(
	z.object({ userId: z.string(), page: z.number().int().min(1).default(1) }),
	async ({ userId, page }) => {
		await requireCapability('credit.read');
		return listTransactions({ userId }, { page, pageSize: 10 });
	}
);

/** Who changed this member's account, newest first. Staff-only, like the rest of the record. */
export const getUserHistory = query(z.string(), async (userId) => {
	await requireCapability('user.read');
	return listAuditEntriesForSubject('user', userId, { limit: 20 });
});

export const getUserSessions = query(z.string(), async (userId) => {
	await requireCapability('user.read');
	const [sessions, lastLoginAt] = await Promise.all([
		listActiveSessions(userId),
		getLastLoginAt(userId)
	]);
	return { sessions, lastLoginAt };
});

/**
 * The clubs and committees the Invite member modal offers, or null for a
 * caller who may not invite, so the action knows from one query to hide.
 */
export const getMemberInviteGroups = query(async () => {
	requireUser();
	if (!(await can('user.invite'))) return null;
	return listInviteGroups();
});

/**
 * Invite somebody to join CMC (#1830). An address that already has an account
 * is answered with that account rather than an email.
 */
export const inviteMemberForm = form(
	z.object({
		email: z.string().trim().email('Enter an email address'),
		name: z.string().trim().max(SHORT_TEXT_MAX).optional(),
		groupIds: z.array(z.string().min(1)).max(50).optional().default([])
	}),
	async (data) => {
		const actor = await requireCapability('user.invite');
		try {
			return await inviteMember({
				email: data.email,
				name: data.name || null,
				groupIds: data.groupIds,
				invitedBy: { id: actor.id, name: actor.name }
			});
		} catch (err) {
			mapDomainError(err);
		}
	}
);
