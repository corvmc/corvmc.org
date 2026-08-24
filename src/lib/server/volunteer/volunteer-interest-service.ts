import { db } from '$lib/server/db';
import { volunteerRole, volunteerRoleInterest } from '$lib/server/db/schema/volunteer';
import { user } from '$lib/server/db/schema/authentication';
import { and, asc, count, eq, inArray, isNull, like, or, sql } from 'drizzle-orm';
import { DomainError } from '$lib/server/errors';
import { memberRefColumns, toMemberRef } from '$lib/server/entity/refs';
import type { MemberRef } from '$lib/types/entity';
import { paginate, type PaginationInput } from '$lib/server/db/paginate';
import { VOLUNTEER_MAX_INTERESTS } from '$lib/config';
import type { VolunteerRoleGroup } from '$lib/server/db/schema/volunteer';

// ---------------------------------------------------------------------------
// Volunteer role interests
// ---------------------------------------------------------------------------
// A member's standing "I'd help with this". The member owns the set outright —
// staff never edit it — so every mutation here is scoped to one userId and the
// only operation is "replace my set with this one".
// ---------------------------------------------------------------------------

export class VolunteerInterestValidationError extends DomainError {
	readonly httpStatus = 400;
	constructor(message: string) {
		super(message);
	}
}

// D1 rejects a statement with more than 100 bound parameters. Each interest row
// binds 3 (id, userId, roleId), so 25 rows is 75 — clear of the ceiling with
// room for drizzle's own additions.
const INSERT_CHUNK = 25;

// ASCII unit separator. group_concat needs a delimiter that cannot occur
// inside a staff-authored role name — a comma would split
// "Clean, maintain, and repair" into three badges.
const ROLE_NAME_SEPARATOR = String.fromCharCode(31);

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Replace a member's interest set.
 *
 * A checkbox form always posts the whole set, including the empty one — that is
 * how "take me off the list" arrives — so this diffs rather than appends.
 * Deleting the removed rows and inserting the added ones (instead of
 * delete-all-then-reinsert) keeps `createdAt` intact on the roles they kept,
 * which is the only signal of how long someone has been on the list.
 *
 * Two statements rather than a transaction: the lint rule forbids
 * `db.transaction()`, and the worst case if the second fails is that the member
 * sees an unchanged checkbox and saves again.
 */
export async function setInterests(userId: string, roleIds: string[]): Promise<void> {
	const wanted = [...new Set(roleIds)];

	if (wanted.length > VOLUNTEER_MAX_INTERESTS) {
		throw new VolunteerInterestValidationError(
			`You can express interest in at most ${VOLUNTEER_MAX_INTERESTS} roles.`
		);
	}

	// An archived role must not be selectable — it is not offered by the form, so
	// seeing one here means a stale page or a hand-crafted post.
	if (wanted.length > 0) {
		const live = await db
			.select({ id: volunteerRole.id })
			.from(volunteerRole)
			.where(and(inArray(volunteerRole.id, wanted), eq(volunteerRole.isActive, true)));

		if (live.length !== wanted.length) {
			throw new VolunteerInterestValidationError(
				'One of those roles is no longer available. Reload the page and try again.'
			);
		}
	}

	const existing = await db
		.select({ roleId: volunteerRoleInterest.volunteerRoleId })
		.from(volunteerRoleInterest)
		.where(eq(volunteerRoleInterest.userId, userId));

	const have = new Set(existing.map((r) => r.roleId));
	const toAdd = wanted.filter((id) => !have.has(id));
	const toRemove = [...have].filter((id) => !wanted.includes(id));

	if (toRemove.length > 0) {
		await db
			.delete(volunteerRoleInterest)
			.where(
				and(
					eq(volunteerRoleInterest.userId, userId),
					inArray(volunteerRoleInterest.volunteerRoleId, toRemove)
				)
			);
	}

	for (let i = 0; i < toAdd.length; i += INSERT_CHUNK) {
		await db
			.insert(volunteerRoleInterest)
			.values(
				toAdd.slice(i, i + INSERT_CHUNK).map((roleId) => ({ userId, volunteerRoleId: roleId }))
			)
			// Two saves racing each other would otherwise trip the unique index.
			.onConflictDoNothing();
	}
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** The role ids to tick on the member's own form. */
export async function getInterestsForUser(userId: string): Promise<string[]> {
	const rows = await db
		.select({ roleId: volunteerRoleInterest.volunteerRoleId })
		.from(volunteerRoleInterest)
		.where(eq(volunteerRoleInterest.userId, userId));

	return rows.map((r) => r.roleId);
}

/**
 * The same set with role names attached, for reading rather than editing.
 *
 * `getInterestsForUser` returns bare ids because the member's form ticks
 * checkboxes by id; a staff member looking at someone's record needs the names.
 */
export async function listInterestsForUser(
	userId: string
): Promise<{ roleId: string; roleName: string; group: VolunteerRoleGroup }[]> {
	return db
		.select({
			roleId: volunteerRole.id,
			roleName: volunteerRole.name,
			group: volunteerRole.group
		})
		.from(volunteerRoleInterest)
		.innerJoin(volunteerRole, eq(volunteerRole.id, volunteerRoleInterest.volunteerRoleId))
		.where(eq(volunteerRoleInterest.userId, userId))
		.orderBy(asc(volunteerRole.name));
}

/**
 * How many people are interested in each role — the count column on the staff
 * roles table.
 *
 * Archived roles included. The table lists them (behind "Include retired"), and
 * a retired role dropping to a blank count would read as "nobody wants this"
 * rather than "this isn't offered".
 */
export async function countInterestsByRole(): Promise<
	{ roleId: string; roleName: string; group: VolunteerRoleGroup; interested: number }[]
> {
	const rows = await db
		.select({
			roleId: volunteerRole.id,
			roleName: volunteerRole.name,
			group: volunteerRole.group,
			interested: count(volunteerRoleInterest.id)
		})
		.from(volunteerRole)
		.leftJoin(volunteerRoleInterest, eq(volunteerRoleInterest.volunteerRoleId, volunteerRole.id))
		.groupBy(volunteerRole.id)
		.orderBy(asc(volunteerRole.displayOrder), asc(volunteerRole.name));

	return rows.map((r) => ({ ...r, interested: Number(r.interested) }));
}

export interface InterestedMember {
	userId: string;
	/** Kept beside the ref: the page copies addresses to a clipboard, which is
	 *  the address as data rather than as the ref's subline. */
	email: string;
	member: MemberRef;
	roleNames: string[];
	since: Date;
}

/**
 * Members who have expressed interest, one row per member with their roles
 * collapsed into a list.
 *
 * The count is `count(distinct user_id)`, not `count()`: the data query groups
 * by member, so a plain count would return interest rows and inflate
 * `totalPages` — the same trap `getHoursByMember` documents.
 */
export async function listInterestedMembers(
	filters: { roleId?: string; search?: string } = {},
	pagination: PaginationInput = {}
) {
	// Filtering by role narrows which *members* appear, but each of them should
	// still show every role they picked. So the role filter is an EXISTS over a
	// second reference to the table rather than a WHERE on the joined rows.
	const matchesRole = filters.roleId
		? sql`exists (
				select 1 from "volunteer_role_interest" vri
				where vri."user_id" = ${user.id}
					and vri."volunteer_role_id" = ${filters.roleId}
			)`
		: undefined;

	// "Since" answers a different question either side of the role filter. Unfiltered
	// the table is about the member, so it's the earliest thing they ticked. Filtered
	// — which is how the role detail page reads it — it has to be when they ticked
	// *this* role, or someone who joined the door crew last week reads as a January
	// regular because that's when they ticked Merch.
	const since = filters.roleId
		? sql<number>`(
				select vri."created_at" from "volunteer_role_interest" vri
				where vri."user_id" = ${user.id}
					and vri."volunteer_role_id" = ${filters.roleId}
			)`
		: sql<number>`min(${volunteerRoleInterest.createdAt})`;

	const matchesSearch = filters.search
		? or(like(user.name, `%${filters.search}%`), like(user.email, `%${filters.search}%`))
		: undefined;

	// Deleted accounts keep their interest rows via the FK, but nobody should be
	// asked to work a door shift after closing their account.
	const where = and(isNull(user.deletedAt), matchesRole, matchesSearch);

	const dataQuery = db
		.select({
			userId: user.id,
			// Correlated subqueries — built per call, not at module scope, so
			// importing this module does no work (the trap hourLogSelect() documents).
			member: memberRefColumns(),
			roleNames: sql<string>`group_concat(${volunteerRole.name}, ${ROLE_NAME_SEPARATOR})`,
			since
		})
		.from(volunteerRoleInterest)
		.innerJoin(user, eq(user.id, volunteerRoleInterest.userId))
		.innerJoin(volunteerRole, eq(volunteerRole.id, volunteerRoleInterest.volunteerRoleId))
		.where(where)
		.groupBy(user.id)
		.orderBy(asc(user.name))
		.$dynamic();

	const countQuery = db
		.select({ count: sql<number>`count(distinct ${user.id})` })
		.from(volunteerRoleInterest)
		.innerJoin(user, eq(user.id, volunteerRoleInterest.userId))
		.where(where);

	const result = await paginate(dataQuery, countQuery, pagination);

	return {
		...result,
		rows: result.rows.map(
			(r): InterestedMember => ({
				userId: r.userId,
				email: r.member.email,
				member: toMemberRef(r.member),
				roleNames: String(r.roleNames).split(ROLE_NAME_SEPARATOR).sort(),
				since: new Date(Number(r.since) * 1000)
			})
		)
	};
}
