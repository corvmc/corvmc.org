import { and, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import { group, groupCapability, groupMember } from '#lib/server/db/schema/group.js';
import { user } from '#lib/server/db/schema/authentication.js';
import { projectCommittee } from '#lib/server/db/schema/project.js';
import { eventListing } from '#lib/server/db/schema/event.js';
import { production } from '#lib/server/db/schema/production.js';
import { TERMINAL_PRODUCTION_STATUSES } from '#lib/production/status.js';
import {
	volunteerRole,
	volunteerRoleCapability,
	volunteerShift,
	volunteerSignup,
	workOrder,
	workOrderAssignee
} from '#lib/server/db/schema/volunteer.js';
import { grantRuleFor, type Capability } from '#lib/config.js';
import { allowlisted, type CommitteeGrant } from '#lib/server/capability/grant-rules.js';

export {
	allowlisted,
	committeeAllows,
	type CapabilityScope,
	type CommitteeGrant
} from '#lib/server/capability/grant-rules.js';

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
 * The caller's active seats on live committees taking part in `projectId`,
 * each with what it grants. `'owned'` reach, resolved: a seat here may use its
 * committee's grants on this project whatever role the committee plays.
 */
export async function projectCommitteeGrantsFor(
	userId: string,
	projectId: string
): Promise<Array<CommitteeGrant & { slug: string }>> {
	const rows = await db
		.select({ groupId: group.id, slug: group.slug, capability: groupCapability.capability })
		.from(projectCommittee)
		.innerJoin(group, eq(group.id, projectCommittee.groupId))
		.innerJoin(groupMember, eq(groupMember.groupId, group.id))
		.innerJoin(groupCapability, eq(groupCapability.groupId, group.id))
		.where(
			and(
				eq(projectCommittee.projectId, projectId),
				eq(groupMember.userId, userId),
				eq(groupMember.status, 'active'),
				eq(group.kind, 'committee'),
				isNull(group.deletedAt)
			)
		);
	const bySeat = new Map<string, { slug: string; caps: string[] }>();
	for (const r of rows) {
		const seat = bySeat.get(r.groupId) ?? { slug: r.slug, caps: [] };
		seat.caps.push(r.capability);
		bySeat.set(r.groupId, seat);
	}
	return [...bySeat].map(([groupId, seat]) => ({
		groupId,
		slug: seat.slug,
		capabilities: allowlisted(seat.caps, 'committee')
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

/** What naming a person a show's event lead gives them on that show's project (#2726). */
export const SHOW_LEAD_CAPABILITY = 'production.run' satisfies Capability;

/** Is `userId` the event lead on the production that specialises `projectId`? */
export async function leadsProject(userId: string, projectId: string): Promise<boolean> {
	const [row] = await db
		.select({ id: production.id })
		.from(production)
		.where(and(eq(production.projectId, projectId), eq(production.producerUserId, userId)))
		.limit(1);
	return row != null;
}

/** Does `userId` lead any show that is not closed or cancelled? Opens the staff panel to them. */
export async function leadsOpenShow(userId: string): Promise<boolean> {
	const [row] = await db
		.select({ id: production.id })
		.from(production)
		.where(
			and(
				eq(production.producerUserId, userId),
				notInArray(production.status, [...TERMINAL_PRODUCTION_STATUSES])
			)
		)
		.limit(1);
	return row != null;
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
	/** The role's `grantLeadDays`; absent or zero opens the window at the shift's start. */
	leadDays?: number | null;
};

/**
 * When a role grant is live: from the shift's start, or `leadDays` before the
 * event when the role sets a lead time, until `graceDays` after it ends. An
 * assignment has no shift, so it borrows its task's event's times.
 */
export function grantWindow(row: ShiftWindowRow, graceDays: number): { from: Date; until: Date } {
	const start = row.startsAt ?? row.eventStartsAt;
	const lead = row.leadDays ?? 0;
	const early = new Date(row.eventStartsAt.getTime() - lead * DAY_MS);
	const from = lead > 0 && early < start ? early : start;
	const end = row.endsAt ?? row.eventEndsAt ?? row.eventStartsAt;
	return { from, until: new Date(end.getTime() + graceDays * DAY_MS) };
}

/**
 * Does `userId` hold `cap` for `eventId` through a volunteer role? Needs, on a
 * live task for that event in a role that grants `cap`, either a confirmed or
 * completed sign-up on a live shift (its window) or an assignment (the event's
 * window), with `now` inside the grant window (#2518), which opens early when
 * the role sets a lead time (#2993).
 */
export async function roleGrantAllows(
	userId: string,
	cap: Capability,
	eventId: string,
	now: Date = new Date()
): Promise<boolean> {
	const rule = grantRuleFor(cap)?.role;
	if (!rule) return false;

	const onTask = and(
		eq(volunteerRoleCapability.capability, cap),
		eq(workOrder.eventId, eventId),
		isNull(workOrder.cancelledAt)
	);
	const [signedUp, assigned] = await Promise.all([
		db
			.select({
				startsAt: volunteerShift.startsAt,
				endsAt: volunteerShift.endsAt,
				eventStartsAt: eventListing.startsAt,
				eventEndsAt: eventListing.endsAt,
				leadDays: volunteerRole.grantLeadDays
			})
			.from(volunteerSignup)
			.innerJoin(volunteerShift, eq(volunteerShift.id, volunteerSignup.shiftId))
			.innerJoin(workOrder, eq(workOrder.id, volunteerShift.workOrderId))
			.innerJoin(
				volunteerRoleCapability,
				eq(volunteerRoleCapability.volunteerRoleId, workOrder.volunteerRoleId)
			)
			.innerJoin(volunteerRole, eq(volunteerRole.id, workOrder.volunteerRoleId))
			.innerJoin(eventListing, eq(eventListing.id, workOrder.eventId))
			.where(
				and(
					onTask,
					eq(volunteerSignup.userId, userId),
					inArray(volunteerSignup.status, [...GRANTING_SIGNUP_STATUSES]),
					isNull(volunteerShift.cancelledAt)
				)
			),
		db
			.select({
				startsAt: sql<Date | null>`null`,
				endsAt: sql<Date | null>`null`,
				eventStartsAt: eventListing.startsAt,
				eventEndsAt: eventListing.endsAt,
				leadDays: volunteerRole.grantLeadDays
			})
			.from(workOrderAssignee)
			.innerJoin(workOrder, eq(workOrder.id, workOrderAssignee.workOrderId))
			.innerJoin(
				volunteerRoleCapability,
				eq(volunteerRoleCapability.volunteerRoleId, workOrder.volunteerRoleId)
			)
			.innerJoin(volunteerRole, eq(volunteerRole.id, workOrder.volunteerRoleId))
			.innerJoin(eventListing, eq(eventListing.id, workOrder.eventId))
			.where(and(onTask, eq(workOrderAssignee.userId, userId)))
	]);

	return [...signedUp, ...assigned].some((r) => {
		const { from, until } = grantWindow(r, rule.graceDays);
		return now >= from && now <= until;
	});
}
