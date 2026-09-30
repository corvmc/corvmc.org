import {
	and,
	asc,
	count,
	eq,
	gte,
	inArray,
	isNotNull,
	isNull,
	lte,
	or,
	sql,
	type SQL
} from 'drizzle-orm';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema/authentication';
import { artifactRequest } from '$lib/server/db/schema/artifact-request';
import { eventListing } from '$lib/server/db/schema/event';
import { group, groupMember } from '$lib/server/db/schema/group';
import { mediaAttachment } from '$lib/server/db/schema/media';
import {
	volunteerRole,
	volunteerSignup,
	workOrder,
	workTask
} from '$lib/server/db/schema/volunteer';
import { DomainError } from '$lib/server/domain-error';
import type { WorkDoneCondition } from '$lib/config';
import { evaluateDone, type DeliverableState } from './done-conditions';
import { assertOwningCommittee } from './duty-list-service';

/**
 * A committee's deliverables: the work orders it answers for (#1701). Reads for
 * the committee's Open items tab and the show's Deliverables card, and the one
 * write that is not already a work-order write, handing an item on.
 */

export class DeliverableNotFoundError extends DomainError {
	readonly httpStatus = 404;
	constructor() {
		super('That item is not open any more');
	}
}

export interface DeliverableRow {
	id: string;
	/** The item's own title, falling back to its role's name. */
	title: string;
	eventId: string | null;
	eventTitle: string | null;
	eventStartsAt: Date | null;
	dueAt: Date | null;
	groupId: string | null;
	groupName: string | null;
	doneWhen: WorkDoneCondition | null;
	state: DeliverableState;
	assignees: { userId: string; name: string }[];
	tasks: { id: string; label: string; done: boolean }[];
	/** Poster art has come in and the show still has no poster: waiting on its use, not its making. */
	artAwaitingUse: boolean;
}

/** A deliverable is committee-owned work, or work the show's list gave a done condition. */
const isDeliverable = or(isNotNull(workOrder.groupId), isNotNull(workOrder.doneWhen))!;

async function readDeliverables(where: SQL): Promise<DeliverableRow[]> {
	const rows = await db
		.select({
			id: workOrder.id,
			title: sql<string>`coalesce(${workOrder.title}, ${volunteerRole.name})`,
			eventId: workOrder.eventId,
			eventTitle: eventListing.title,
			eventStartsAt: eventListing.startsAt,
			dueAt: workOrder.dueAt,
			groupId: workOrder.groupId,
			groupName: group.name,
			doneWhen: workOrder.doneWhen,
			resolvedAt: workOrder.resolvedAt,
			cancelledAt: workOrder.cancelledAt
		})
		.from(workOrder)
		.innerJoin(volunteerRole, eq(volunteerRole.id, workOrder.volunteerRoleId))
		.leftJoin(eventListing, eq(eventListing.id, workOrder.eventId))
		.leftJoin(group, eq(group.id, workOrder.groupId))
		.where(where)
		.orderBy(sql`${workOrder.dueAt} is null`, asc(workOrder.dueAt), asc(workOrder.id));
	if (rows.length === 0) return [];

	const ids = rows.map((r) => r.id);
	const [states, signups, tasks, art] = await Promise.all([
		evaluateDone(rows),
		db
			.select({ workOrderId: volunteerSignup.shiftId, userId: user.id, name: user.name })
			.from(volunteerSignup)
			.innerJoin(user, eq(user.id, volunteerSignup.userId))
			.where(
				and(
					inArray(volunteerSignup.shiftId, ids),
					inArray(volunteerSignup.status, ['claimed', 'confirmed', 'completed'])
				)
			)
			.orderBy(asc(user.name)),
		db
			.select({
				workOrderId: workTask.workOrderId,
				id: workTask.id,
				label: workTask.label,
				done: workTask.done
			})
			.from(workTask)
			.where(inArray(workTask.workOrderId, ids))
			.orderBy(asc(workTask.sortOrder)),
		eventsWithDeliveredPosterArt(
			rows.filter((r) => r.doneWhen === 'poster_set').flatMap((r) => r.eventId ?? [])
		)
	]);

	const group_ = <T extends { workOrderId: string }>(list: T[]) => {
		const by = new Map<string, Omit<T, 'workOrderId'>[]>();
		for (const { workOrderId, ...rest } of list) {
			by.set(workOrderId, [...(by.get(workOrderId) ?? []), rest]);
		}
		return by;
	};
	const assignees = group_(signups);
	const checklist = group_(tasks);

	return rows.map((r) => {
		const state = states.get(r.id)!;
		return {
			id: r.id,
			title: r.title,
			eventId: r.eventId,
			eventTitle: r.eventTitle,
			eventStartsAt: r.eventStartsAt,
			dueAt: r.dueAt,
			groupId: r.groupId,
			groupName: r.groupName,
			doneWhen: r.doneWhen,
			state,
			assignees: assignees.get(r.id) ?? [],
			tasks: checklist.get(r.id) ?? [],
			artAwaitingUse:
				r.doneWhen === 'poster_set' &&
				(state === 'open' || state === 'overdue') &&
				r.eventId !== null &&
				art.has(r.eventId)
		};
	});
}

/** Shows among these with delivered poster art on a live ask. */
async function eventsWithDeliveredPosterArt(eventIds: string[]): Promise<Set<string>> {
	if (eventIds.length === 0) return new Set();
	const rows = await db
		.selectDistinct({ eventId: artifactRequest.eventId })
		.from(artifactRequest)
		.innerJoin(
			mediaAttachment,
			and(
				eq(mediaAttachment.attachableType, 'artifact_request'),
				eq(mediaAttachment.attachableId, artifactRequest.id),
				eq(mediaAttachment.slot, 'poster')
			)
		)
		.where(
			and(
				inArray(artifactRequest.eventId, eventIds),
				eq(artifactRequest.artifact, 'poster_art'),
				isNull(artifactRequest.cancelledAt)
			)
		);
	return new Set(rows.map((r) => r.eventId));
}

const live = and(isNull(workOrder.resolvedAt), isNull(workOrder.cancelledAt))!;

/**
 * Everything this committee owns that is still open or overdue, across every
 * show, soonest due first. What a condition already satisfies is left out.
 */
export async function listCommitteeOpenItems(groupId: string): Promise<DeliverableRow[]> {
	const rows = await readDeliverables(and(eq(workOrder.groupId, groupId), live)!);
	return rows.filter((r) => r.state === 'open' || r.state === 'overdue');
}

/** Whether the committee has anything unfinished at all: enough to decide whether its tab shows. */
export async function countCommitteeUnfinished(groupId: string): Promise<number> {
	const [row] = await db
		.select({ n: count() })
		.from(workOrder)
		.where(and(eq(workOrder.groupId, groupId), live));
	return row?.n ?? 0;
}

/** Every deliverable on one show, done and cancelled included, for the console's card. */
export async function listShowDeliverables(eventId: string): Promise<DeliverableRow[]> {
	return readDeliverables(and(eq(workOrder.eventId, eventId), isDeliverable)!);
}

/** What a guard needs to know about an item: who owns it, and which show it is on. */
export async function getDeliverableOwner(
	id: string
): Promise<{ groupId: string | null; eventId: string | null; projectId: string | null } | null> {
	const [row] = await db
		.select({
			groupId: workOrder.groupId,
			eventId: workOrder.eventId,
			projectId: workOrder.projectId
		})
		.from(workOrder)
		.where(eq(workOrder.id, id))
		.limit(1);
	return row ?? null;
}

/** The item a task sits on, for guarding a tick. */
export async function getTaskWorkOrderId(taskId: string): Promise<string | null> {
	const [row] = await db
		.select({ id: workTask.workOrderId })
		.from(workTask)
		.where(eq(workTask.id, taskId))
		.limit(1);
	return row?.id ?? null;
}

/** Hand an open item to another committee, or back to staff with null. */
export async function reassignDeliverable(id: string, groupId: string | null): Promise<void> {
	const owner = await assertOwningCommittee(groupId);
	const result = await db
		.update(workOrder)
		.set({ groupId: owner, updatedAt: new Date() })
		.where(and(eq(workOrder.id, id), live))
		.returning({ id: workOrder.id });
	if (result.length === 0) throw new DeliverableNotFoundError();
}

// ---------------------------------------------------------------------------
// Cancellation and reminders
// ---------------------------------------------------------------------------

export interface OpenOwnedItem {
	id: string;
	eventId: string;
	title: string;
	groupId: string;
}

/**
 * The committee-owned items still open or overdue on these shows. Read before a
 * cancellation moves anything: a cancelled production no longer reads as
 * confirmed, and a cancelled listing no longer reads as published.
 */
export async function listOpenOwnedOnShows(eventIds: string[]): Promise<OpenOwnedItem[]> {
	if (eventIds.length === 0) return [];
	const rows = await readDeliverables(
		and(inArray(workOrder.eventId, eventIds), isNotNull(workOrder.groupId), live)!
	);
	return rows
		.filter((r) => r.state === 'open' || r.state === 'overdue')
		.map((r) => ({ id: r.id, eventId: r.eventId!, title: r.title, groupId: r.groupId! }));
}

/** Call these items off, by whoever cancelled the show. Already-closed ones are left alone. */
export async function cancelDeliverables(
	ids: string[],
	cancelledByUserId: string | null
): Promise<void> {
	if (ids.length === 0) return;
	const now = new Date();
	await db
		.update(workOrder)
		.set({ cancelledAt: now, cancelledByUserId, updatedAt: now })
		.where(and(inArray(workOrder.id, ids), live));
}

export interface Recipient {
	userId: string;
	userName: string;
	userEmail: string;
}

/** Active seats on these live committees, keyed by committee, one row per seat. */
export async function committeeSeats(
	groupIds: string[]
): Promise<Map<string, (Recipient & { groupSlug: string })[]>> {
	const bySeat = new Map<string, (Recipient & { groupSlug: string })[]>();
	if (groupIds.length === 0) return bySeat;
	const rows = await db
		.select({
			groupId: group.id,
			groupSlug: group.slug,
			userId: user.id,
			userName: user.name,
			userEmail: user.email
		})
		.from(group)
		.innerJoin(groupMember, eq(groupMember.groupId, group.id))
		.innerJoin(user, eq(user.id, groupMember.userId))
		.where(
			and(
				inArray(group.id, groupIds),
				eq(group.kind, 'committee'),
				isNull(group.deletedAt),
				eq(groupMember.status, 'active'),
				isNull(user.deletedAt)
			)
		)
		.orderBy(asc(user.name), asc(user.id));
	for (const { groupId, ...seat } of rows) {
		bySeat.set(groupId, [...(bySeat.get(groupId) ?? []), seat]);
	}
	return bySeat;
}

export interface DueDeliverable {
	id: string;
	title: string;
	dueAt: Date;
	eventTitle: string | null;
	groupName: string;
	groupSlug: string;
	/** Its live assignees, or the owning committee's active members when nobody has it. */
	recipients: Recipient[];
}

/** Committee-owned items due in `[from, to]` that are not already done, and whom to tell. */
export async function listDeliverablesDueBetween(from: Date, to: Date): Promise<DueDeliverable[]> {
	const rows = await readDeliverables(
		and(isNotNull(workOrder.groupId), live, gte(workOrder.dueAt, from), lte(workOrder.dueAt, to))!
	);
	const owed = rows.filter((r) => r.state === 'open' || r.state === 'overdue');
	if (owed.length === 0) return [];

	const assigneeIds = [...new Set(owed.flatMap((r) => r.assignees.map((a) => a.userId)))];
	const groupIds = [...new Set(owed.map((r) => r.groupId!))];
	const [people, slugs, seats] = await Promise.all([
		assigneeIds.length
			? db
					.select({ userId: user.id, userName: user.name, userEmail: user.email })
					.from(user)
					.where(and(inArray(user.id, assigneeIds), isNull(user.deletedAt)))
			: Promise.resolve([]),
		db.select({ id: group.id, slug: group.slug }).from(group).where(inArray(group.id, groupIds)),
		committeeSeats(groupIds)
	]);
	const person = new Map(people.map((p) => [p.userId, p]));
	const slugOf = new Map(slugs.map((g) => [g.id, g.slug]));

	return owed.map((r) => ({
		id: r.id,
		title: r.title,
		dueAt: r.dueAt!,
		eventTitle: r.eventTitle,
		groupName: r.groupName ?? '',
		groupSlug: slugOf.get(r.groupId!) ?? '',
		recipients:
			r.assignees.length > 0
				? r.assignees.flatMap((a) => person.get(a.userId) ?? [])
				: (seats.get(r.groupId!) ?? []).map(({ userId, userName, userEmail }) => ({
						userId,
						userName,
						userEmail
					}))
	}));
}
