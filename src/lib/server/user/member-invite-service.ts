import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema/authentication';
import { group } from '$lib/server/db/schema/group';
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

export type MemberInviteResult =
	{ kind: 'existing'; userId: string; name: string } | { kind: 'invited'; email: string };

/**
 * Invite somebody with no account to join CMC (#1830). Fire-and-forget at the
 * org level: signup is open, so there is nothing to gate or revoke. Chosen
 * groups become `group_invite` rows, which do expire and are listed per group.
 */
export async function inviteMember(input: {
	email: string;
	name?: string | null;
	groupIds?: string[];
	invitedBy: { id: string; name: string };
}): Promise<MemberInviteResult> {
	const email = input.email.toLowerCase().trim();
	const groupIds = [...new Set(input.groupIds ?? [])];

	const [existing] = await db
		.select({ id: user.id, name: user.name })
		.from(user)
		.where(eq(user.email, email))
		.limit(1);
	if (existing) return { kind: 'existing', userId: existing.id, name: existing.name };

	const groups =
		groupIds.length === 0
			? []
			: await db
					.select({ id: group.id, name: group.name, kind: group.kind })
					.from(group)
					.where(
						and(
							inArray(group.id, groupIds),
							inArray(group.kind, [...STAFF_GROUP_KINDS]),
							isNull(group.deletedAt)
						)
					);
	if (groups.length !== groupIds.length) throw new MemberInviteGroupError();

	const tokens: string[] = [];
	for (const g of groups) {
		const invite = await createInvite(email, g.id, 'member', null, input.invitedBy.id, {
			notify: false
		});
		if (invite.token) tokens.push(invite.token);
	}

	// One email for the lot: the group invites above were created silently.
	await domainEvents.emit('member_invite.created', {
		email,
		name: input.name?.trim() || null,
		invitedByName: input.invitedBy.name,
		groups: groups.map((g) => ({ name: g.name, kind: g.kind })),
		token: tokens[0] ?? null
	});
	return { kind: 'invited', email };
}

/** The clubs and committees an invitation can place somebody in. */
export async function listInviteGroups() {
	return db
		.select({ id: group.id, name: group.name, kind: group.kind })
		.from(group)
		.where(and(inArray(group.kind, [...STAFF_GROUP_KINDS]), isNull(group.deletedAt)))
		.orderBy(group.name);
}
