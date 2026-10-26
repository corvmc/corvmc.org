import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema/authentication';
import { group, groupMember } from '$lib/server/db/schema/group';
import { role, modelHasRole } from '$lib/server/db/schema/authorization';
import { instructor } from '$lib/server/db/schema/instructor';
import { containsLiteral } from '$lib/server/db/like';
import { positionOrder } from '$lib/config';
import {
	and,
	count,
	eq,
	exists,
	gte,
	inArray,
	isNotNull,
	isNull,
	not,
	or,
	sql,
	type SQL
} from 'drizzle-orm';

/** The Users table's "Active" status filter. Every ban also sets `deletedAt`. */
export const activeUser = (): SQL => isNull(user.deletedAt);

/** The Users table's "Deactivated" status filter. */
export const deactivatedUser = (): SQL => isNotNull(user.deletedAt);

/** A subscription snapshot is the sustaining-member source of truth. */
export const sustainingUser = (): SQL => isNotNull(user.subscription);

/** An active seat on a live band's roster; pending invites and applications are not membership. */
export const inBandUser = (): SQL =>
	exists(
		db
			.select({ one: sql`1` })
			.from(groupMember)
			.innerJoin(group, eq(group.id, groupMember.groupId))
			.where(
				and(
					eq(groupMember.userId, user.id),
					eq(groupMember.status, 'active'),
					eq(group.kind, 'band'),
					isNull(group.deletedAt)
				)
			)
	);

/** Holds any staff position (admin, staff, coordinators, treasurer, moderator). */
export const positionHolder = (): SQL =>
	exists(
		db
			.select({ one: sql`1` })
			.from(modelHasRole)
			.innerJoin(role, eq(role.id, modelHasRole.roleId))
			.where(and(eq(modelHasRole.userId, user.id), inArray(role.name, positionOrder)))
	);

/** Teaching here now: an approved listing that is not paused or retired. */
export const teachingInstructor = (): SQL =>
	exists(
		db
			.select({ one: sql`1` })
			.from(instructor)
			.where(and(eq(instructor.userId, user.id), eq(instructor.status, 'active')))
	);

export interface UserListFilters {
	search?: string;
	status?: 'active' | 'deactivated' | 'all';
	sustaining?: boolean;
	inBand?: boolean;
	staff?: boolean;
	instructor?: boolean;
}

const yesNo = (want: boolean | undefined, predicate: () => SQL) =>
	want === undefined ? undefined : want ? predicate() : not(predicate());

/** The Users table's WHERE, built from the same predicates the totals count by. */
export function userListWhere(filters: UserListFilters): SQL | undefined {
	const search = filters.search?.trim();
	const status = filters.status ?? 'active';
	return and(
		search
			? or(containsLiteral(user.name, search), containsLiteral(user.email, search))
			: undefined,
		status === 'active' ? activeUser() : status === 'deactivated' ? deactivatedUser() : undefined,
		yesNo(filters.sustaining, sustainingUser),
		yesNo(filters.inBand, inBandUser),
		yesNo(filters.staff, positionHolder),
		yesNo(filters.instructor, teachingInstructor)
	);
}

export const NEW_MEMBER_DAYS = 7;

export interface UserTotals {
	/** Active accounts only — deactivated and banned are not counted. */
	accounts: number;
	/** Active accounts with a subscription snapshot, the sustaining-member source of truth. */
	sustaining: number;
	/** Active accounts created in the last `NEW_MEMBER_DAYS` days. */
	newMembers: number;
}

const countWhere = (predicate: SQL | undefined) => count(sql`case when ${predicate} then 1 end`);

/** Org-wide account totals in one scan; deliberately blind to the Users table's filters. */
export async function getUserTotals(now = new Date()): Promise<UserTotals> {
	const since = new Date(now.getTime() - NEW_MEMBER_DAYS * 24 * 60 * 60 * 1000);
	const [row] = await db
		.select({
			accounts: countWhere(activeUser()),
			sustaining: countWhere(and(activeUser(), sustainingUser())),
			newMembers: countWhere(and(activeUser(), gte(user.createdAt, since)))
		})
		.from(user);
	return row ?? { accounts: 0, sustaining: 0, newMembers: 0 };
}
