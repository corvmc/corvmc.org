import {
	maintenanceSchedule,
	volunteerRole,
	volunteerSignup,
	workOrder
} from '../../src/lib/server/db/schema/volunteer';
import { inventoryAsset, inventoryItem } from '../../src/lib/server/db/schema/inventory';
import { group } from '../../src/lib/server/db/schema/group';
import { batchInsert, db } from './db';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';

/**
 * Recurring facility work, in the three states `/staff/volunteer/recurring` renders:
 * a live schedule with history and a next one due, a live one whose open work
 * order is overdue, and a retired one whose last occurrence was closed. The
 * weekly bathroom clean has somebody on its open occurrence (#1483).
 */
export async function seedMaintenanceSchedules(staffId: string, cleanerId?: string) {
	console.log('Seeding recurring work...');

	const [role] = await db
		.select({ id: volunteerRole.id })
		.from(volunteerRole)
		.where(eq(volunteerRole.name, 'Facilities & Maintenance'))
		.limit(1);
	if (!role) return { schedules: 0 };

	// The PA check is about one unit, so it links to a seeded speaker (#1423).
	const [speaker] = await db
		.select({ id: inventoryAsset.id })
		.from(inventoryAsset)
		.innerJoin(inventoryItem, eq(inventoryItem.id, inventoryAsset.itemId))
		.where(eq(inventoryItem.name, 'QSC K12.2 Powered Speaker'))
		.limit(1);
	const paAssetId = speaker?.id ?? null;

	const now = Date.now();
	const day = 86_400_000;
	const at = (offsetDays: number) => new Date(now + offsetDays * day);

	const clean = { id: randomUUID(), name: 'Monthly deep clean', intervalDays: 30 };
	const pa = { id: randomUUID(), name: 'Quarterly PA check', intervalDays: 91 };
	const filters = { id: randomUUID(), name: 'HVAC filter swap', intervalDays: 60 };
	const bathroom = { id: randomUUID(), name: 'Weekly bathroom clean', intervalDays: 7 };

	await batchInsert(
		maintenanceSchedule,
		[clean, pa, filters, bathroom].map((s) => ({
			...s,
			volunteerRoleId: role.id,
			capacity: 1,
			createdByUserId: staffId,
			assetId: s === pa ? paAssetId : null,
			retiredAt: s === filters ? at(-5) : null
		}))
	);

	const base = { volunteerRoleId: role.id, capacity: 1, createdByUserId: staffId };
	await batchInsert(
		workOrder,
		[
			// Closed twenty days ago, so the open one is due ten days out.
			{ ...base, maintenanceScheduleId: clean.id, title: clean.name, dueAt: at(-25) },
			{ ...base, maintenanceScheduleId: clean.id, title: clean.name, dueAt: at(10) },
			// Nobody has closed this one, and it is three days late.
			{
				...base,
				maintenanceScheduleId: pa.id,
				title: pa.name,
				assetId: paAssetId,
				dueAt: at(-3)
			},
			{ ...base, maintenanceScheduleId: filters.id, title: filters.name, dueAt: at(-12) }
		].map((row, i) => ({
			id: randomUUID(),
			...row,
			...(i === 0 ? { resolvedAt: at(-20), resolvedByUserId: staffId } : {}),
			...(i === 3 ? { resolvedAt: at(-10), resolvedByUserId: staffId } : {})
		}))
	);

	// Last week's is done; this week's is due in two days and already has its cleaner.
	const bathroomOpen = randomUUID();
	await batchInsert(workOrder, [
		{
			id: randomUUID(),
			...base,
			maintenanceScheduleId: bathroom.id,
			title: bathroom.name,
			dueAt: at(-7),
			resolvedAt: at(-5),
			resolvedByUserId: staffId
		},
		{
			id: bathroomOpen,
			...base,
			maintenanceScheduleId: bathroom.id,
			title: bathroom.name,
			dueAt: at(2)
		}
	]);
	if (cleanerId) {
		await batchInsert(volunteerSignup, [
			{
				shiftId: bathroomOpen,
				userId: cleanerId,
				status: 'confirmed',
				claimedAt: at(-4),
				confirmedAt: at(-3)
			}
		]);
	}

	// A committee's own standing checklist (#1512), shown on its Projects tab.
	const [booking] = await db
		.select({ id: group.id })
		.from(group)
		.where(eq(group.slug, 'booking-committee'))
		.limit(1);
	if (!booking) return { schedules: 4 };
	const holds = {
		id: randomUUID(),
		name: 'Weekly holds review',
		intervalDays: 7,
		groupId: booking.id
	};
	await batchInsert(maintenanceSchedule, [
		{ ...holds, volunteerRoleId: role.id, capacity: 1, createdByUserId: staffId }
	]);
	await batchInsert(workOrder, [
		{ id: randomUUID(), ...base, maintenanceScheduleId: holds.id, title: holds.name, dueAt: at(4) }
	]);

	return { schedules: 5 };
}
