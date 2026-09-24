import { describe, it, expect, vi, beforeEach } from 'vitest';

let selectQueue: unknown[][] = [];
let chainCalls: { method: string; args: unknown[] }[] = [];
const batch = vi.fn(async (stmts: unknown[]) => stmts.map(() => []));

function chainable() {
	const proxy: any = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') {
				return (resolve: (v: unknown[]) => void) => resolve(selectQueue.shift() ?? []);
			}
			return (...args: unknown[]) => {
				chainCalls.push({ method: String(prop), args });
				return proxy;
			};
		}
	});
	return proxy;
}

vi.mock('$lib/server/db', () => ({
	db: {
		select: vi.fn(() => chainable()),
		insert: vi.fn(() => chainable()),
		update: vi.fn(() => chainable()),
		batch: (stmts: unknown[]) => batch(stmts)
	}
}));

import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import type { SQL } from 'drizzle-orm';
import {
	createMaintenanceSchedule,
	nextDueAt,
	nextOccurrenceInsert,
	retireMaintenanceSchedule,
	MaintenanceScheduleError
} from './maintenance-schedule-service';

const DAY = 86_400_000;

function valuesCalls() {
	return chainCalls.filter((c) => c.method === 'values').map((c) => c.args[0] as any);
}

const schedule = {
	id: 'ms-1',
	name: 'Monthly deep clean',
	volunteerRoleId: 'role-1',
	projectId: 'proj-1',
	notes: 'Mop under the stage',
	capacity: 2,
	intervalDays: 30,
	retiredAt: null
};

beforeEach(() => {
	vi.clearAllMocks();
	selectQueue = [];
	chainCalls = [];
});

describe('nextDueAt', () => {
	it('counts the interval from the close, not from the old due date', () => {
		const closed = new Date('2026-09-10T12:00:00Z');
		expect(nextDueAt(closed, 30)).toEqual(new Date(closed.getTime() + 30 * DAY));
	});
});

describe('nextOccurrenceInsert', () => {
	it('writes an unscheduled work order carrying the schedule, due one interval after close', () => {
		const closed = new Date('2026-09-10T12:00:00Z');
		nextOccurrenceInsert(schedule, closed);

		const [values] = valuesCalls();
		expect(values).toMatchObject({
			maintenanceScheduleId: 'ms-1',
			title: 'Monthly deep clean',
			volunteerRoleId: 'role-1',
			projectId: 'proj-1',
			capacity: 2,
			startsAt: null,
			endsAt: null,
			dueAt: new Date(closed.getTime() + 30 * DAY)
		});
	});

	// The partial unique index is what refuses a second open occurrence; this is
	// what turns that refusal into a no-op rather than a failed close.
	it('does nothing when an open occurrence already exists', () => {
		nextOccurrenceInsert(schedule, new Date());
		expect(chainCalls.some((c) => c.method === 'onConflictDoNothing')).toBe(true);
	});
});

describe('createMaintenanceSchedule', () => {
	const input = {
		name: 'Quarterly PA check',
		volunteerRoleId: 'role-1',
		intervalDays: 91,
		firstDueAt: new Date('2026-10-01T19:00:00Z'),
		createdByUserId: 'staff-1'
	};

	it('writes the schedule and its first occurrence in one batch', async () => {
		selectQueue = [[{ id: 'role-1', isActive: true }]];

		await createMaintenanceSchedule(input);

		expect(batch).toHaveBeenCalledTimes(1);
		expect(batch.mock.calls[0][0]).toHaveLength(2);
		const [scheduleValues, occurrence] = valuesCalls();
		expect(occurrence.maintenanceScheduleId).toBe(scheduleValues.id);
		expect(occurrence).toMatchObject({ title: 'Quarterly PA check', dueAt: input.firstDueAt });
	});

	it('refuses an interval under a day', async () => {
		selectQueue = [[{ id: 'role-1', isActive: true }]];
		await expect(createMaintenanceSchedule({ ...input, intervalDays: 0 })).rejects.toThrow(
			MaintenanceScheduleError
		);
	});

	it('refuses a blank name', async () => {
		selectQueue = [[{ id: 'role-1', isActive: true }]];
		await expect(createMaintenanceSchedule({ ...input, name: '  ' })).rejects.toThrow(
			MaintenanceScheduleError
		);
	});

	it('refuses an archived role', async () => {
		selectQueue = [[{ id: 'role-1', isActive: false }]];
		await expect(createMaintenanceSchedule(input)).rejects.toThrow(MaintenanceScheduleError);
		expect(batch).not.toHaveBeenCalled();
	});
});

describe('retireMaintenanceSchedule', () => {
	it('stamps only a live schedule', async () => {
		selectQueue = [[{ id: 'ms-1' }]];
		await retireMaintenanceSchedule('ms-1');

		const set = chainCalls.find((c) => c.method === 'set')!.args[0] as any;
		expect(set.retiredAt).toBeInstanceOf(Date);
		const where = chainCalls.find((c) => c.method === 'where')!.args[0] as SQL;
		expect(new SQLiteSyncDialect().sqlToQuery(where).sql).toContain('"retired_at" is null');
	});
});
