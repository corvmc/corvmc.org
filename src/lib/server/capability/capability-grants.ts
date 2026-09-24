import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { group, groupMember } from '$lib/server/db/schema/group';
import { eventListing } from '$lib/server/db/schema/event';
import { volunteerRole, volunteerSignup, workOrder } from '$lib/server/db/schema/volunteer';
import { grantRuleFor, type Capability } from '$lib/config';

/**
 * What a guard is acting on, when it is acting on something.
 *
 * `eventId` admits a volunteer-role grant for that event. `groupId` names the
 * committee that owns the record, which is what an `'owned'` committee grant
 * needs. Both come from the record being acted on, never from the request.
 */
export type CapabilityScope = { eventId?: string | null; groupId?: string | null };

/** One active committee seat and the allowlisted capabilities it carries. */
export type CommitteeGrant = { groupId: string; capabilities: string[] };

const DAY_MS = 86_400_000;

/** A signup counts once staff have accepted it, and still counts once the shift is closed out. */
const GRANTING_SIGNUP_STATUSES = ['confirmed', 'completed'] as const;

/** Keep only entries the allowlist still lets `carrier` hold. */
export function allowlisted(caps: readonly string[], carrier: 'role' | 'committee'): string[] {
	return caps.filter((c) => grantRuleFor(c)?.[carrier] !== undefined);
}

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
 * Do these seats allow `cap`? An `'org'` grant counts anywhere; an `'owned'`
 * one only when `scope.groupId` names the seat's own committee.
 */
export function committeeAllows(
	seats: readonly CommitteeGrant[],
	cap: Capability,
	scope?: CapabilityScope
): boolean {
	const reach = grantRuleFor(cap)?.committee;
	if (!reach) return false;
	return seats.some(
		(s) => s.capabilities.includes(cap) && (reach === 'org' || s.groupId === scope?.groupId)
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
