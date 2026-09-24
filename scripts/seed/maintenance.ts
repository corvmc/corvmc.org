import {
	maintenanceSchedule,
	volunteerRole,
	workOrder
} from '../../src/lib/server/db/schema/volunteer';
import { batchInsert, db } from './db';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';

/**
 * Recurring facility work, in the three states `/staff/volunteer/recurring` renders:
 * a live schedule with history and a next one due, a live one whose open work
 * order is overdue, and a retired one whose last occurrence was closed.
 */
export async function seedMaintenanceSchedules(staffId: string) {
	console.log('Seeding recurring work...');

	const [role] = await db
		.select({ id: volunteerRole.id })
		.from(volunteerRole)
		.where(eq(volunteerRole.name, 'Facilities & Maintenance'))
		.limit(1);
	if (!role) return { schedules: 0 };

	const now = Date.now();
	const day = 86_400_000;
	const at = (offsetDays: number) => new Date(now + offsetDays * day);

	const clean = { id: randomUUID(), name: 'Monthly deep clean', intervalDays: 30 };
	const pa = { id: randomUUID(), name: 'Quarterly PA check', intervalDays: 91 };
	const filters = { id: randomUUID(), name: 'HVAC filter swap', intervalDays: 60 };

	await batchInsert(
		maintenanceSchedule,
		[clean, pa, filters].map((s) => ({
			...s,
			volunteerRoleId: role.id,
			capacity: 1,
			createdByUserId: staffId,
			retiredAt: s === filters ? at(-5) : null
		}))
	);

	const base = { volunteerRoleId: role.id, capacity: 1, createdByUserId: staffId };
	await batchInsert(
		workOrder,
		[
			// Closed twenty days ago, so the open one is due ten days out.
			{ ...base, maintenanceScheduleId: clean.id, title: clean.name, dueAt: at(-25) },
			{ ...base, maintenanceScheduleId: clean.id, title: clean.name, dueAt: at(10) },
			// Nobody has closed this one, and it is three days late.
			{ ...base, maintenanceScheduleId: pa.id, title: pa.name, dueAt: at(-3) },
			{ ...base, maintenanceScheduleId: filters.id, title: filters.name, dueAt: at(-12) }
		].map((row, i) => ({
			id: randomUUID(),
			...row,
			...(i === 0 ? { resolvedAt: at(-20), resolvedByUserId: staffId } : {}),
			...(i === 3 ? { resolvedAt: at(-10), resolvedByUserId: staffId } : {})
		}))
	);

	return { schedules: 3 };
}
