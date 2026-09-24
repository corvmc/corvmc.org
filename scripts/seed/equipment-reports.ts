import { inventoryAsset, workRequest } from '../../src/lib/server/db/schema/inventory';
import { workOrder } from '../../src/lib/server/db/schema/volunteer';
import { batchInsert, db } from './db';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';

/**
 * Member reports against units, in every triage stage: two untriaged on one unit
 * (the collapse case), one untriaged and still usable, one sent to an open work
 * order, one resolved and one dismissed — plus two building problems with no
 * unit, one untriaged and one in a work order. Without these the Equipment tab of the
 * flags surface only ever renders empty.
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
	await batchInsert(workOrder, [
		{
			id: orderId,
			volunteerRoleId: roleId,
			assetId: c.id,
			notes: 'Input jack is loose — resolder',
			capacity: 1,
			createdByUserId: staffId,
			createdAt: ago(4)
		},
		{
			id: buildingOrderId,
			volunteerRoleId: roleId,
			assetId: null,
			notes: 'Room B: Ceiling light flickers',
			capacity: 1,
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
			createdAt: ago(6)
		},
		{
			assetId: a.id,
			reportedByUserId: m2.id,
			note: 'Scratchy pot, cuts out above 5',
			blocksUse: true,
			createdAt: ago(2)
		},
		{
			assetId: b.id,
			reportedByUserId: m3.id,
			note: 'Tolex torn on the corner, still works fine',
			blocksUse: false,
			condition: 'fair' as const,
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
			assetId: null,
			location: 'Downstairs bathroom',
			reportedByUserId: m3.id,
			note: 'Toilet keeps running after flushing',
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

	return { reports: reports.length, workOrders: 2 };
}
