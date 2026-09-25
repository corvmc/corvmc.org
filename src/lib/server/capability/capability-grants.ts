import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { group, groupCapability, groupMember } from '$lib/server/db/schema/group';
import { user } from '$lib/server/db/schema/authentication';
import { eventListing } from '$lib/server/db/schema/event';
import {
	volunteerRoleCapability,
	volunteerSignup,
	workOrder
} from '$lib/server/db/schema/volunteer';
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

/** The caller's active seats on live committees that grant anything, each with what it grants. */
export async function committeeGrantsFor(userId: string): Promise<CommitteeGrant[]> {
	const rows = await db
		.select({ groupId: group.id, capability: groupCapability.capability })
		.from(groupMember)
		.innerJoin(group, eq(group.id, groupMember.groupId))
		.innerJoin(groupCapability, eq(groupCapability.groupId, group.id))
		.where(
			and(
				eq(groupMember.userId, userId),
				eq(groupMember.status, 'active'),
				eq(group.kind, 'committee'),
				isNull(group.deletedAt)
			)
		);
	const bySeat = new Map<string, string[]>();
	for (const r of rows) bySeat.set(r.groupId, [...(bySeat.get(r.groupId) ?? []), r.capability]);
	return [...bySeat].map(([groupId, caps]) => ({
		groupId,
		capabilities: allowlisted(caps, 'committee')
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
	return db
		.select({ id: user.id, name: user.name, email: user.email })
		.from(groupMember)
		.innerJoin(group, eq(group.id, groupMember.groupId))
		.innerJoin(user, eq(user.id, groupMember.userId))
		.innerJoin(groupCapability, eq(groupCapability.groupId, group.id))
		.where(
			and(
				eq(groupCapability.capability, cap),
				eq(groupMember.status, 'active'),
				eq(group.kind, 'committee'),
				isNull(group.deletedAt),
				isNull(user.deletedAt)
			)
		);
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
			startsAt: workOrder.startsAt,
			endsAt: workOrder.endsAt,
			eventStartsAt: eventListing.startsAt,
			eventEndsAt: eventListing.endsAt
		})
		.from(volunteerSignup)
		.innerJoin(workOrder, eq(workOrder.id, volunteerSignup.shiftId))
		.innerJoin(
			volunteerRoleCapability,
			eq(volunteerRoleCapability.volunteerRoleId, workOrder.volunteerRoleId)
		)
		.innerJoin(eventListing, eq(eventListing.id, workOrder.eventId))
		.where(
			and(
				eq(volunteerRoleCapability.capability, cap),
				eq(volunteerSignup.userId, userId),
				eq(workOrder.eventId, eventId),
				inArray(volunteerSignup.status, [...GRANTING_SIGNUP_STATUSES]),
				isNull(workOrder.cancelledAt)
			)
		);

	return rows.some((r) => {
		const { from, until } = grantWindow(r, rule.graceDays);
		return now >= from && now <= until;
	});
}
