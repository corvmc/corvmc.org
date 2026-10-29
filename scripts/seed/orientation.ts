import { randomUUID } from 'crypto';
import { holdRoom } from './room';
import { eq } from 'drizzle-orm';
import {
	memberOrientation,
	workOrder,
	volunteerSignup
} from '../../src/lib/server/db/schema/volunteer';
import { reservation } from '../../src/lib/server/db/schema/reservation';
import { batchInsert, db } from './db';
import { ptDate } from './util';

/**
 * Orientation shifts, and the four states a member can be in.
 *
 * Written by hand: the seed runs outside the app, where no listener fires. The
 * shape matches the orientation setting's default — at the booking's start, 30
 * minutes long. The setting itself lives in KV and starts empty, so the listener
 * stays off locally until staff pick a role in Settings.
 *
 * Every state is seeded, not just the happy one. `pending` and `scheduled` are
 * what a fresh member looks like; `completed` and `waived` are the two the staff
 * card and the waive action are built against, and without rows for them both
 * are developed and reviewed against an empty screen. The cancelled booking is
 * there for the same reason: it is the only way to see a stood-down shift
 * sitting in the notify queue with an unnotified count.
 */
export async function seedOrientation(volunteerRoles: any[], users: any[]) {
	console.log('Seeding orientation...');

	const role = volunteerRoles.find((r: any) => r.name === 'Rehearsal Orientation');
	if (!role) return { workOrders: 0, orientations: 0 };

	const DURATION_MINUTES = 30;

	// Wren is the guaranteed first-timer `seed/reservations.ts` creates precisely
	// so the desk's first-visit flag is on screen after every seed. Their booking
	// is what an orientation hangs off.
	const [wren] = await db
		.select({
			id: reservation.createdByUserId,
			resId: reservation.id,
			startsAt: reservation.startsAt
		})
		.from(reservation)
		.where(eq(reservation.notes, 'First time here — is there somewhere to park a van?'))
		.limit(1);

	const workOrderRows: any[] = [];
	const orientationRows: any[] = [];

	function shiftFor(id: string, reservationId: string, startsAt: Date) {
		const from = startsAt;
		workOrderRows.push({
			id,
			volunteerRoleId: role.id,
			reservationId,
			startsAt: from,
			endsAt: new Date(from.getTime() + DURATION_MINUTES * 60_000),
			capacity: 1,
			notes: 'First visit — meet them at the front door.',
			anchor: 'start' as const,
			isOrientation: true,
			createdByUserId: null
		});
		return from;
	}

	// `scheduled`, and unclaimed — so the coordinator's short-staffed card has a
	// row that matters on a fresh database.
	if (wren) {
		const from = shiftFor('seed-orientation-wo-wren', wren.resId, wren.startsAt);
		orientationRows.push({
			id: randomUUID(),
			userId: wren.id,
			reservationId: wren.resId,
			workOrderId: 'seed-orientation-wo-wren',
			scheduledFor: from
		});
	}

	// `completed`: somebody was shown around a fortnight ago. Needs its own past
	// booking, because Wren's is the future one the flag depends on.
	const veteran = users.find((u: any) => u.id !== wren?.id);
	if (veteran) {
		// The orientation's own booking; the cancelled one below holds nothing,
		// because `hasConflict` ignores a cancelled row.
		const slot = holdRoom(ptDate(-14, 18), ptDate(-14, 20), 'orientation');
		const [past] = await db
			.insert(reservation)
			.values({
				bookerType: 'user',
				bookerId: veteran.id,
				createdByUserId: veteran.id,
				status: 'completed',
				...slot
			})
			.returning();

		const from = shiftFor('seed-orientation-wo-done', past.id, past.startsAt);
		workOrderRows[workOrderRows.length - 1].resolvedAt = past.endsAt;
		workOrderRows[workOrderRows.length - 1].resolvedByUserId = 'seed-vol-coordinator';

		orientationRows.push({
			id: randomUUID(),
			userId: veteran.id,
			reservationId: past.id,
			workOrderId: 'seed-orientation-wo-done',
			scheduledFor: from,
			completedAt: past.endsAt,
			completedByUserId: 'seed-vol-active'
		});
	}

	// `pending` by way of a cancellation: the booking is off, the shift is stood
	// down, and the volunteer on it has not been told. That last part is the state
	// the "Notify all" button exists for, and it is unreachable without a row.
	const dropped = users.find((u: any) => u.id !== wren?.id && u.id !== veteran?.id);
	if (dropped) {
		const [off] = await db
			.insert(reservation)
			.values({
				bookerType: 'user',
				bookerId: dropped.id,
				createdByUserId: dropped.id,
				status: 'cancelled',
				startsAt: ptDate(4, 19),
				endsAt: ptDate(4, 21),
				cancellationReason: 'Changed plans',
				cancelledBy: 'member',
				cancelledByUserId: dropped.id,
				cancelledAt: new Date()
			})
			.returning();

		shiftFor('seed-orientation-wo-cancelled', off.id, off.startsAt);
		workOrderRows[workOrderRows.length - 1].cancelledAt = new Date();
		workOrderRows[workOrderRows.length - 1].cancelledByUserId = 'seed-vol-coordinator';

		orientationRows.push({
			id: randomUUID(),
			userId: dropped.id,
			reservationId: off.id,
			// Cleared by the cascade, which is what puts them back to `pending`.
			workOrderId: null,
			scheduledFor: null
		});
	}

	// `waived`: a long-time member who does not need showing around.
	const waived = users.find(
		(u: any) => u.id !== wren?.id && u.id !== veteran?.id && u.id !== dropped?.id
	);
	if (waived) {
		orientationRows.push({
			id: randomUUID(),
			userId: waived.id,
			waivedAt: new Date(Date.now() - 30 * 86_400_000),
			waivedReason: 'Long-time member — knows the room better than we do.',
			waivedByUserId: 'seed-vol-coordinator'
		});
	}

	if (workOrderRows.length > 0) await batchInsert(workOrder, workOrderRows, 8);
	if (orientationRows.length > 0) await batchInsert(memberOrientation, orientationRows, 7);

	// Sam is on the cancelled one and has not been told, which is the whole point
	// of seeding it.
	await batchInsert(volunteerSignup, [
		{
			id: 'seed-orientation-signup-cancelled',
			shiftId: 'seed-orientation-wo-cancelled',
			userId: 'seed-vol-active',
			status: 'confirmed' as const,
			claimedAt: new Date(Date.now() - 3 * 86_400_000),
			confirmedAt: new Date(Date.now() - 3 * 86_400_000)
		}
	]).catch(() => {
		// The cancelled shift only exists when there was a spare member to hang it
		// off; a signup pointing at nothing is not worth failing the seed over.
	});

	return {
		workOrders: workOrderRows.length,
		orientations: orientationRows.length
	};
}
