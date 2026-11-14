import { and, asc, eq, isNull } from 'drizzle-orm';
import {
	group,
	groupMember,
	groupPosition,
	groupPositionHolder
} from '../../src/lib/server/db/schema/group';
import { workOrder } from '../../src/lib/server/db/schema/volunteer';
import { db } from './db';

/** `chair` holds the committee's chair position; a number is the nth other member. */
type Holder = 'chair' | number | { personaId: string };

/**
 * Each committee's defined positions (#2988). Covers a position the chair
 * holds, one held by two people, a vacant one, and one held by a loginable
 * persona who is not the chair (`clubhost@`, on Development).
 */
const POSITIONS: Record<string, { name: string; holders: Holder[] }[]> = {
	'booking-committee': [
		{ name: 'Booker', holders: ['chair', 0] },
		{ name: 'Secretary', holders: [1] },
		{ name: 'Treasurer', holders: [] }
	],
	'facilities-committee': [
		{ name: 'Maintenance lead', holders: ['chair'] },
		{ name: 'Key holder', holders: [] }
	],
	'production-committee': [
		{ name: 'Stage manager', holders: ['chair'] },
		{ name: 'Sound lead', holders: [0] }
	],
	'communications-committee': [{ name: 'Newsletter editor', holders: ['chair'] }],
	'art-and-merchandise-committee': [{ name: 'Market coordinator', holders: ['chair'] }],
	'development-committee': [
		{ name: 'Grant writer', holders: [{ personaId: 'seed-group-leader-open' }] },
		{ name: 'Sponsor contact', holders: ['chair'] }
	]
};

export async function seedCommitteePositions() {
	let positions = 0;
	let holders = 0;
	for (const [slug, defs] of Object.entries(POSITIONS)) {
		const [g] = await db.select({ id: group.id }).from(group).where(eq(group.slug, slug));
		if (!g) continue;
		const roster = await db
			.select({ id: groupMember.id, userId: groupMember.userId })
			.from(groupMember)
			.where(and(eq(groupMember.groupId, g.id), eq(groupMember.status, 'active')))
			.orderBy(asc(groupMember.userId));
		const chairRows = await db
			.select({ memberId: groupPositionHolder.memberId })
			.from(groupPositionHolder)
			.innerJoin(groupPosition, eq(groupPosition.id, groupPositionHolder.positionId))
			.where(and(eq(groupPosition.groupId, g.id), eq(groupPosition.isChair, true)));
		const chairIds = new Set(chairRows.map((c) => c.memberId));
		const chair = roster.find((r) => chairIds.has(r.id));
		const plain = roster.filter((r) => !chairIds.has(r.id));
		const resolve = (h: Holder) =>
			h === 'chair'
				? chair
				: typeof h === 'number'
					? plain[h]
					: roster.find((r) => r.userId === h.personaId);

		for (const def of defs) {
			const [p] = await db
				.insert(groupPosition)
				.values({ groupId: g.id, name: def.name })
				.returning({ id: groupPosition.id });
			positions++;
			for (const h of def.holders) {
				const member = resolve(h);
				if (!member) continue;
				await db
					.insert(groupPositionHolder)
					.values({ positionId: p.id, memberId: member.id, assignedById: chair?.userId ?? null });
				holders++;
			}
		}
	}
	return { positions, holders };
}

/**
 * Open committee tasks tagged for a position (#2990): one on a held position,
 * so it waits on its holder alone, and one on a vacant position, so it still
 * waits on the whole committee. Runs after every seeder that writes tasks.
 */
const TAGGED: Record<string, string[]> = { 'booking-committee': ['Secretary', 'Treasurer'] };

export async function seedPositionTaggedTasks() {
	let tagged = 0;
	for (const [slug, names] of Object.entries(TAGGED)) {
		const [g] = await db.select({ id: group.id }).from(group).where(eq(group.slug, slug));
		if (!g) continue;
		const open = await db
			.select({ id: workOrder.id })
			.from(workOrder)
			.where(
				and(
					eq(workOrder.groupId, g.id),
					isNull(workOrder.resolvedAt),
					isNull(workOrder.cancelledAt)
				)
			)
			.orderBy(asc(workOrder.id))
			.limit(names.length);
		for (const [i, task] of open.entries()) {
			const [p] = await db
				.select({ id: groupPosition.id })
				.from(groupPosition)
				.where(and(eq(groupPosition.groupId, g.id), eq(groupPosition.name, names[i])));
			if (!p) continue;
			await db.update(workOrder).set({ positionId: p.id }).where(eq(workOrder.id, task.id));
			tagged++;
		}
	}
	return tagged;
}
