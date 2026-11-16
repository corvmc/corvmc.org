import { db } from '#lib/server/db/index.js';
import { workOrder, volunteerRole } from '#lib/server/db/schema/volunteer.js';
import { workOrderLink } from '#lib/server/db/schema/work-order-link.js';
import { contractorJob } from '#lib/server/db/schema/contractor.js';
import { grantApplication } from '#lib/server/db/schema/grant.js';
import { sponsorship } from '#lib/server/db/schema/sponsor.js';
import { and, eq, isNotNull, isNull, sql, type AnyColumn } from 'drizzle-orm';
import { lastActivityByParty } from './activity-service';
import { lastThreadByParty } from './thread-filing';
import { toLocalDate } from '#lib/utils/format.js';

/**
 * The Contacts list's two facts per party (#2622): the day of its latest note
 * or filed Inbox message, and its next open task. An organization's tasks are
 * the ones the related-tasks registry finds for it: linked to it, its
 * contractor jobs, and the tasks on its grants' and sponsorships' projects. A
 * person's are the tasks linked to them. Maps are keyed by `partyKey`.
 */

export interface NextTask {
	id: string;
	title: string;
	dueAt: Date | null;
}

const open = and(isNull(workOrder.resolvedAt), isNull(workOrder.cancelledAt));
const columns = (type: 'organization' | 'contact', id: AnyColumn) => ({
	party: sql<string>`${type} || ':' || ${id}`.as('party'),
	id: workOrder.id,
	title: sql<string>`coalesce(${workOrder.title}, ${volunteerRole.name}, 'Task')`.as('title'),
	dueAt: workOrder.dueAt,
	createdAt: workOrder.createdAt
});

/** Every open task each party has, read in one pass rather than bound per id. */
function openTasksByParty() {
	const linked = db
		.select(columns('organization', workOrderLink.organizationId))
		.from(workOrderLink)
		.innerJoin(workOrder, eq(workOrder.id, workOrderLink.workOrderId))
		.leftJoin(volunteerRole, eq(volunteerRole.id, workOrder.volunteerRoleId))
		.where(and(isNotNull(workOrderLink.organizationId), open));
	const people = db
		.select(columns('contact', workOrderLink.contactId))
		.from(workOrderLink)
		.innerJoin(workOrder, eq(workOrder.id, workOrderLink.workOrderId))
		.leftJoin(volunteerRole, eq(volunteerRole.id, workOrder.volunteerRoleId))
		.where(and(isNotNull(workOrderLink.contactId), open));
	const jobs = db
		.select(columns('organization', contractorJob.organizationId))
		.from(contractorJob)
		.innerJoin(workOrder, eq(workOrder.id, contractorJob.workOrderId))
		.leftJoin(volunteerRole, eq(volunteerRole.id, workOrder.volunteerRoleId))
		.where(open);
	const grants = db
		.select(columns('organization', grantApplication.organizationId))
		.from(grantApplication)
		.innerJoin(workOrder, eq(workOrder.projectId, grantApplication.projectId))
		.leftJoin(volunteerRole, eq(volunteerRole.id, workOrder.volunteerRoleId))
		.where(open);
	const sponsorships = db
		.select(columns('organization', sponsorship.organizationId))
		.from(sponsorship)
		.innerJoin(workOrder, eq(workOrder.projectId, sponsorship.projectId))
		.leftJoin(volunteerRole, eq(volunteerRole.id, workOrder.volunteerRoleId))
		.where(open);
	return linked.unionAll(people).unionAll(jobs).unionAll(grants).unionAll(sponsorships);
}

/** Soonest due first; a task with no due date after every dated one, then oldest. */
const sooner = (a: NextTask & { createdAt: Date }, b: NextTask & { createdAt: Date }) =>
	(a.dueAt?.getTime() ?? Infinity) - (b.dueAt?.getTime() ?? Infinity) ||
	a.createdAt.getTime() - b.createdAt.getTime();

/** Each party's soonest open task. */
async function nextTaskByParty(): Promise<Map<string, NextTask>> {
	const best = new Map<string, NextTask & { createdAt: Date }>();
	for (const row of await openTasksByParty()) {
		const held = best.get(row.party);
		if (!held || sooner(row, held) < 0) best.set(row.party, row);
	}
	return new Map([...best].map(([key, t]) => [key, { id: t.id, title: t.title, dueAt: t.dueAt }]));
}

/** Every party's facts, keyed by `partyKey`. */
export async function partyListFacts() {
	const [notes, threads, nextTask] = await Promise.all([
		lastActivityByParty(),
		lastThreadByParty(),
		nextTaskByParty()
	]);
	// The later of its latest note day and its latest filed message, as a club date.
	const lastActivity = new Map(notes);
	for (const [key, at] of threads) {
		const day = toLocalDate(at);
		if (!lastActivity.has(key) || day > lastActivity.get(key)!) lastActivity.set(key, day);
	}
	return { lastActivity, nextTask };
}
