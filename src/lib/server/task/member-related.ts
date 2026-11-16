import { and, eq, gte, inArray, isNotNull, isNull, ne, or, type SQL } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import { group, groupMember } from '#lib/server/db/schema/group.js';
import { projectCommittee } from '#lib/server/db/schema/project.js';
import { eventListing, publicEventStatuses } from '#lib/server/db/schema/event.js';
import { visibleTo, type ListingViewer } from '#lib/server/event/visibility.js';
import {
	volunteerShift,
	volunteerSignup,
	workOrder,
	workOrderAssignee
} from '#lib/server/db/schema/volunteer.js';
import {
	listShifts,
	notOnCancelledListing,
	openTask
} from '#lib/server/volunteer/work-order-service.js';
import { getRequirementsForRoles } from '#lib/server/volunteer/volunteer-certification-service.js';
import {
	listHeldForGate,
	missingFrom
} from '#lib/server/volunteer/member-certification-service.js';
import {
	relatedTasks,
	relationsFor,
	type RelatedGroup,
	type RelatedSubject
} from './related-tasks';
import type { RelationKey } from '#lib/utils/related-tasks.js';

/**
 * The member side of a record's cards (#2630 phase 4). Tasks are narrowed to
 * the viewer's own: assigned to them, owned by a club or committee they sit on,
 * or on a project such a committee owns. Shifts are the volunteer board's, so
 * every member sees the same open shifts there and here.
 */

/** The member event page's rule: published or cancelled, and one `viewer` may see. */
export async function isPublicListing(eventId: string, viewer: ListingViewer): Promise<boolean> {
	const [row] = await db
		.select({ id: eventListing.id })
		.from(eventListing)
		.where(
			and(
				eq(eventListing.id, eventId),
				inArray(eventListing.status, [...publicEventStatuses]),
				visibleTo(viewer)
			)
		)
		.limit(1);
	return row !== undefined;
}

/** The groups the user is an active roster member of, bands aside. */
function seatsOf(userId: string) {
	return db
		.select({ id: groupMember.groupId })
		.from(groupMember)
		.innerJoin(group, eq(group.id, groupMember.groupId))
		.where(
			and(
				eq(groupMember.userId, userId),
				eq(groupMember.status, 'active'),
				ne(group.kind, 'band'),
				isNull(group.deletedAt)
			)
		);
}

export function memberTaskWhere(userId: string): SQL {
	const seats = seatsOf(userId);
	const projects = db
		.select({ id: projectCommittee.projectId })
		.from(projectCommittee)
		.where(inArray(projectCommittee.groupId, seats));
	const assigned = db
		.select({ id: workOrderAssignee.workOrderId })
		.from(workOrderAssignee)
		.where(eq(workOrderAssignee.userId, userId));
	return or(
		inArray(workOrder.id, assigned),
		inArray(workOrder.groupId, seats),
		inArray(workOrder.projectId, projects)
	) as SQL;
}

export async function memberRelatedTasks(
	subject: RelatedSubject,
	userId: string,
	opts: { includeDone?: boolean; now?: Date } = {}
): Promise<{ groups: RelatedGroup[]; mine: string[] }> {
	const groups = await relatedTasks(subject, { ...opts, where: memberTaskWhere(userId) });
	const ids = groups.flatMap((g) => g.tasks.map((t) => t.id));
	// Only an assignee can open a task on the member side, so those rows link.
	const mine =
		ids.length === 0
			? []
			: (
					await db
						.select({ id: workOrderAssignee.workOrderId })
						.from(workOrderAssignee)
						.where(
							and(eq(workOrderAssignee.userId, userId), inArray(workOrderAssignee.workOrderId, ids))
						)
				).map((r) => r.id);
	return { groups, mine };
}

/** One shift as a member's row: no roster, assignees or staff notes. */
export interface MemberShift {
	id: string;
	shiftId: string;
	title: string | null;
	roleName: string | null;
	eventId: string | null;
	eventTitle: string | null;
	notes: string | null;
	startsAt: Date;
	endsAt: Date;
	capacity: number;
	claimed: number;
	confirmed: number;
	signup: {
		/** The viewer's own sign-up on it, when they have one. */
		status: string | null;
		id: string | null;
		/** Clearances the role needs that the viewer will not hold on the day. */
		missing: string[];
	};
}

export interface MemberShiftGroup {
	key: RelationKey;
	shifts: MemberShift[];
	more: boolean;
}

export async function memberRelatedShifts(
	subject: RelatedSubject,
	userId: string,
	{ now = new Date(), limitPerRelation = 30 }: { now?: Date; limitPerRelation?: number } = {}
): Promise<MemberShiftGroup[]> {
	const relations = relationsFor(subject);
	// The board's own rule: a role to sign up as, not started, nothing called off.
	const board = and(
		isNotNull(workOrder.volunteerRoleId),
		openTask(),
		notOnCancelledListing(),
		gte(volunteerShift.startsAt, now)
	);
	const results = await Promise.all(
		relations.map((r) =>
			listShifts({ where: and(r.where, board) as SQL, limit: limitPerRelation + 1 })
		)
	);

	const seen = new Set<string>();
	const picked = relations.map((r, i) => {
		const rows = results[i].slice(0, limitPerRelation).filter((s) => !seen.has(s.shiftId));
		for (const s of rows) seen.add(s.shiftId);
		return { key: r.key, rows, more: results[i].length > limitPerRelation };
	});
	const all = picked.flatMap((p) => p.rows);
	if (all.length === 0) return [];

	const [signups, requirements, held] = await Promise.all([
		db
			.select({
				id: volunteerSignup.id,
				shiftId: volunteerSignup.shiftId,
				status: volunteerSignup.status
			})
			.from(volunteerSignup)
			.where(
				and(
					eq(volunteerSignup.userId, userId),
					inArray(volunteerSignup.shiftId, [...seen]),
					ne(volunteerSignup.status, 'cancelled')
				)
			),
		getRequirementsForRoles([...new Set(all.map((s) => s.volunteerRoleId!))]),
		listHeldForGate(userId)
	]);
	const mineByShift = new Map(signups.map((s) => [s.shiftId, s]));

	return picked
		.filter((p) => p.rows.length > 0)
		.map((p) => ({
			key: p.key,
			more: p.more,
			shifts: p.rows.map((s): MemberShift => {
				const mine = mineByShift.get(s.shiftId);
				return {
					id: s.id,
					shiftId: s.shiftId,
					title: s.title,
					roleName: s.roleName,
					eventId: s.eventId,
					eventTitle: s.eventTitle,
					notes: s.notes,
					startsAt: s.startsAt,
					endsAt: s.endsAt,
					capacity: s.capacity,
					claimed: s.claimed,
					confirmed: s.confirmed,
					signup: {
						status: mine?.status ?? null,
						id: mine?.id ?? null,
						missing: mine
							? []
							: missingFrom(requirements.get(s.volunteerRoleId!) ?? [], held, s.startsAt).map(
									(c) => c.name
								)
					}
				};
			})
		}));
}
