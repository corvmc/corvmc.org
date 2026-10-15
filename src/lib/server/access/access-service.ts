import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { role, modelHasRole } from '$lib/server/db/schema/authorization';
import { user } from '$lib/server/db/schema/authentication';
import { group, groupCapability, groupMember } from '$lib/server/db/schema/group';
import { volunteerRole, volunteerRoleCapability } from '$lib/server/db/schema/volunteer';
import { memberRefColumns, toMemberRef } from '$lib/server/entity/refs';
import { capabilitySet } from '$lib/server/authorization';
import {
	listClearances,
	listForUser,
	type ClearanceRow,
	type HeldCertification
} from '$lib/server/volunteer/member-certification-service';
import {
	grantRuleFor,
	positionLabels,
	positionOrder,
	positionsGranting,
	type Capability,
	type Position
} from '$lib/config';
import type { MemberRef } from '$lib/types/entity';

/** How far ahead "lapsing" looks on this page. Not `CERT_EXPIRY_WARNING_DAYS`, which is 60. */
export const ACCESS_LAPSING_DAYS = 30;
const DAY_MS = 86_400_000;

export interface PositionHolder {
	member: MemberRef;
	position: Position;
}

/** Every position held by a live account, by position then name. */
async function listPositionHolders(only?: readonly Position[]): Promise<PositionHolder[]> {
	const names = only ?? positionOrder;
	if (names.length === 0) return [];
	const rows = await db
		.select({ member: memberRefColumns(), position: role.name })
		.from(modelHasRole)
		.innerJoin(role, eq(role.id, modelHasRole.roleId))
		.innerJoin(user, eq(user.id, modelHasRole.userId))
		.where(and(inArray(role.name, [...names]), isNull(user.deletedAt)))
		.orderBy(user.name);
	return rows.map((r) => ({ member: toMemberRef(r.member), position: r.position as Position }));
}

/** Is this clearance still in force and running out within `ACCESS_LAPSING_DAYS`? */
export function isLapsing(row: Pick<ClearanceRow, 'state' | 'expiresAt'>, now: Date): boolean {
	if (row.state === 'revoked' || row.state === 'expired' || !row.expiresAt) return false;
	return row.expiresAt.getTime() <= now.getTime() + ACCESS_LAPSING_DAYS * DAY_MS;
}

export interface AccessSummary {
	admins: number;
	staff: number;
	positionsHeld: number;
	lapsingSoon: number;
}

export async function getAccessSummary(now = new Date()): Promise<AccessSummary> {
	const [holders, clearances] = await Promise.all([listPositionHolders(), listClearances()]);
	const holding = (p: Position) => holders.filter((h) => h.position === p).length;
	return {
		admins: holding('admin'),
		staff: holding('staff'),
		positionsHeld: holders.length,
		lapsingSoon: clearances.filter((c) => isLapsing(c, now)).length
	};
}

export interface CommitteeSeat {
	groupId: string;
	name: string;
	/** `owner` and `admin` both chair a committee. */
	chair: boolean;
	grants: Capability[];
}

export interface PersonAccess {
	positions: Position[];
	/** What the positions confer through the matrix. */
	capabilities: Capability[];
	seats: CommitteeSeat[];
	clearances: HeldCertification[];
}

/** Everything one person holds, each item carrying its source. */
export async function getPersonAccess(userId: string): Promise<PersonAccess> {
	const [roleRows, seatRows, clearances] = await Promise.all([
		db
			.select({ name: role.name })
			.from(modelHasRole)
			.innerJoin(role, eq(role.id, modelHasRole.roleId))
			.where(eq(modelHasRole.userId, userId)),
		db
			.select({
				groupId: group.id,
				name: group.name,
				role: groupMember.role,
				capability: groupCapability.capability
			})
			.from(groupMember)
			.innerJoin(group, eq(group.id, groupMember.groupId))
			.leftJoin(groupCapability, eq(groupCapability.groupId, group.id))
			.where(
				and(
					eq(groupMember.userId, userId),
					eq(groupMember.status, 'active'),
					eq(group.kind, 'committee'),
					isNull(group.deletedAt)
				)
			)
			.orderBy(group.name),
		listForUser(userId)
	]);

	const positions = positionOrder.filter((p) => roleRows.some((r) => r.name === p));
	const seats = new Map<string, CommitteeSeat>();
	for (const r of seatRows) {
		const seat = seats.get(r.groupId) ?? {
			groupId: r.groupId,
			name: r.name,
			chair: r.role !== 'member',
			grants: []
		};
		if (r.capability && grantRuleFor(r.capability)?.committee) {
			seat.grants.push(r.capability as Capability);
		}
		seats.set(r.groupId, seat);
	}
	return {
		positions,
		capabilities: capabilitySet(positions),
		seats: [...seats.values()],
		clearances
	};
}

export interface CapabilityHolder {
	member: MemberRef;
	/** Each way this person holds it: a position label, or a committee and its reach. */
	sources: string[];
}

export interface CapabilityHolders {
	holders: CapabilityHolder[];
	/** Committees carrying it, for editing their grants from here. */
	committees: { groupId: string; name: string; held: Capability[] }[];
	/** Volunteer roles carrying it for their own shift's event only. */
	roles: { id: string; name: string }[];
}

/**
 * Everyone who holds `cap`, through a position or a committee seat. Role grants
 * last one shift, so those roles are listed rather than their volunteers.
 */
export async function listCapabilityHolders(cap: Capability): Promise<CapabilityHolders> {
	const rule = grantRuleFor(cap);
	const [byPosition, committeeRows, roles] = await Promise.all([
		listPositionHolders(positionsGranting(cap)),
		rule?.committee ? committeesGranting(cap) : { seats: [], committees: [] },
		rule?.role
			? db
					.select({ id: volunteerRole.id, name: volunteerRole.name })
					.from(volunteerRoleCapability)
					.innerJoin(volunteerRole, eq(volunteerRole.id, volunteerRoleCapability.volunteerRoleId))
					.where(eq(volunteerRoleCapability.capability, cap))
					.orderBy(volunteerRole.name)
			: []
	]);

	const byUser = new Map<string, CapabilityHolder>();
	const add = (member: MemberRef, source: string) => {
		const key = member.id ?? '';
		const entry = byUser.get(key) ?? { member, sources: [] };
		if (!entry.sources.includes(source)) entry.sources.push(source);
		byUser.set(key, entry);
	};
	for (const h of byPosition) add(h.member, positionLabels[h.position]);
	const reach = rule?.committee === 'owned' ? 'on its own records' : 'org-wide';
	for (const c of committeeRows.seats) add(c.member, `${c.committeeName} (${reach})`);

	return {
		holders: [...byUser.values()].sort((a, b) => a.member.title.localeCompare(b.member.title)),
		committees: committeeRows.committees,
		roles
	};
}

async function committeesGranting(cap: Capability) {
	const carrying = await db
		.select({ groupId: group.id, name: group.name })
		.from(groupCapability)
		.innerJoin(group, eq(group.id, groupCapability.groupId))
		.where(
			and(eq(groupCapability.capability, cap), eq(group.kind, 'committee'), isNull(group.deletedAt))
		)
		.orderBy(group.name);
	if (carrying.length === 0) return { seats: [], committees: [] };

	const ids = carrying.map((c) => c.groupId);
	const [seats, grants] = await Promise.all([
		db
			.select({ member: memberRefColumns(), committeeName: group.name })
			.from(groupMember)
			.innerJoin(group, eq(group.id, groupMember.groupId))
			.innerJoin(user, eq(user.id, groupMember.userId))
			.where(
				and(
					inArray(groupMember.groupId, ids),
					eq(groupMember.status, 'active'),
					isNull(user.deletedAt)
				)
			),
		db
			.select({ groupId: groupCapability.groupId, capability: groupCapability.capability })
			.from(groupCapability)
			.where(inArray(groupCapability.groupId, ids))
	]);
	return {
		seats: seats.map((s) => ({ member: toMemberRef(s.member), committeeName: s.committeeName })),
		committees: carrying.map((c) => ({
			...c,
			held: grants.filter((g) => g.groupId === c.groupId).map((g) => g.capability as Capability)
		}))
	};
}

/** Holders of one position. */
export async function listHoldersOfPosition(position: Position): Promise<MemberRef[]> {
	return (await listPositionHolders([position])).map((h) => h.member);
}

/** Every member's newest grant of one clearance, lapsed and revoked included. */
export async function listClearanceHolders(
	certificationId: string,
	now = new Date()
): Promise<Array<ClearanceRow & { lapsing: boolean }>> {
	const rows = await listClearances({ certificationId });
	return rows.map((r) => ({ ...r, lapsing: isLapsing(r, now) }));
}
