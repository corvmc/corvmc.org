import { and, eq, inArray, isNotNull, isNull, like, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { db } from '$lib/server/db';
import { group, groupMember } from '$lib/server/db/schema/group';
import { user } from '$lib/server/db/schema/authentication';
import { directoryEntry } from '$lib/server/db/schema/directory';
import { memberRefColumns, toMemberRef } from '$lib/server/entity/refs';
import { create as createGroupRow, deactivate, reactivate } from '$lib/server/band/band-service';
import { paginate, type PaginationInput } from '$lib/server/db/paginate';
import { DomainError } from '$lib/server/domain-error';
import type { GroupKind, GroupJoinPolicy } from '$lib/config';
import type { DirectoryVisibility } from '$lib/server/db/schema/authentication';

/**
 * Clubs and committees — the staff-run half of the groups module.
 *
 * Everything about a roster, an address and a listing is shared with bands and
 * lives in `band-service.ts`; what is here is the part that differs, which is
 * governance rather than behaviour:
 *
 * | | `band` | `club`, `committee` |
 * | --- | --- | --- |
 * | Created by | any member, self-service | **staff only**, from `/staff/groups` |
 * | Owner | the creator | **appointed by staff** |
 * | Deleted by | its owner | staff only |
 * | Join policy | always `invite_only` | any of the three |
 *
 * The existence of the row *is* the sanction: staff created it and staff
 * appointed whoever runs it. That is what makes free room time (phase 9) safe to
 * grant by kind — the abuse case, spin up a fake club and collect free room
 * time, is closed structurally rather than by a check someone has to remember.
 *
 * See docs/specs/groups-spec.md.
 */

/** Kinds this module governs. A band is created by its own member, not here. */
export const STAFF_GROUP_KINDS = ['club', 'committee'] as const satisfies readonly GroupKind[];
export type StaffGroupKind = (typeof STAFF_GROUP_KINDS)[number];

export class NotAStaffGroupError extends DomainError {
	readonly httpStatus = 422;

	constructor() {
		super('Bands are created by their own members, not from the staff panel.');
		this.name = 'NotAStaffGroupError';
	}
}

export class LeaderNotFoundError extends DomainError {
	readonly httpStatus = 422;

	constructor() {
		super('Pick a member to lead this group.');
		this.name = 'LeaderNotFoundError';
	}
}

export class NotJoinableError extends DomainError {
	readonly httpStatus = 422;

	constructor(message: string) {
		super(message);
		this.name = 'NotJoinableError';
	}
}

export class AlreadyOnRosterError extends DomainError {
	readonly httpStatus = 409;

	constructor() {
		super('You are already on this roster.');
		this.name = 'AlreadyOnRosterError';
	}
}

export class GroupNotFoundError extends DomainError {
	readonly httpStatus = 404;

	constructor() {
		super('Group not found');
		this.name = 'GroupNotFoundError';
	}
}

const ownerMember = alias(groupMember, 'group_owner_member');

/**
 * The staff group detail read.
 *
 * Distinct from `getByIdWithDetails`, which is the staff *band* read and carries
 * tier and subscription — a program has neither. What it carries instead is the
 * pair that decides how the program is found and joined: `joinPolicy` from the
 * group, and `visibility` from its listing.
 *
 * Both joins are LEFT. An ownerless group is legal, and a group whose entry went
 * missing is exactly the one staff need to be able to open — an inner join would
 * empty the page of a program that plainly exists.
 */
export async function getGroupDetail(groupId: string) {
	const [row] = await db
		.select({
			id: group.id,
			kind: group.kind,
			name: group.name,
			slug: group.slug,
			bio: group.bio,
			avatarKey: group.avatarKey,
			joinPolicy: group.joinPolicy,
			joinInstructions: group.joinInstructions,
			visibility: directoryEntry.visibility,
			ownerId: ownerMember.userId,
			owner: memberRefColumns(),
			createdAt: group.createdAt,
			updatedAt: group.updatedAt,
			deletedAt: group.deletedAt,
			memberCount: sql<number>`count(case when ${groupMember.status} = 'active' then 1 end)`
		})
		.from(group)
		.leftJoin(
			ownerMember,
			and(
				eq(ownerMember.groupId, group.id),
				eq(ownerMember.role, 'owner'),
				eq(ownerMember.status, 'active')
			)
		)
		.leftJoin(user, eq(user.id, ownerMember.userId))
		.leftJoin(directoryEntry, eq(directoryEntry.groupId, group.id))
		.leftJoin(groupMember, eq(groupMember.groupId, group.id))
		.where(eq(group.id, groupId))
		.groupBy(group.id);

	if (!row) return null;
	return {
		...row,
		// A group with no entry has no visibility to read. That should be
		// impossible — `create` writes one in the same batch — but reading as
		// hidden is the safe direction: it withholds a listing rather than
		// publishing one nobody chose to publish.
		visibility: row.visibility ?? ('hidden' as const),
		owner: toMemberRef(row.owner)
	};
}

/**
 * The staff group list.
 *
 * Its own query rather than `listAll`'s, and the reason is the row's link. That
 * one builds a `toBandRef`, whose canonical staff page is `/staff/bands/{id}` —
 * correct for a band and wrong for a club, which would send staff to a band page
 * for a group that is not one. Bolting a kind branch onto a band-shaped read
 * would leave a band-shaped ref sitting in a group query's payload for the next
 * person to trust.
 *
 * So this selects what a program list needs — kind and leader, no tier — and the
 * page renders the name itself.
 */
export async function listGroups(
	opts?: { search?: string; status?: 'active' | 'deactivated'; kinds?: readonly StaffGroupKind[] },
	pagination: PaginationInput = {}
) {
	const conditions = [inArray(group.kind, [...(opts?.kinds ?? STAFF_GROUP_KINDS)])];

	if (opts?.search) conditions.push(like(group.name, `%${opts.search}%`));
	if (opts?.status === 'active') conditions.push(isNull(group.deletedAt));
	else if (opts?.status === 'deactivated') conditions.push(isNotNull(group.deletedAt));

	const where = and(...conditions);

	const dataQ = db
		.select({
			id: group.id,
			kind: group.kind,
			name: group.name,
			slug: group.slug,
			avatarKey: group.avatarKey,
			joinPolicy: group.joinPolicy,
			ownerId: ownerMember.userId,
			owner: memberRefColumns(),
			createdAt: group.createdAt,
			deletedAt: group.deletedAt,
			memberCount: sql<number>`count(case when ${groupMember.status} = 'active' then 1 end)`
		})
		.from(group)
		// LEFT, like the band list's: a program with an empty owner seat is legal,
		// and this page is precisely where staff are meant to see one.
		.leftJoin(
			ownerMember,
			and(
				eq(ownerMember.groupId, group.id),
				eq(ownerMember.role, 'owner'),
				eq(ownerMember.status, 'active')
			)
		)
		.leftJoin(user, eq(user.id, ownerMember.userId))
		.leftJoin(groupMember, eq(groupMember.groupId, group.id))
		.where(where)
		.groupBy(group.id)
		.orderBy(group.name)
		.$dynamic();

	const countQ = db
		.select({ count: sql<number>`count(*)` })
		.from(group)
		.where(where);

	const { rows, pagination: page } = await paginate(dataQ, countQ, pagination);
	return {
		rows: rows.map((r) => ({ ...r, owner: toMemberRef(r.owner) })),
		pagination: page
	};
}

/**
 * The `/member/groups` index, in one query.
 *
 * It answers two questions on one page — "where do I go" and "where else could
 * I go" — because scoping it to your own memberships would strand discovery on a
 * route nobody with a membership ever opens, and an `open` join policy only
 * existing members can see is not open at all.
 *
 * One read, not four. Four sections is precisely the shape that tempts a
 * per-section remote query fanned out of a section component, which is what
 * `docs/checklists/remote-query-fanout.md` exists to stop.
 *
 * **No bands, in any section.** A band is a group in the data model, but this
 * page exists to answer *what can I be part of* and a band has no answer to
 * give: bands are always `invite_only`, so they could never appear under
 * discovery, and a member's own bands already have `/member/bands`, their own
 * panel and their own sidebar group.
 */
export async function listMemberGroups(userId: string) {
	const mine = alias(groupMember, 'my_membership');

	const rows = await db
		.select({
			id: group.id,
			kind: group.kind,
			name: group.name,
			slug: group.slug,
			bio: group.bio,
			avatarKey: group.avatarKey,
			joinPolicy: group.joinPolicy,
			joinInstructions: group.joinInstructions,
			visibility: directoryEntry.visibility,
			myRole: mine.role,
			myStatus: mine.status,
			memberCount: sql<number>`count(case when ${groupMember.status} = 'active' then 1 end)`
		})
		.from(group)
		// LEFT on my own row: the same query has to return the groups I am in and
		// the ones I am not, and which is which is exactly what this join answers.
		.leftJoin(mine, and(eq(mine.groupId, group.id), eq(mine.userId, userId)))
		.leftJoin(directoryEntry, eq(directoryEntry.groupId, group.id))
		.leftJoin(groupMember, eq(groupMember.groupId, group.id))
		.where(and(inArray(group.kind, [...STAFF_GROUP_KINDS]), isNull(group.deletedAt)))
		.groupBy(group.id)
		.orderBy(group.name);

	// A group I am not in shows only if its listing is at least members-visible.
	// A hidden program is one staff are running quietly; being in it is what
	// makes it visible, which is why the filter runs after the membership join
	// rather than in the WHERE.
	const discoverable = (r: (typeof rows)[number]) => r.visibility !== 'hidden';

	return {
		/** Everything I hold a row in, whatever its status. */
		mine: rows.filter((r) => r.myStatus !== null),
		/**
		 * The three discovery sections, split by the door each group opens.
		 * `invite_only` is listed with its instructions and no action: seeing that
		 * a committee exists is the point, and the way in is a conversation.
		 */
		open: rows.filter((r) => r.myStatus === null && r.joinPolicy === 'open' && discoverable(r)),
		byApplication: rows.filter(
			(r) => r.myStatus === null && r.joinPolicy === 'by_application' && discoverable(r)
		),
		inviteOnly: rows.filter(
			(r) => r.myStatus === null && r.joinPolicy === 'invite_only' && discoverable(r)
		)
	};
}

/**
 * The public group directory, and one group's public page.
 *
 * `'public'` visibility only — `'members'` is the member index's business and
 * `'hidden'` is nobody's. That is the same `directory_entry.visibility` a band
 * is listed through at `/directory/bands`, which is the whole point of a club
 * having an entry rather than a second listing shape: one column decides who
 * can see a listing, whatever kind of thing the listing is for.
 */
export async function listPublicGroups(kinds?: readonly StaffGroupKind[]) {
	return db
		.select({
			id: group.id,
			kind: group.kind,
			name: group.name,
			slug: group.slug,
			bio: group.bio,
			avatarKey: group.avatarKey,
			joinPolicy: group.joinPolicy,
			joinInstructions: group.joinInstructions,
			memberCount: sql<number>`count(case when ${groupMember.status} = 'active' then 1 end)`
		})
		.from(group)
		.innerJoin(
			directoryEntry,
			and(eq(directoryEntry.groupId, group.id), eq(directoryEntry.visibility, 'public'))
		)
		.leftJoin(groupMember, eq(groupMember.groupId, group.id))
		.where(and(inArray(group.kind, [...(kinds ?? STAFF_GROUP_KINDS)]), isNull(group.deletedAt)))
		.groupBy(group.id)
		.orderBy(group.name);
}

/**
 * This viewer's row on this group, whatever its status — including the two
 * waiting ones, which `getUserRole` deliberately does not return.
 *
 * The public page needs the difference: somebody with a `'requested'` row is
 * not a member and `requireGroupRole` resolves nothing for them, but offering
 * them Apply again would be wrong. Null means no row at all.
 */
export async function getUserGroupStatus(groupId: string, userId: string) {
	const [row] = await db
		.select({ status: groupMember.status, role: groupMember.role })
		.from(groupMember)
		.where(and(eq(groupMember.groupId, groupId), eq(groupMember.userId, userId)))
		.limit(1);
	return row ?? null;
}

/** One public group page. Null rather than throwing, so the route owns the 404. */
export async function getPublicGroup(slug: string) {
	const [row] = await db
		.select({
			id: group.id,
			kind: group.kind,
			name: group.name,
			slug: group.slug,
			bio: group.bio,
			avatarKey: group.avatarKey,
			joinPolicy: group.joinPolicy,
			joinInstructions: group.joinInstructions,
			memberCount: sql<number>`count(case when ${groupMember.status} = 'active' then 1 end)`
		})
		.from(group)
		// INNER, and on `visibility = 'public'`: a members-only or hidden program
		// has no public page, and the join is what makes that structural rather
		// than a filter someone has to remember to apply.
		.innerJoin(
			directoryEntry,
			and(eq(directoryEntry.groupId, group.id), eq(directoryEntry.visibility, 'public'))
		)
		.leftJoin(groupMember, eq(groupMember.groupId, group.id))
		.where(
			and(
				eq(group.slug, slug),
				inArray(group.kind, [...STAFF_GROUP_KINDS]),
				isNull(group.deletedAt)
			)
		)
		.groupBy(group.id)
		.limit(1);

	return row ?? null;
}

export interface CreateGroupData {
	kind: StaffGroupKind;
	name: string;
	bio?: string;
	/** The member who will run it. Appointed, not invited — see `assignLeader`. */
	leaderId: string;
}

/**
 * Create a club or committee and appoint its leader.
 *
 * The appointee never had to opt in, which is deliberate: staff are recording an
 * arrangement that already exists offline, so the owner row lands `active` with
 * nothing to accept. They can leave or hand off afterwards like any owner.
 */
export async function createGroup(data: CreateGroupData) {
	if (!STAFF_GROUP_KINDS.includes(data.kind)) throw new NotAStaffGroupError();
	if (!data.leaderId) throw new LeaderNotFoundError();

	// `create` writes the group, the owner row and the directory entry in one
	// batch, and skips the `band_site` row for a non-band kind. The leader is the
	// owner from the first write rather than a second one, so there is no window
	// in which the group exists with an empty owner seat.
	return createGroupRow(data.leaderId, { kind: data.kind, name: data.name, bio: data.bio });
}

export interface UpdateGroupSettings {
	joinPolicy?: GroupJoinPolicy;
	joinInstructions?: string | null;
	visibility?: DirectoryVisibility;
}

/**
 * The two settings that decide how a program is found and joined.
 *
 * `joinPolicy` and `joinInstructions` are the group's own; `visibility` belongs
 * to its listing, which is why this writes two tables. A club is findable at
 * `/groups` through the same `directory_entry` a band is findable through at
 * `/directory/bands`, so there is one visibility rather than two that can
 * disagree.
 */
export async function updateGroupSettings(groupId: string, settings: UpdateGroupSettings) {
	const writes = [];

	const groupUpdates: Record<string, unknown> = {};
	if (settings.joinPolicy !== undefined) groupUpdates.joinPolicy = settings.joinPolicy;
	if (settings.joinInstructions !== undefined) {
		groupUpdates.joinInstructions = settings.joinInstructions || null;
	}
	if (Object.keys(groupUpdates).length > 0) {
		groupUpdates.updatedAt = new Date();
		writes.push(db.update(group).set(groupUpdates).where(eq(group.id, groupId)));
	}

	if (settings.visibility !== undefined) {
		writes.push(
			db
				.update(directoryEntry)
				.set({ visibility: settings.visibility, updatedAt: new Date() })
				.where(eq(directoryEntry.groupId, groupId))
		);
	}

	if (writes.length === 0) return;
	// `db.batch`, never `db.transaction` — the latter is broken on D1.
	await db.batch(writes as [(typeof writes)[number], ...typeof writes]);
}

/**
 * Move the owner seat, with no participation from whoever holds it.
 *
 * This is what makes it distinct from `transferOwnership`, which is an owner
 * handing the group on and is scoped to the acting owner's own row. A program
 * leader who has gone quiet cannot be the one to name their replacement, so the
 * staff path demotes whoever is there — if anyone is — and promotes the
 * appointee.
 *
 * The appointee may not be on the roster at all, so this inserts when they are
 * not. The partial unique index on `(groupId) WHERE role = 'owner'` is what
 * makes the demote-then-promote order load-bearing: promoting first would
 * momentarily give the group two owner rows and be refused.
 */
export async function assignLeader(groupId: string, userId: string) {
	const [row] = await db.select({ id: group.id }).from(group).where(eq(group.id, groupId)).limit(1);
	if (!row) throw new GroupNotFoundError();

	const [existing] = await db
		.select({ id: groupMember.id, role: groupMember.role })
		.from(groupMember)
		.where(and(eq(groupMember.groupId, groupId), eq(groupMember.userId, userId)))
		.limit(1);

	await db.batch([
		// Demote the incumbent, if there is one. An ownerless group is legal — a
		// program whose leader stepped down and whose replacement has not been
		// appointed — so this matching nothing is a normal outcome, not a failure.
		db
			.update(groupMember)
			.set({ role: 'admin', updatedAt: new Date() })
			.where(
				and(
					eq(groupMember.groupId, groupId),
					eq(groupMember.role, 'owner'),
					ne(groupMember.userId, userId)
				)
			),
		existing
			? db
					.update(groupMember)
					.set({ role: 'owner', status: 'active', updatedAt: new Date() })
					.where(eq(groupMember.id, existing.id))
			: db.insert(groupMember).values({
					groupId,
					userId,
					role: 'owner',
					// Appointed, not invited: there is nothing for them to accept.
					status: 'active'
				})
	]);
}

/**
 * Join a group unaided, or ask to.
 *
 * **The policy is re-read from the resolved group, never taken from the
 * request.** That is what makes three doors no riskier than two: which door is
 * open is the group's own fact, and a caller naming a group cannot also tell the
 * service how to let them in.
 *
 * A self-join always produces `role: 'member'` — owners and admins cannot
 * self-assign — and the `unique(groupId, userId)` index makes a double-click
 * idempotent rather than a second row.
 */
export async function joinGroup(groupId: string, userId: string) {
	const [row] = await db
		.select({ joinPolicy: group.joinPolicy, kind: group.kind })
		.from(group)
		.where(and(eq(group.id, groupId), isNull(group.deletedAt)))
		.limit(1);
	if (!row) throw new GroupNotFoundError();

	// The status the policy leads to. `open` lands you active with no approval —
	// the whole point of a drop-in program; `by_application` parks you at
	// `'requested'`, which is `'pending'`'s mirror and is why the two are
	// separate values.
	const status =
		row.joinPolicy === 'open'
			? ('active' as const)
			: row.joinPolicy === 'by_application'
				? ('requested' as const)
				: null;

	if (!status) {
		throw new NotJoinableError('This group is invite only — someone in it has to add you.');
	}

	const [existing] = await db
		.select({ id: groupMember.id })
		.from(groupMember)
		.where(and(eq(groupMember.groupId, groupId), eq(groupMember.userId, userId)))
		.limit(1);
	if (existing) throw new AlreadyOnRosterError();

	await db.insert(groupMember).values({
		groupId,
		userId,
		role: 'member',
		status,
		// Nobody invited them. The column is what tells an invitation from an
		// application apart when both are waiting.
		invitedById: null
	});

	return { status };
}

/**
 * An owner or admin answering an application.
 *
 * Approving is the same status flip `acceptInvite` performs, arriving from the
 * other direction; declining deletes the row, exactly as revoking an invitation
 * does. The `groupId` scope is not decoration: the member id comes from the
 * client, and an admin's authority stops at their own group.
 */
export async function approveApplication(memberId: string, groupId: string) {
	const scope = and(
		eq(groupMember.id, memberId),
		eq(groupMember.groupId, groupId),
		eq(groupMember.status, 'requested')
	);

	const [row] = await db.select({ id: groupMember.id }).from(groupMember).where(scope).limit(1);
	if (!row) throw new GroupNotFoundError();

	await db.update(groupMember).set({ status: 'active', updatedAt: new Date() }).where(scope);
}

export async function declineApplication(memberId: string, groupId: string) {
	await db
		.delete(groupMember)
		.where(
			and(
				eq(groupMember.id, memberId),
				eq(groupMember.groupId, groupId),
				eq(groupMember.status, 'requested')
			)
		);
}

/**
 * Leave a program, or withdraw an application to one.
 *
 * **A program leader may leave without naming a successor**, and this is the one
 * place programs and bands diverge on leaving. A band owner must transfer first,
 * because nobody's job it is to pick up an orphaned band. A program leader was
 * *appointed*, and the body that appointed them is still there — so "find your
 * own replacement" would trap someone in a volunteer role they have already said
 * they are done with. The seat goes empty, `/staff/groups` flags it, and the
 * program keeps running: nothing about it depends on the owner row existing.
 */
export async function leaveGroup(groupId: string, userId: string) {
	// No owner check, deliberately — see above. `leaveBand` has one and keeps it.
	const [row] = await db
		.select({ id: groupMember.id })
		.from(groupMember)
		.where(and(eq(groupMember.groupId, groupId), eq(groupMember.userId, userId)))
		.limit(1);
	if (!row) throw new GroupNotFoundError();

	await db
		.delete(groupMember)
		.where(and(eq(groupMember.groupId, groupId), eq(groupMember.userId, userId)));
}

/**
 * Ending a program is staff's call, and it is a deactivation rather than a
 * delete. An appointed leader runs the program; they do not own it, which is the
 * same reason they could not create it.
 *
 * Re-exported rather than reimplemented — a group's soft delete is the same
 * write whatever its kind, and `deactivate` already carries the entry alongside
 * it so a deactivated group leaves the directory.
 */
export { deactivate, reactivate };
