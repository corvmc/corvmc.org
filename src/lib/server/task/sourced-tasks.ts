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

/** The volunteer role each kind's tasks take: one setting per kind, where it has one. */
const ROLE_SETTING: Partial<Record<TaskSource, () => Promise<unknown>>> = {
	repair: () => config('inventory.repairRoleId'),
	restock: () => config('inventory.restockRoleId'),
	late_order: () => config('inventory.lateOrderRoleId'),
	form_8282: () => config('inventory.form8282RoleId')
};

/** The configured role for this kind, when it names a live role; else none. */
export async function sourceRoleId(source: TaskSource): Promise<string | null> {
	const id = String((await ROLE_SETTING[source]?.()) ?? '').trim();
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
	/** The show it is at (`work_order.event_id`). */
	eventId?: string | null;
	links?: LinkTo;
	/**
	 * Open at most one task per record, ever: for a record nothing in the app
	 * can resolve, whose task is closed by hand and must not come back.
	 */
	once?: boolean;
}

/**
 * The record's open task, opened if it has none. Two callers racing get one
 * task: the second insert meets the unique index and finds the first.
 */
export async function openSourcedTask(
	input: SourcedTaskInput
): Promise<{ id: string; opened: boolean }> {
	const existing = await openTaskFor(input.source, input.sourceId, input.once);
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
				dueAt: input.dueAt ?? null,
				eventId: input.eventId ?? null
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

async function openTaskFor(
	source: TaskSource,
	sourceId: string,
	everOpened = false
): Promise<string | null> {
	const [row] = await db
		.select({ id: workOrder.id })
		.from(workOrder)
		.where(
			and(
				eq(workOrder.source, source),
				eq(workOrder.sourceId, sourceId),
				everOpened ? undefined : openOnly()
			)
		)
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

/**
 * Make one kind's open tasks match the records that call for one: open the
 * missing, close the rest. `scope` limits the closing to these records, for a
 * caller that read only some; without it every open task of the kind is in play.
 */
export async function reconcileSourcedTasks(
	source: TaskSource,
	wanted: Omit<SourcedTaskInput, 'source'>[],
	closeNote: string,
	scope?: string[]
): Promise<{ opened: number; closed: number }> {
	const open = await openSourceIds(source, scope);
	let opened = 0;
	for (const w of wanted) {
		if (open.has(w.sourceId)) continue;
		if ((await openSourcedTask({ ...w, source })).opened) opened++;
	}
	const want = new Set(wanted.map((w) => w.sourceId));
	const stale = [...open.keys()].filter((id) => !want.has(id));
	return { opened, closed: await closeSourcedTasks(source, stale, closeNote) };
}

/** `reconcileSourcedTasks` after a write that has landed: logged, never thrown. */
export async function afterSourceChange(label: string, sync: () => Promise<unknown>) {
	try {
		await sync();
	} catch (err) {
		console.error(`[sourced-tasks] ${label} sync failed:`, err);
	}
}
