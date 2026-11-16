import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { auditLog } from '../../src/lib/server/db/schema/audit';
import { user } from '../../src/lib/server/db/schema/authentication';
import { group, groupMember } from '../../src/lib/server/db/schema/group';
import { inventoryItem, inventoryLoan } from '../../src/lib/server/db/schema/inventory';
import { formatDateInTz, formatTimeInTz } from '../../src/lib/server/reservation/timezone';
import { DEFAULT_TIMEZONE } from '../../src/lib/config';
import type { AuditEntryInput } from '../../src/lib/types/audit';
import { db } from './db';
import type { SeedReservation, SeedUser } from './types';

const DAY = 86_400_000;

/** A booking's club date and times, as the reservation rows store them. */
function when(r: SeedReservation) {
	return {
		reservationId: r.id,
		date: formatDateInTz(r.startsAt, DEFAULT_TIMEZONE),
		startTime: formatTimeInTz(r.startsAt, DEFAULT_TIMEZONE),
		endTime: formatTimeInTz(r.endsAt, DEFAULT_TIMEZONE)
	};
}

/** The first active band with two members, one of whom has a seeded booking. */
async function bandPair(reservations: SeedReservation[]) {
	const rows = await db
		.select({
			groupId: group.id,
			groupName: group.name,
			userId: groupMember.userId,
			userName: user.name
		})
		.from(groupMember)
		.innerJoin(group, eq(group.id, groupMember.groupId))
		.innerJoin(user, eq(user.id, groupMember.userId))
		.where(and(eq(group.kind, 'band'), isNull(group.deletedAt), eq(groupMember.status, 'active')))
		.orderBy(asc(group.name), asc(user.name));
	for (const booking of reservations) {
		const member = rows.find((r) => r.userId === booking.createdByUserId);
		const mate = rows.find((r) => r.groupId === member?.groupId && r.userId !== member?.userId);
		if (member && mate) return { booking, member, mate };
	}
	throw new Error('Audit seed: no band has two members and a seeded booking');
}

/**
 * Staff history on a handful of members, so the History card on
 * /staff/members/[id] has something to show: a self-closed account, a bulk
 * pair sharing a batch id, a "System" row, and a purge whose subject no longer
 * exists. A row that names a booking, band, loan or clearance names a seeded
 * one, so its chip links (`audit.spec.ts`).
 */
export async function seedAuditLog(
	users: SeedUser[],
	admin: SeedUser,
	seeded: { reservations: SeedReservation[]; deskCert: { id: string; name: string } }
) {
	console.log('Seeding audit log...');
	const [a, b, c, d] = users;
	const staff = { id: admin.id, name: admin.name, email: admin.email };
	const system = { id: null, name: 'System', email: '' };
	const batchId = '00000000-0000-4000-8000-00000000a0d1';
	const subject = (u: { id: string; name: string }) => ({
		type: 'user' as const,
		id: u.id,
		label: u.name
	});
	const byId = new Map(users.map((u) => [u.id, u]));
	const booked = seeded.reservations
		.filter((r) => r.status === 'completed' && byId.has(r.createdByUserId))
		.sort((x, y) => y.startsAt.getTime() - x.startsAt.getTime());
	const [comped, unpaid] = booked;
	if (!unpaid) throw new Error('Audit seed: fewer than two completed member bookings');
	// A third booking where one exists, so each reservation row has its own.
	const cleared = await bandPair([...booked.slice(2), comped, unpaid]);
	const loans = await db
		.select({ id: inventoryLoan.id, userId: inventoryLoan.userId, itemName: inventoryItem.name })
		.from(inventoryLoan)
		.innerJoin(inventoryItem, eq(inventoryItem.id, inventoryLoan.itemId))
		.orderBy(desc(inventoryLoan.requestedPickupDate), asc(inventoryLoan.id));
	const loan = loans.find((l) => byId.has(l.userId));
	if (!loan) throw new Error('Audit seed: no seeded loan to a seeded member');
	const borrower = byId.get(loan.userId)!;

	const rows: (AuditEntryInput & { daysAgo: number })[] = [
		{
			daysAgo: 58,
			action: 'user.roles_changed',
			subject: subject(a),
			details: { added: ['staff'], removed: [] }
		},
		{
			daysAgo: 40,
			action: 'user.profile_updated',
			subject: subject(a),
			details: { fields: ['phone', 'pronouns'] }
		},
		{
			daysAgo: 21,
			action: 'credits.adjusted',
			subject: subject(a),
			details: {
				creditType: 'free_hours',
				delta: 2,
				balanceAfter: 6,
				description: 'Room was double-booked on the 4th'
			}
		},
		{
			daysAgo: 3,
			action: 'user.roles_changed',
			subject: subject(a),
			details: { added: [], removed: ['staff'] }
		},
		{
			daysAgo: 30,
			action: 'credits.adjusted',
			subject: subject(b),
			details: {
				creditType: 'equipment_credits',
				delta: -1,
				balanceAfter: 0,
				description: 'Broken cable, agreed with member'
			}
		},
		{
			daysAgo: 14,
			action: 'user.deactivated',
			subject: subject(c),
			actor: { id: c.id, name: c.name, email: c.email },
			details: { reservationsCancelled: 1, subscriptionCancelled: true, bulk: false }
		},
		{
			daysAgo: 9,
			action: 'user.reactivated',
			subject: subject(c),
			details: { subscription: 'lapsed' }
		},
		{
			daysAgo: 12,
			action: 'user.deactivated',
			subject: subject(d),
			details: { reservationsCancelled: 0, subscriptionCancelled: false, bulk: true, batchId }
		},
		{
			daysAgo: 12,
			action: 'user.reactivated',
			subject: subject(d),
			actor: system,
			details: { subscription: 'none' }
		},
		{
			daysAgo: 6,
			action: 'reservation.comped',
			subject: subject(byId.get(comped.createdByUserId)!),
			details: { ...when(comped), waivedCents: 3000 }
		},
		{
			daysAgo: 6,
			action: 'reservation.payment_reminder',
			subject: subject(byId.get(unpaid.createdByUserId)!),
			actor: system,
			details: {
				...when(unpaid),
				daysAfter: 1,
				amountCents: 3000,
				outcome: 'failed',
				reason: null,
				outboxId: null
			}
		},
		{
			daysAgo: 5,
			action: 'clearance.granted',
			subject: subject(b),
			details: {
				memberCertificationId: 'seed-clearance-grant',
				certificationId: seeded.deskCert.id,
				certificationName: seeded.deskCert.name,
				grantedOn: '2026-11-08',
				expiresOn: '2027-11-08'
			}
		},
		{
			daysAgo: 5,
			action: 'orientation.waived',
			subject: subject(b),
			details: { reason: 'Played here for years before orientation existed' }
		},
		{
			daysAgo: 5,
			action: 'reservation.cleared_through_band',
			subject: subject({ id: cleared.member.userId, name: cleared.member.userName }),
			actor: system,
			details: {
				...when(cleared.booking),
				groupId: cleared.member.groupId,
				groupName: cleared.member.groupName,
				bandmateUserId: cleared.mate.userId,
				bandmateName: cleared.mate.userName
			}
		},
		{
			daysAgo: 8,
			action: 'equipment_loan.requested_without_clearance',
			subject: subject(borrower),
			actor: { id: borrower.id, name: borrower.name, email: borrower.email },
			details: {
				loanId: loan.id,
				equipmentName: loan.itemName,
				clearanceId: seeded.deskCert.id,
				warnings: [`Member did not hold the ${seeded.deskCert.name} clearance on the pickup date.`]
			}
		},
		{
			daysAgo: 4,
			action: 'settings.changed',
			subject: { type: 'setting', id: 'reservation', label: null },
			details: {
				changes: [{ key: 'reservation.feeGateFrom', from: '', to: '2026-11-01' }]
			}
		},
		{
			daysAgo: 2,
			action: 'contact.deleted',
			subject: { type: 'contact', id: 'seed-deleted-contact', label: 'Robin Former' },
			details: { organizationId: null }
		},
		{
			daysAgo: 2,
			action: 'venue.deleted',
			subject: { type: 'venue', id: 'seed-deleted-venue', label: 'Old Granary Loft' },
			details: {}
		},
		{
			daysAgo: 1,
			action: 'music_purchase.refunded',
			subject: { type: 'band', id: 'seed-refunded-band', label: 'Sour Cherry' },
			details: { purchaseId: 'seed-music-refund', releaseTitle: 'Marys Peak', amountCents: 1000 }
		},
		{
			daysAgo: 3,
			action: 'band.member_removed',
			subject: { type: 'band', id: 'seed-removed-member-band', label: 'Sour Cherry' },
			details: {
				memberId: 'seed-removed-member',
				userId: 'seed-removed-user',
				memberName: 'Jo Lark'
			}
		},
		{
			daysAgo: 4,
			action: 'gift.recorded',
			subject: { type: 'organization', id: 'seed-gift-org', label: 'Riverbend Print Shop' },
			details: {
				giftId: 'seed-gift',
				description: 'Show posters, 200 copies',
				valueCents: 18000,
				occurredOn: '2026-10-30',
				projectId: null
			}
		},
		{
			daysAgo: 7,
			action: 'user.purged',
			subject: { type: 'user', id: 'purged-seed-account', label: 'Casey Former' },
			details: { name: 'Casey Former', email: 'casey.former@example.com' }
		}
	];

	for (const { daysAgo, actor = staff, ...row } of rows) {
		await db.insert(auditLog).values({
			action: row.action,
			actorUserId: actor.id,
			actorName: actor.name,
			actorEmail: actor.email,
			subjectType: row.subject.type,
			subjectId: row.subject.id,
			subjectLabel: row.subject.label ?? null,
			details: row.details as Record<string, unknown>,
			createdAt: new Date(Date.now() - daysAgo * DAY)
		});
	}

	return { entries: rows.length };
}
