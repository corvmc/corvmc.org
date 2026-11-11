/**
 * Timed work, written as the app writes it since #2518: a task (`work_order`)
 * and one shift (`volunteer_shift`) on it. Seeders describe each row in the old
 * one-row shape; this splits it. Sign-ups and shift hour logs take `shiftId`.
 */
import { randomUUID } from 'crypto';
import { volunteerShift, workOrder } from '../../src/lib/server/db/schema/volunteer';
import type { WorkOrder } from '../../src/lib/server/db/schema/volunteer';
import { batchInsert } from './db';

export type TimedTaskSeed = typeof workOrder.$inferInsert & {
	id: string;
	startsAt: Date;
	endsAt: Date;
	/** Places on the shift; 1 when left out. */
	capacity?: number;
	/** The shift's briefing ("meet at the side door"); the task's `notes` stay the task's. */
	shiftNotes?: string | null;
};

export type SeededShiftTask = WorkOrder & {
	shiftId: string;
	startsAt: Date;
	endsAt: Date;
	capacity: number;
};

/** A seeded literal id gives a readable shift id; a random one gets a random one. */
export const shiftIdFor = (taskId: string) =>
	taskId.startsWith('seed-') ? `${taskId}-shift` : randomUUID();

export async function insertTasksWithShifts(rows: TimedTaskSeed[]): Promise<SeededShiftTask[]> {
	if (rows.length === 0) return [];
	const tasks = await batchInsert(
		workOrder,
		rows.map(({ startsAt: _s, endsAt: _e, capacity: _c, shiftNotes: _n, ...task }) => task)
	);
	const shifts = await batchInsert(
		volunteerShift,
		rows.map((r) => ({
			id: shiftIdFor(r.id),
			workOrderId: r.id,
			startsAt: r.startsAt,
			endsAt: r.endsAt,
			capacity: r.capacity ?? 1,
			anchor: r.anchor ?? null,
			notes: r.shiftNotes ?? null,
			// A called-off task's shift is called off with it, as `cancelShift` does.
			cancelledAt: r.cancelledAt ?? null,
			cancelledByUserId: r.cancelledByUserId ?? null,
			createdByUserId: r.createdByUserId ?? null
		}))
	);
	const byTask = new Map(shifts.map((s) => [s.workOrderId, s]));
	return tasks.map((t) => {
		const s = byTask.get(t.id)!;
		return { ...t, shiftId: s.id, startsAt: s.startsAt, endsAt: s.endsAt, capacity: s.capacity };
	});
}
