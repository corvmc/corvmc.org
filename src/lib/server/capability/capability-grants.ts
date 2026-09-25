import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { group, groupMember } from '$lib/server/db/schema/group';
import { user } from '$lib/server/db/schema/authentication';
import { eventListing } from '$lib/server/db/schema/event';
import { volunteerRole, volunteerSignup, workOrder } from '$lib/server/db/schema/volunteer';
import { grantRuleFor, type Capability } from '$lib/config';
import { allowlisted, type CommitteeGrant } from '$lib/server/capability/grant-rules';

export {
	allowlisted,
	committeeAllows,
	type CapabilityScope,
	type CommitteeGrant
} from '$lib/server/capability/grant-rules';

const DAY_MS = 86_400_000;

/** A signup counts once staff have accepted it, and still counts once the shift is closed out. */
const GRANTING_SIGNUP_STATUSES = ['confirmed', 'completed'] as const;

/** The caller's active seats on live committees, each with what it grants. */
export async function committeeGrantsFor(userId: string): Promise<CommitteeGrant[]> {
	const rows = await db
		.select({ groupId: group.id, grants: group.capabilityGrants })
		.from(groupMember)
		.innerJoin(group, eq(group.id, groupMember.groupId))
		.where(
			and(
				eq(groupMember.userId, userId),
				eq(groupMember.status, 'active'),
				eq(group.kind, 'committee'),
				isNull(group.deletedAt)
			)
		);
	return rows.map((r) => ({
		groupId: r.groupId,
		capabilities: allowlisted(r.grants ?? [], 'committee')
	}));
}

/**
 * What these seats hold everywhere, for the nav and the panel gate: `'org'`
 * grants only. An `'owned'` grant needs a record in hand, which a nav row never has.
 */
export function orgWideCapabilities(seats: readonly CommitteeGrant[]): Capability[] {
	const caps = seats.flatMap((s) => s.capabilities);
	return [...new Set(caps)].filter((c) => grantRuleFor(c)?.committee === 'org') as Capability[];
}

/** Active members of every live committee that grants `cap` org-wide, for fan-out. */
export async function listCommitteeHolders(
	cap: Capability
): Promise<Array<{ id: string; name: string; email: string }>> {
	if (grantRuleFor(cap)?.committee !== 'org') return [];
	const rows = await db
		.select({ id: user.id, name: user.name, email: user.email, grants: group.capabilityGrants })
		.from(groupMember)
		.innerJoin(group, eq(group.id, groupMember.groupId))
		.innerJoin(user, eq(user.id, groupMember.userId))
		.where(
			and(
				eq(groupMember.status, 'active'),
				eq(group.kind, 'committee'),
				isNull(group.deletedAt),
				isNull(user.deletedAt)
			)
		);
	return rows
		.filter((r) => (r.grants ?? []).includes(cap))
		.map(({ id, name, email }) => ({ id, name, email }));
}

type ShiftWindowRow = {
	startsAt: Date | null;
	endsAt: Date | null;
	eventStartsAt: Date;
	eventEndsAt: Date | null;
};

/**
 * When a role grant from this shift is live: from the shift's start until
 * `graceDays` after it ends. An unscheduled work order borrows its event's times.
 */
export function grantWindow(row: ShiftWindowRow, graceDays: number): { from: Date; until: Date } {
	const from = row.startsAt ?? row.eventStartsAt;
	const end = row.endsAt ?? row.eventEndsAt ?? row.eventStartsAt;
	return { from, until: new Date(end.getTime() + graceDays * DAY_MS) };
}

/**
 * Does `userId` hold `cap` for `eventId` through a volunteer role? Needs a
 * confirmed or completed signup on a live work order for that event, in a role
 * that grants `cap`, with `now` inside the grant window.
 */
export async function roleGrantAllows(
	userId: string,
	cap: Capability,
	eventId: string,
	now: Date = new Date()
): Promise<boolean> {
	const rule = grantRuleFor(cap)?.role;
	if (!rule) return false;

	const rows = await db
		.select({
			grants: volunteerRole.capabilityGrants,
			startsAt: workOrder.startsAt,
			endsAt: workOrder.endsAt,
			eventStartsAt: eventListing.startsAt,
			eventEndsAt: eventListing.endsAt
		})
		.from(volunteerSignup)
		.innerJoin(workOrder, eq(workOrder.id, volunteerSignup.shiftId))
		.innerJoin(volunteerRole, eq(volunteerRole.id, workOrder.volunteerRoleId))
		.innerJoin(eventListing, eq(eventListing.id, workOrder.eventId))
		.where(
			and(
				eq(volunteerSignup.userId, userId),
				eq(workOrder.eventId, eventId),
				inArray(volunteerSignup.status, [...GRANTING_SIGNUP_STATUSES]),
				isNull(workOrder.cancelledAt)
			)
		);

	return rows.some((r) => {
		if (!(r.grants ?? []).includes(cap)) return false;
		const { from, until } = grantWindow(r, rule.graceDays);
		return now >= from && now <= until;
	});
}
