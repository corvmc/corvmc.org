import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { containsLiteral } from '$lib/server/db/like';
import { alias } from 'drizzle-orm/sqlite-core';
import { db } from '$lib/server/db';
import { group, groupMember } from '$lib/server/db/schema/group';
import { user } from '$lib/server/db/schema/authentication';
import { directoryEntry } from '$lib/server/db/schema/directory';
import { memberRefColumns, toMemberRef } from '$lib/server/entity/refs';
import { recordAuditEntry } from '$lib/server/audit/audit-service';
import type { MemberRef } from '$lib/types/entity';
import { create as createGroupRow, deactivate, reactivate } from '$lib/server/band/band-service';
import { sanitizeBio } from '$lib/utils/markdown';
import { paginate, type PaginationInput } from '$lib/server/db/paginate';
import { DomainError } from '$lib/server/domain-error';
import { groupGrantsColumn } from '$lib/server/capability/grant-columns';
import { openApplicationCount } from '$lib/server/group/application-service';
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
 * | Created by | any member, self-service | **staff only**, from `/staff/clubs` |
 * | Run by | one owner, the creator | **chairs**: any number of admins, staff-appointed |
 * | Deleted by | its owner | staff only |
 * | Join policy | always `invite_only` | any of the three |
 *
 * The existence of the row *is* the sanction: staff created it and staff
 * appoint its chairs; a program never has an `owner` row. That is what makes
 * free room time (phase 9) safe to grant by kind — the abuse case, spin up a fake club and collect free room
 * time, is closed structurally rather than by a check someone has to remember.
 *
 * See docs/specs/shipped/groups-spec.md.
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

export class NotJoinableError extends DomainError {
	readonly httpStatus = 422;

	constructor(message: string) {
		super(message);
		this.name = 'NotJoinableError';
	}
}

export class ApplyInsteadError extends DomainError {
	readonly httpStatus = 422;

	constructor() {
		super('This group takes applications. Apply to join it instead.');
		this.name = 'ApplyInsteadError';
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

export class NotOnRosterError extends DomainError {
	readonly httpStatus = 404;

	constructor() {
		super('That member is not on this roster.');
		this.name = 'NotOnRosterError';
	}
}

/**
 * Each group's chairs: its active admins, by name. One read for a whole page
 * of groups. A program with none is legal and maps to an empty list.
 */
async function chairsByGroup(groupIds: string[]): Promise<Map<string, MemberRef[]>> {
	const chairs = new Map<string, MemberRef[]>(groupIds.map((id) => [id, []]));
	if (groupIds.length === 0) return chairs;
	const rows = await db
		.select({ groupId: groupMember.groupId, chair: memberRefColumns() })
		.from(groupMember)
		.innerJoin(user, eq(user.id, groupMember.userId))
		.where(
			and(
				inArray(groupMember.groupId, groupIds),
				eq(groupMember.role, 'admin'),
				eq(groupMember.status, 'active')
			)
		)
		.orderBy(user.name, user.id);
	for (const r of rows) chairs.get(r.groupId)?.push(toMemberRef(r.chair));
	return chairs;
}

/**
 * The staff group detail read.
 *
 * Distinct from `getByIdWithDetails`, which is the staff *band* read and carries
 * tier and subscription — a program has neither. What it carries instead is the
 * pair that decides how the program is found and joined: `joinPolicy` from the
 * group, and `visibility` from its listing.
 *
 * The entry join is LEFT: a group whose entry went
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
			capabilityGrants: groupGrantsColumn(),
			visibility: directoryEntry.visibility,
			createdAt: group.createdAt,
			updatedAt: group.updatedAt,
			deletedAt: group.deletedAt,
			memberCount: sql<number>`count(case when ${groupMember.status} = 'active' then 1 end)`
		})
		.from(group)
		.leftJoin(directoryEntry, eq(directoryEntry.groupId, group.id))
		.leftJoin(groupMember, eq(groupMember.groupId, group.id))
		.where(eq(group.id, groupId))
		.groupBy(group.id);

	if (!row) return null;
	const chairs = await chairsByGroup([row.id]);
	return {
		...row,
		// A group with no entry has no visibility to read. That should be
		// impossible — `create` writes one in the same batch — but reading as
		// hidden is the safe direction: it withholds a listing rather than
		// publishing one nobody chose to publish.
		visibility: row.visibility ?? ('hidden' as const),
		chairs: chairs.get(row.id) ?? []
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
 * So this selects what a program list needs — kind and chairs, no tier — and the
 * page renders the name itself.
 */
export async function listGroups(
	opts?: { search?: string; status?: 'active' | 'deactivated'; kinds?: readonly StaffGroupKind[] },
	pagination: PaginationInput = {}
) {
	const conditions = [inArray(group.kind, [...(opts?.kinds ?? STAFF_GROUP_KINDS)])];

	if (opts?.search) conditions.push(containsLiteral(group.name, opts.search));
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
			createdAt: group.createdAt,
			deletedAt: group.deletedAt,
			memberCount: sql<number>`count(case when ${groupMember.status} = 'active' then 1 end)`,
			// Open applications, whatever the kind.
			openApplications: openApplicationCount(group.id)
		})
		.from(group)
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
	const chairs = await chairsByGroup(rows.map((r) => r.id));
	return {
		rows: rows.map((r) => ({
			...r,
			chairs: chairs.get(r.id) ?? [],
			openApplications: Number(r.openApplications ?? 0)
		})),
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
 * `custom/no-concurrent-remote-queries` (`docs/development/conventions.md`) exists to stop.
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
 * This viewer's row on this group, whatever its status — including a pending
 * invitation, which `getUserRole` deliberately does not return. Null means no
 * row at all; an open application is `hasOpenApplication`'s question.
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
	/**
	 * Its first chair, added as an active admin: appointed, not invited.
	 * Omitted leaves it with no chair, which is legal; `setChairRole` adds one.
	 */
	chairId?: string | null;
	/**
	 * Set at creation, so a program is never briefly listed and unjoinable. Both
	 * stay staff's for its life — `updateGroupSettings` is the other writer.
	 */
	joinPolicy: GroupJoinPolicy;
	joinInstructions?: string | null;
	visibility: DirectoryVisibility;
}

/** Create a club or committee, with or without a first chair. */
export async function createGroup(data: CreateGroupData) {
	if (!STAFF_GROUP_KINDS.includes(data.kind)) throw new NotAStaffGroupError();

	// `create` writes the group, the first roster row and the directory entry in
	// one batch; for a non-band kind that row is `admin`, never `owner`.
	// `|| null`, not `??`: a blank form field arrives as an empty string.
	return createGroupRow(data.chairId || null, {
		kind: data.kind,
		name: data.name,
		bio: data.bio,
		joinPolicy: data.joinPolicy,
		joinInstructions: data.joinInstructions,
		visibility: data.visibility
	});
}

export interface UpdateGroupProfile {
	name?: string;
	bio?: string | null;
	joinInstructions?: string | null;
}

/**
 * What a program's own chairs may change about it.
 *
 * Deliberately not `joinPolicy` or `visibility`: those decide who may walk in
 * and whether the program is advertised, and the spec's own argument for free
 * room time is that only staff decide who runs a program and on what terms.
 * `updateGroupSettings` is their one writer.
 */
// `name` and `bio` are mirrored onto `directory_entry` for the same reason
// band-service `update` mirrors them: the directory orders and searches on the
// copy, so writing only `group` leaves the old name showing indefinitely.
export async function updateGroupProfile(groupId: string, data: UpdateGroupProfile) {
	const groupUpdates: Record<string, unknown> = { updatedAt: new Date() };
	const entryUpdates: Record<string, unknown> = { updatedAt: new Date() };

	if (data.name !== undefined) {
		groupUpdates.name = data.name;
		entryUpdates.name = data.name;
	}
	if (data.bio !== undefined) {
		const bio = data.bio ? sanitizeBio(data.bio).slice(0, 2000) || null : null;
		groupUpdates.bio = bio;
		entryUpdates.bio = bio;
	}
	if (data.joinInstructions !== undefined) {
		groupUpdates.joinInstructions = data.joinInstructions || null;
	}

	// `db.batch`, never `db.transaction` — the latter is broken on D1. No
	// existence check: the caller's guard has already resolved the group, and
	// `updateGroupSettings` beside this makes the same assumption.
	await db.batch([
		db.update(group).set(groupUpdates).where(eq(group.id, groupId)),
		db.update(directoryEntry).set(entryUpdates).where(eq(directoryEntry.groupId, groupId))
	]);
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
 * Staff make a program member a chair (`admin`) or take it away (`member`).
 * Adding a chair who is not on the roster inserts them active: appointed, not
 * invited. Demoting someone who is not on it is a 404. Never writes `owner`.
 */
export async function setChairRole(groupId: string, userId: string, role: 'admin' | 'member') {
	const [target] = await db
		.select({ id: group.id, kind: group.kind, name: group.name })
		.from(group)
		.where(eq(group.id, groupId))
		.limit(1);
	if (!target) throw new GroupNotFoundError();
	if (!(STAFF_GROUP_KINDS as readonly string[]).includes(target.kind)) {
		throw new NotAStaffGroupError();
	}

	const [existing] = await db
		.select({ id: groupMember.id, role: groupMember.role, name: user.name })
		.from(groupMember)
		.innerJoin(user, eq(user.id, groupMember.userId))
		.where(and(eq(groupMember.groupId, groupId), eq(groupMember.userId, userId)))
		.limit(1);

	let memberName = existing?.name ?? null;
	if (existing) {
		if (existing.role === role) return;
		await db
			.update(groupMember)
			.set({ role, updatedAt: new Date() })
			.where(eq(groupMember.id, existing.id));
	} else {
		if (role !== 'admin') throw new NotOnRosterError();
		const [person] = await db
			.select({ name: user.name })
			.from(user)
			.where(eq(user.id, userId))
			.limit(1);
		if (!person) throw new NotOnRosterError();
		memberName = person.name;
		await db.insert(groupMember).values({ groupId, userId, role, status: 'active' });
	}

	await recordAuditEntry({
		action: 'group.role_changed',
		subject: { type: 'group', id: groupId, label: target.name },
		details: { userId, memberName: memberName ?? 'Unknown member', role, added: !existing }
	});
}

/**
 * Join an `open` group unaided.
 *
 * **The policy is re-read from the resolved group, never taken from the
 * request**: which door is open is the group's own fact, and a caller naming a
 * group cannot also tell the service how to let them in.
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

	// `by_application` is `submitApplication`'s door, with answers and a
	// decision; the UI never posts one here.
	if (row.joinPolicy === 'by_application') throw new ApplyInsteadError();
	if (row.joinPolicy !== 'open') {
		throw new NotJoinableError('This group is invite only — someone in it has to add you.');
	}

	const [existing] = await db
		.select({ id: groupMember.id })
		.from(groupMember)
		.where(and(eq(groupMember.groupId, groupId), eq(groupMember.userId, userId)))
		.limit(1);
	if (existing) throw new AlreadyOnRosterError();

	const status = 'active' as const;
	await db.insert(groupMember).values({
		groupId,
		userId,
		role: 'member',
		status,
		// Nobody invited them.
		invitedById: null
	});

	return { status };
}

/**
 * Leave a program.
 *
 * **A program chair may leave without naming a successor**, and this is the one
 * place programs and bands diverge on leaving. A band owner must transfer first,
 * because nobody's job it is to pick up an orphaned band. A program chair was
 * *appointed*, and the body that appointed them is still there — so "find your
 * own replacement" would trap someone in a volunteer role they have already said
 * they are done with. The program keeps running with whatever chairs remain,
 * none included: staff appoint more from its staff page.
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
 * delete. An appointed chair runs the program; they do not own it, which is the
 * same reason they could not create it.
 *
 * Re-exported rather than reimplemented — a group's soft delete is the same
 * write whatever its kind, and `deactivate` already carries the entry alongside
 * it so a deactivated group leaves the directory.
 */
export { deactivate, reactivate };

/**
 * The committees and clubs a member is actually on.
 *
 * For the hour log's program picker. Bands are excluded: a band is its own
 * members' business, not volunteering for the Collective.
 */
export async function listMyPrograms(userId: string) {
	return db
		.select({ id: group.id, name: group.name, kind: group.kind })
		.from(group)
		.innerJoin(groupMember, eq(groupMember.groupId, group.id))
		.where(
			and(
				isNull(group.deletedAt),
				inArray(group.kind, [...STAFF_GROUP_KINDS]),
				eq(groupMember.userId, userId),
				eq(groupMember.status, 'active')
			)
		)
		.orderBy(group.name);
}

/**
 * Clubs and committees, as picker options.
 *
 * Never bands: a band is a member's own project, and a CMC event is never run
 * by one. `/staff/bands` is that surface.
 */
export async function listProgramGroupOptions(): Promise<{ id: string; name: string }[]> {
	return db
		.select({ id: group.id, name: group.name })
		.from(group)
		.where(and(inArray(group.kind, [...STAFF_GROUP_KINDS]), isNull(group.deletedAt)))
		.orderBy(group.name);
}
