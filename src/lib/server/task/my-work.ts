import { db } from '#lib/server/db/index.js';
import { workOrderLink } from '#lib/server/db/schema/work-order-link.js';
import { waitingOn } from './can-act';
import { inArray } from 'drizzle-orm';
import { taskRowQuery, toTaskRow } from '#lib/server/volunteer/task-catalogue.js';
import { whenOf, type TaskRow } from '#lib/utils/task-facts.js';
import { isOverdue } from '#lib/utils/work-order-due.js';
import type { LinkSubjectType } from '#lib/utils/related-tasks.js';

/** The record a task is about, when it is about one (`work_order_link`). */
export interface TaskAbout {
	type: LinkSubjectType;
	id: string;
}

export interface MyTask extends TaskRow {
	about: TaskAbout | null;
}

/** The tasks `waitingOn` this user (#2989). Overdue first, then by date, undated last. */
export async function listMyWork(userId: string, now = new Date()): Promise<MyTask[]> {
	const rows = (await taskRowQuery(now).where(waitingOn(userId))).map(toTaskRow);

	const links = await aboutOf(rows.map((r) => r.id));
	return rows
		.map((r) => ({ ...r, about: links.get(r.id) ?? null }))
		.sort((a, b) => byUrgency(a, b, now));
}

function byUrgency(a: TaskRow, b: TaskRow, now: Date): number {
	const late = Number(isOverdue(b, now)) - Number(isOverdue(a, now));
	if (late) return late;
	const wa = whenOf(a)?.getTime() ?? Infinity;
	const wb = whenOf(b)?.getTime() ?? Infinity;
	if (wa !== wb) return wa < wb ? -1 : 1;
	return a.createdAt.getTime() - b.createdAt.getTime();
}

/** Each task's first link, in a fixed order of target. */
async function aboutOf(ids: string[]): Promise<Map<string, TaskAbout>> {
	const out = new Map<string, TaskAbout>();
	if (ids.length === 0) return out;
	const rows = await db.select().from(workOrderLink).where(inArray(workOrderLink.workOrderId, ids));
	for (const r of rows) {
		if (out.has(r.workOrderId)) continue;
		const about: TaskAbout | null = r.assetId
			? { type: 'asset', id: r.assetId }
			: r.reservationId
				? { type: 'reservation', id: r.reservationId }
				: r.organizationId
					? { type: 'organization', id: r.organizationId }
					: r.contactId
						? { type: 'contact', id: r.contactId }
						: r.itemId
							? { type: 'equipment', id: r.itemId }
							: null;
		if (about) out.set(r.workOrderId, about);
	}
	return out;
}
