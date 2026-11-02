import { and, count, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { INVITE_EXPIRY_DAYS, MEMBER_INVITE_DAILY_LIMIT, type GroupKind } from '$lib/config';
import { user } from '$lib/server/db/schema/authentication';
import { group } from '$lib/server/db/schema/group';
import { groupInvite } from '$lib/server/db/schema/group-invite';
import { memberInvite } from '$lib/server/db/schema/member-invite';
import { paginate } from '$lib/server/db/paginate';
import { DomainError } from '$lib/server/domain-error';
import { STAFF_GROUP_KINDS } from '$lib/server/group/group-service';
import { createInvite } from '$lib/server/group/group-invite-service';
import { domainEvents } from '$lib/server/event-bus/event-bus';

/** A chosen club or committee that is gone or was never one. */
export class MemberInviteGroupError extends DomainError {
	readonly httpStatus = 400;
	constructor() {
		super('One of the chosen groups is no longer open');
	}
}

export class MemberInviteLimitError extends DomainError {
	readonly httpStatus = 429;
	constructor() {
		super(`You can send ${MEMBER_INVITE_DAILY_LIMIT} invitations a day. Try again tomorrow.`);
	}
}

export class MemberInviteNotFoundError extends DomainError {
	readonly httpStatus = 404;
	constructor() {
		super('Invitation not found');
	}
}

/** Already accepted or revoked: usually two staff on the same row. */
export class MemberInviteNotPendingError extends DomainError {
	readonly httpStatus = 409;
	constructor() {
		super('That invitation is no longer pending');
	}
}

export type MemberInviteResult =
	| { kind: 'existing'; userId: string; name: string }
	| { kind: 'pending'; email: string }
	| { kind: 'invited'; email: string };

type InviteGroup = { id: string; name: string; kind: GroupKind };

const DAY_MS = 24 * 60 * 60 * 1000;

function expiry(now: Date): Date {
	return new Date(now.getTime() + INVITE_EXPIRY_DAYS * DAY_MS);
}

async function openGroups(groupIds: string[]): Promise<InviteGroup[]> {
	if (groupIds.length === 0) return [];
	return db
		.select({ id: group.id, name: group.name, kind: group.kind })
		.from(group)
		.where(
			and(
				inArray(group.id, groupIds),
				inArray(group.kind, [...STAFF_GROUP_KINDS]),
				isNull(group.deletedAt)
			)
		);
}

/**
 * Create or refresh the chosen groups' invites silently and send one email for
 * the lot. The link carries a group token when there is one, so the sign-up
 * page can name the group.
 */
async function send(
	email: string,
	name: string | null,
	groups: InviteGroup[],
	invitedBy: { id: string; name: string }
) {
	const tokens: string[] = [];
	for (const g of groups) {
		const invite = await createInvite(email, g.id, 'member', null, invitedBy.id, {
			notify: false
		});
		if (invite.token) tokens.push(invite.token);
	}
	await domainEvents.emit('member_invite.created', {
		email,
		name,
		invitedByName: invitedBy.name,
		groups: groups.map((g) => ({ name: g.name, kind: g.kind })),
		token: tokens[0] ?? null
	});
}

/**
 * Invite somebody with no account to join CMC. A `limited` caller (a member
 * without `user.invite`) is held to `MEMBER_INVITE_DAILY_LIMIT` sends a day.
 * A live pending invite for the address is reported rather than re-sent, so a
 * repeat is not a second email; staff resend from the list instead.
 */
export async function inviteMember(input: {
	email: string;
	name?: string | null;
	groupIds?: string[];
	invitedBy: { id: string; name: string };
	limited?: boolean;
}): Promise<MemberInviteResult> {
	const email = input.email.toLowerCase().trim();
	const name = input.name?.trim() || null;
	const groupIds = [...new Set(input.groupIds ?? [])];
	const now = new Date();

	const [existing] = await db
		.select({ id: user.id, name: user.name })
		.from(user)
		.where(eq(user.email, email))
		.limit(1);
	if (existing) return { kind: 'existing', userId: existing.id, name: existing.name };

	const [pending] = await db
		.select({ expiresAt: memberInvite.expiresAt })
		.from(memberInvite)
		.where(and(eq(memberInvite.email, email), eq(memberInvite.status, 'pending')))
		.limit(1);
	if (pending && pending.expiresAt > now) return { kind: 'pending', email };

	if (input.limited) {
		const [{ sent }] = await db
			.select({ sent: count() })
			.from(memberInvite)
			.where(
				and(
					eq(memberInvite.invitedById, input.invitedBy.id),
					gt(memberInvite.sentAt, new Date(now.getTime() - DAY_MS))
				)
			);
		if (sent >= MEMBER_INVITE_DAILY_LIMIT) throw new MemberInviteLimitError();
	}

	const groups = await openGroups(groupIds);
	if (groups.length !== groupIds.length) throw new MemberInviteGroupError();

	// An expired pending row is refreshed in place, under the partial index. The
	// target clause is a literal: SQLite will not match a bound `?` to it.
	const fields = {
		name,
		groupIds,
		invitedById: input.invitedBy.id,
		expiresAt: expiry(now),
		sentAt: now
	};
	await db
		.insert(memberInvite)
		.values({ email, status: 'pending', ...fields })
		.onConflictDoUpdate({
			target: memberInvite.email,
			targetWhere: sql`status = 'pending'`,
			set: fields
		});

	await send(email, name, groups, input.invitedBy);
	return { kind: 'invited', email };
}

async function pendingInvite(id: string) {
	const [row] = await db.select().from(memberInvite).where(eq(memberInvite.id, id)).limit(1);
	if (!row) throw new MemberInviteNotFoundError();
	if (row.status !== 'pending') throw new MemberInviteNotPendingError();
	return row;
}

/** Send the email again, with a fresh expiry on this invite and its groups'. */
export async function resendMemberInvite(id: string, sentBy: { id: string; name: string }) {
	const row = await pendingInvite(id);
	const now = new Date();
	// A group deleted since is dropped from the resend rather than refusing it.
	const groups = await openGroups(row.groupIds);
	await db
		.update(memberInvite)
		.set({ expiresAt: expiry(now), sentAt: now, groupIds: groups.map((g) => g.id) })
		.where(eq(memberInvite.id, id));
	await send(row.email, row.name, groups, sentBy);
}

/**
 * Revoke the invite and the group invites created with it. Signup stays open,
 * so this cannot stop them joining CMC; it stops them landing in those groups.
 */
export async function revokeMemberInvite(id: string, revokedById: string) {
	const row = await pendingInvite(id);
	const revokeInvite = db
		.update(memberInvite)
		.set({ status: 'revoked', revokedById, revokedAt: new Date() })
		.where(and(eq(memberInvite.id, id), eq(memberInvite.status, 'pending')));
	if (row.groupIds.length === 0) {
		await revokeInvite;
		return;
	}
	await db.batch([
		revokeInvite,
		db
			.update(groupInvite)
			.set({ status: 'revoked' })
			.where(
				and(
					eq(groupInvite.email, row.email),
					inArray(groupInvite.groupId, row.groupIds),
					eq(groupInvite.status, 'pending')
				)
			)
	]);
}

/** Mark this address's pending invite accepted. Runs on each new session. */
export async function resolveMemberInvite(userId: string, email: string): Promise<void> {
	await db
		.update(memberInvite)
		.set({ status: 'accepted', acceptedById: userId, acceptedAt: new Date() })
		.where(
			and(eq(memberInvite.email, email.toLowerCase().trim()), eq(memberInvite.status, 'pending'))
		);
}

export const memberInviteStatusFilters = ['pending', 'accepted', 'revoked'] as const;
export type MemberInviteStatusFilter = (typeof memberInviteStatusFilters)[number];

/** The staff list, newest send first. `expired` is a pending invite past its date. */
export async function listMemberInvites(filters: {
	status?: MemberInviteStatusFilter;
	page?: number;
}) {
	const where = filters.status ? eq(memberInvite.status, filters.status) : undefined;
	const result = await paginate(
		db
			.select({
				id: memberInvite.id,
				email: memberInvite.email,
				name: memberInvite.name,
				status: memberInvite.status,
				groupCount: sql<number>`json_array_length(${memberInvite.groupIds})`,
				expiresAt: memberInvite.expiresAt,
				sentAt: memberInvite.sentAt,
				invitedByName: user.name
			})
			.from(memberInvite)
			.leftJoin(user, eq(user.id, memberInvite.invitedById))
			.where(where)
			.orderBy(desc(memberInvite.sentAt), desc(memberInvite.id))
			.$dynamic(),
		db.select({ count: count() }).from(memberInvite).where(where),
		{ page: filters.page, pageSize: 25 }
	);
	const now = new Date();
	return {
		...result,
		rows: result.rows.map((r) => ({ ...r, expired: r.status === 'pending' && r.expiresAt <= now }))
	};
}

/** The clubs and committees an invitation can place somebody in. */
export async function listInviteGroups() {
	return db
		.select({ id: group.id, name: group.name, kind: group.kind })
		.from(group)
		.where(and(inArray(group.kind, [...STAFF_GROUP_KINDS]), isNull(group.deletedAt)))
		.orderBy(group.name);
}
