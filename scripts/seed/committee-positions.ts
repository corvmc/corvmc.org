import { and, asc, eq } from 'drizzle-orm';
import {
	group,
	groupMember,
	groupPosition,
	groupPositionHolder
} from '../../src/lib/server/db/schema/group';
import { db } from './db';

/** `chair` is the committee's admin row; a number is the nth plain member. */
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
			.select({ id: groupMember.id, userId: groupMember.userId, role: groupMember.role })
			.from(groupMember)
			.where(and(eq(groupMember.groupId, g.id), eq(groupMember.status, 'active')))
			.orderBy(asc(groupMember.userId));
		const chair = roster.find((r) => r.role === 'admin');
		const plain = roster.filter((r) => r.role === 'member');
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
