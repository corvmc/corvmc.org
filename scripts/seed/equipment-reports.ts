import { inventoryAsset, workRequest } from '../../src/lib/server/db/schema/inventory';
import { workOrder } from '../../src/lib/server/db/schema/volunteer';
import { workOrderLink } from '../../src/lib/server/db/schema/work-order-link';
import { batchInsert, db } from './db';
import { insertTasksWithShifts } from './shifts';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';

/**
 * Member reports against units: two on one unit sharing the repair task they
 * opened (#2756), one still usable on its own task, one on a task staff opened,
 * one resolved and one dismissed; plus two building problems with no unit, one
 * on its own repair task and one in a finished task. Without these the
 * problems list only ever renders empty.
 */
export async function seedEquipmentReports(
	members: { id: string }[],
	staffId: string,
	roleId: string | undefined
) {
	const units = await db
		.select({ id: inventoryAsset.id })
		.from(inventoryAsset)
		.where(eq(inventoryAsset.status, 'in_service'))
		.limit(4);
	if (units.length < 4 || members.length < 3 || !roleId) return { reports: 0, workOrders: 0 };

	const day = 24 * 3600_000;
	const ago = (d: number) => new Date(Date.now() - d * day);
	const [a, b, c, d] = units;
	const [m1, m2, m3] = members;

	const orderId = randomUUID();
	const buildingOrderId = randomUUID();
	// The tasks the reports on a, b and the bathroom opened (#2756).
	const repairA = randomUUID();
	const repairB = randomUUID();
	const repairBathroom = randomUUID();
	const bathroomReport = randomUUID();
	await batchInsert(workOrder, [
		{ id: repairA, title: 'Repair amp', source: 'repair', sourceId: a.id, createdAt: ago(6) },
		{ id: repairB, title: 'Repair cab', source: 'repair', sourceId: b.id, createdAt: ago(9) },
		{
			id: repairBathroom,
			title: 'Repair Downstairs bathroom',
			source: 'repair',
			sourceId: bathroomReport,
			createdAt: ago(1)
		}
	]);
	await batchInsert(workOrderLink, [
		{ workOrderId: repairA, assetId: a.id },
		{ workOrderId: repairB, assetId: b.id }
	]);
	await batchInsert(workOrder, [
		{
			id: orderId,
			volunteerRoleId: roleId,
			notes: 'Input jack is loose — resolder',
			createdByUserId: staffId,
			createdAt: ago(4)
		}
	]);
	await db.insert(workOrderLink).values({ workOrderId: orderId, assetId: c.id });
	// Its shift ended yesterday and the task is still open, so it sits on Today
	// as a task with ended shifts, its report open until someone marks it done (#2518).
	await insertTasksWithShifts([
		{
			id: buildingOrderId,
			volunteerRoleId: roleId,
			startsAt: ago(1),
			endsAt: new Date(ago(1).getTime() + 2 * 3600_000),
			notes: 'Room B: Ceiling light flickers',
			createdByUserId: staffId,
			createdAt: ago(3)
		}
	]);

	const reports = await batchInsert(workRequest, [
		{
			assetId: a.id,
			reportedByUserId: m1.id,
			note: 'Crackles when you turn the volume knob',
			blocksUse: true,
			condition: 'poor' as const,
			workOrderId: repairA,
			createdAt: ago(6)
		},
		{
			assetId: a.id,
			reportedByUserId: m2.id,
			note: 'Scratchy pot, cuts out above 5',
			blocksUse: true,
			workOrderId: repairA,
			createdAt: ago(2)
		},
		{
			assetId: b.id,
			reportedByUserId: m3.id,
			note: 'Tolex torn on the corner, still works fine',
			blocksUse: false,
			condition: 'fair' as const,
			workOrderId: repairB,
			createdAt: ago(9)
		},
		{
			assetId: c.id,
			reportedByUserId: m1.id,
			note: 'Input jack wobbles',
			blocksUse: false,
			workOrderId: orderId,
			createdAt: ago(5)
		},
		{
			assetId: d.id,
			reportedByUserId: m2.id,
			note: 'Snare wires buzz',
			status: 'resolved' as const,
			resolvedByUserId: staffId,
			resolutionNotes: 'Tightened the strainer.',
			resolvedAt: ago(20),
			createdAt: ago(25)
		},
		{
			assetId: d.id,
			reportedByUserId: m3.id,
			note: 'Stand is missing a wing nut',
			status: 'dismissed' as const,
			resolvedByUserId: staffId,
			resolutionNotes: 'It was in the case pocket.',
			resolvedAt: ago(12),
			createdAt: ago(13)
		},
		// Building problems: a place instead of a unit.
		{
			id: bathroomReport,
			assetId: null,
			location: 'Downstairs bathroom',
			reportedByUserId: m3.id,
			note: 'Toilet keeps running after flushing',
			workOrderId: repairBathroom,
			createdAt: ago(1)
		},
		{
			assetId: null,
			location: 'Room B',
			reportedByUserId: m2.id,
			note: 'Ceiling light flickers',
			workOrderId: buildingOrderId,
			createdAt: ago(3)
		}
	]);

	return { reports: reports.length, workOrders: 5 };
}
