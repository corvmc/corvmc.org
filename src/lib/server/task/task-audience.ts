import { and, asc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import { user } from '#lib/server/db/schema/authentication.js';
import { eventListing } from '#lib/server/db/schema/event.js';
import {
	group,
	groupMember,
	groupPosition,
	groupPositionHolder
} from '#lib/server/db/schema/group.js';
import { production } from '#lib/server/db/schema/production.js';
import { workOrder } from '#lib/server/db/schema/volunteer.js';
import { listUsersWithCapability } from '#lib/server/authorization.js';
import type { Capability } from '#lib/config.js';

/**
 * Who hears about a task (#2983 rule 7): the holders of the position it is
 * tagged for, else its committee's seats, and only when neither exists every
 * holder of the capability. `taskAudiences` is the first two steps, for a
 * caller with its own fallback; `taskNoticeRecipients` is all three.
 */

export interface TaskRecipient {
	userId: string;
	userName: string;
	userEmail: string;
}

export interface TaskAudience {
	via: 'position' | 'department';
	recipients: TaskRecipient[];
}

const person = { userId: user.id, userName: user.name, userEmail: user.email };

/** Active roster rows on live committees, with a live account. */
const liveSeat = () =>
	and(
		eq(groupMember.status, 'active'),
		eq(group.kind, 'committee'),
		isNull(group.deletedAt),
		isNull(user.deletedAt)
	);

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
	map.set(key, [...(map.get(key) ?? []), value]);
}

/**
 * Each task's position holders, else its committee's seats. A task with
 * neither, or no committee, is absent from the map. The position counts only
 * when it is the task's own committee's, as in `canActOnTask`.
 */
export async function taskAudiences(ids: readonly string[]): Promise<Map<string, TaskAudience>> {
	const out = new Map<string, TaskAudience>();
	if (ids.length === 0) return out;
	const [held, seated] = await Promise.all([
		db
			.select({ id: workOrder.id, ...person })
			.from(workOrder)
			.innerJoin(
				groupPosition,
				and(
					eq(groupPosition.id, workOrder.positionId),
					eq(groupPosition.groupId, workOrder.groupId)
				)
			)
			.innerJoin(groupPositionHolder, eq(groupPositionHolder.positionId, groupPosition.id))
			.innerJoin(groupMember, eq(groupMember.id, groupPositionHolder.memberId))
			.innerJoin(group, eq(group.id, groupMember.groupId))
			.innerJoin(user, eq(user.id, groupMember.userId))
			.where(and(inArray(workOrder.id, [...ids]), liveSeat()))
			.orderBy(asc(user.name), asc(user.id)),
		db
			.select({ id: workOrder.id, ...person })
			.from(workOrder)
			.innerJoin(group, eq(group.id, workOrder.groupId))
			.innerJoin(groupMember, eq(groupMember.groupId, group.id))
			.innerJoin(user, eq(user.id, groupMember.userId))
			.where(and(inArray(workOrder.id, [...ids]), liveSeat()))
			.orderBy(asc(user.name), asc(user.id))
	]);
	const byPosition = new Map<string, TaskRecipient[]>();
	const byDepartment = new Map<string, TaskRecipient[]>();
	for (const { id, ...r } of held) push(byPosition, id, r);
	for (const { id, ...r } of seated) push(byDepartment, id, r);
	for (const id of ids) {
		const position = byPosition.get(id);
		const department = byDepartment.get(id);
		if (position) out.set(id, { via: 'position', recipients: position });
		else if (department) out.set(id, { via: 'department', recipients: department });
	}
	return out;
}

/** A notice about one task: its position, else its committee, else every holder of `cap`. */
export async function taskNoticeRecipients(
	workOrderId: string,
	cap: Capability
): Promise<TaskRecipient[]> {
	const routed = (await taskAudiences([workOrderId])).get(workOrderId);
	if (routed) return routed.recipients;
	const holders = await listUsersWithCapability(cap);
	return holders.map((h) => ({ userId: h.id, userName: h.name, userEmail: h.email }));
}

/** Each show's event lead (#2726), by event id; a show with none is absent. */
export async function showLeads(eventIds: readonly string[]): Promise<Map<string, TaskRecipient>> {
	const out = new Map<string, TaskRecipient>();
	if (eventIds.length === 0) return out;
	const rows = await db
		.select({ eventId: eventListing.id, ...person })
		.from(eventListing)
		.innerJoin(production, eq(production.projectId, eventListing.projectId))
		.innerJoin(user, eq(user.id, production.producerUserId))
		.where(
			and(
				inArray(eventListing.id, [...eventIds]),
				isNotNull(production.producerUserId),
				isNull(user.deletedAt)
			)
		);
	for (const { eventId, ...r } of rows) out.set(eventId, r);
	return out;
}
