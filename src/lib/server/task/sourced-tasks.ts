import { db } from '#lib/server/db/index.js';
import { volunteerRole, workOrder, workOrderAssignee } from '#lib/server/db/schema/volunteer.js';
import { and, eq, inArray, isNull, type SQL } from 'drizzle-orm';
import { config } from '#lib/server/site-config/site-config-service.js';
import type { TaskSource } from '#lib/config.js';
import { linkInsertIfTaskExists, linkTargets, type LinkTo } from './work-order-link';

/**
 * Tasks the app opens for a record whose state calls for work (#2756): a
 * reported fault, an item at its reorder point. One open task per record,
 * held by `uq_work_order_open_source`; the record's own state closes it, and
 * closing the task by hand never changes the record.
 */

/** The volunteer role each kind's tasks take: one setting per kind. */
const ROLE_SETTING: Record<TaskSource, () => Promise<unknown>> = {
	repair: () => config('inventory.repairRoleId'),
	restock: () => config('inventory.restockRoleId')
};

/** The configured role for this kind, when it names a live role; else none. */
export async function sourceRoleId(source: TaskSource): Promise<string | null> {
	const id = String((await ROLE_SETTING[source]()) ?? '').trim();
	if (!id) return null;
	const [role] = await db
		.select({ isActive: volunteerRole.isActive })
		.from(volunteerRole)
		.where(eq(volunteerRole.id, id))
		.limit(1);
	return role?.isActive ? id : null;
}

const openOnly = () => and(isNull(workOrder.resolvedAt), isNull(workOrder.cancelledAt));

export interface SourcedTaskInput {
	source: TaskSource;
	sourceId: string;
	title: string;
	notes?: string | null;
	dueAt?: Date | null;
	links?: LinkTo;
}

/**
 * The record's open task, opened if it has none. Two callers racing get one
 * task: the second insert meets the unique index and finds the first.
 */
export async function openSourcedTask(
	input: SourcedTaskInput
): Promise<{ id: string; opened: boolean }> {
	const existing = await openTaskFor(input.source, input.sourceId);
	if (existing) return { id: existing, opened: false };

	const id = crypto.randomUUID();
	const volunteerRoleId = await sourceRoleId(input.source);
	const links = linkTargets.flatMap((target) => {
		const to = input.links?.[target];
		return to ? [linkInsertIfTaskExists(id, target, to)] : [];
	});
	const [inserted] = await db.batch([
		db
			.insert(workOrder)
			.values({
				id,
				source: input.source,
				sourceId: input.sourceId,
				title: input.title,
				volunteerRoleId,
				notes: input.notes ?? null,
				dueAt: input.dueAt ?? null
			})
			.onConflictDoNothing()
			.returning({ id: workOrder.id }),
		...links
	]);
	if (inserted.length > 0) return { id, opened: true };

	const winner = await openTaskFor(input.source, input.sourceId);
	if (!winner) throw new Error(`No open ${input.source} task for ${input.sourceId}`);
	return { id: winner, opened: false };
}

async function openTaskFor(source: TaskSource, sourceId: string): Promise<string | null> {
	const [row] = await db
		.select({ id: workOrder.id })
		.from(workOrder)
		.where(and(eq(workOrder.source, source), eq(workOrder.sourceId, sourceId), openOnly()))
		.limit(1);
	return row?.id ?? null;
}

/** Record → its open task, for records of this kind (among `sourceIds` when given). */
export async function openSourceIds(
	source: TaskSource,
	sourceIds?: string[]
): Promise<Map<string, string>> {
	if (sourceIds?.length === 0) return new Map();
	const rows = await db
		.select({ sourceId: workOrder.sourceId, id: workOrder.id })
		.from(workOrder)
		.where(
			and(
				eq(workOrder.source, source),
				sourceIds ? inArray(workOrder.sourceId, sourceIds) : undefined,
				openOnly()
			)
		);
	return new Map(rows.flatMap((r) => (r.sourceId ? [[r.sourceId, r.id] as const] : [])));
}

/**
 * Close these records' open tasks, because the records no longer call for the
 * work. Assignees are stamped done, as a hand close does. Returns how many closed.
 */
export async function closeSourcedTasks(
	source: TaskSource,
	sourceIds: string[],
	note: string
): Promise<number> {
	if (sourceIds.length === 0) return 0;
	const now = new Date();
	const these: SQL = and(
		eq(workOrder.source, source),
		inArray(workOrder.sourceId, sourceIds),
		openOnly()
	) as SQL;
	const ids = db.select({ id: workOrder.id }).from(workOrder).where(these);
	const [, closed] = await db.batch([
		db
			.update(workOrderAssignee)
			.set({ completedAt: now })
			.where(
				and(inArray(workOrderAssignee.workOrderId, ids), isNull(workOrderAssignee.completedAt))
			),
		db
			.update(workOrder)
			.set({ resolvedAt: now, resolutionNotes: note, updatedAt: now })
			.where(these)
			.returning({ id: workOrder.id })
	]);
	return closed.length;
}
