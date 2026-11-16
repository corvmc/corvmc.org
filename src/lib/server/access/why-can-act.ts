import { and, asc, eq, isNull, ne } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import {
	group,
	groupMember,
	groupPosition,
	groupPositionHolder
} from '#lib/server/db/schema/group.js';
import { capabilitySet, positionsFor } from '#lib/server/authorization.js';
import {
	committeeGrantsFor,
	liveRoleGrantsFor,
	type LiveRoleGrant
} from '#lib/server/capability/capability-grants.js';
import { grantRuleFor, OPERATIONS_GROUP_ID, type Capability, type Position } from '#lib/config.js';

export interface PositionAccess {
	position: Position;
	/** What the matrix grants this position, read through the guards' authorizer. */
	capabilities: Capability[];
}

export interface DepartmentAccess {
	groupId: string;
	name: string;
	/** The committee's positions this person holds, chair first. */
	positions: string[];
	grants: { capability: Capability; reach: 'org' | 'owned' }[];
}

export interface AccessExplanation {
	positions: PositionAccess[];
	departments: DepartmentAccess[];
	shiftRoles: LiveRoleGrant[];
}

/**
 * Why a person can act (#2994): their positions, the committees they sit on
 * with the positions they hold there, and the shift roles live at `now`. Each
 * capability comes from the function its guard asks (`capabilitySet`,
 * `committeeGrantsFor`, `liveRoleGrantsFor`), so this cannot list what a
 * guard refuses. `why-can-act.spec.ts` holds the two together.
 */
export async function explainAccess(
	userId: string,
	now: Date = new Date()
): Promise<AccessExplanation> {
	const [positions, seatRows, grants, shiftRoles] = await Promise.all([
		positionsFor(userId),
		db
			.select({
				groupId: group.id,
				name: group.name,
				position: groupPosition.name,
				isChair: groupPosition.isChair
			})
			.from(groupMember)
			.innerJoin(group, eq(group.id, groupMember.groupId))
			.leftJoin(groupPositionHolder, eq(groupPositionHolder.memberId, groupMember.id))
			.leftJoin(groupPosition, eq(groupPosition.id, groupPositionHolder.positionId))
			.where(
				and(
					eq(groupMember.userId, userId),
					eq(groupMember.status, 'active'),
					eq(group.kind, 'committee'),
					isNull(group.deletedAt),
					// Operations seats are the positions above.
					ne(group.id, OPERATIONS_GROUP_ID)
				)
			)
			.orderBy(asc(group.name), asc(groupPosition.name)),
		committeeGrantsFor(userId),
		liveRoleGrantsFor(userId, now)
	]);

	const departments = new Map<string, DepartmentAccess>();
	for (const r of seatRows) {
		const dept = departments.get(r.groupId) ?? {
			groupId: r.groupId,
			name: r.name,
			positions: [],
			grants: (grants.find((g) => g.groupId === r.groupId)?.capabilities ?? []).flatMap((c) => {
				const reach = grantRuleFor(c)?.committee;
				return reach ? [{ capability: c as Capability, reach }] : [];
			})
		};
		if (r.position) {
			if (r.isChair) dept.positions.unshift(r.position);
			else dept.positions.push(r.position);
		}
		departments.set(r.groupId, dept);
	}

	return {
		positions: positions.map((position) => ({
			position,
			capabilities: capabilitySet([position])
		})),
		departments: [...departments.values()],
		shiftRoles
	};
}
