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
	getScheduleGroupId,
	listMaintenanceSchedules,
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
	assetId: null as string | null,
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

	it("carries the schedule's asset onto every occurrence (#1423)", () => {
		nextOccurrenceInsert({ ...schedule, assetId: 'asset-pa' }, new Date());
		expect(valuesCalls()[0]).toMatchObject({ assetId: 'asset-pa' });
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

	it('links the schedule and its first occurrence to the picked asset (#1423)', async () => {
		selectQueue = [[{ id: 'role-1', isActive: true }]];

		await createMaintenanceSchedule({ ...input, assetId: 'asset-pa' });

		const [scheduleValues, occurrence] = valuesCalls();
		expect(scheduleValues.assetId).toBe('asset-pa');
		expect(occurrence.assetId).toBe('asset-pa');
	});

	it('stores no asset when none was picked', async () => {
		selectQueue = [[{ id: 'role-1', isActive: true }]];
		await createMaintenanceSchedule({ ...input, assetId: '' });
		expect(valuesCalls()[0].assetId).toBeNull();
	});

	it('records the committee that owns it (#1512)', async () => {
		selectQueue = [[{ id: 'role-1', isActive: true }]];
		await createMaintenanceSchedule({ ...input, groupId: 'grp-booking' });
		expect(valuesCalls()[0].groupId).toBe('grp-booking');
	});

	it('leaves a staff schedule with no committee', async () => {
		selectQueue = [[{ id: 'role-1', isActive: true }]];
		await createMaintenanceSchedule(input);
		expect(valuesCalls()[0].groupId).toBeNull();
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

// #1483: a cleaning schedule shows who is on the job now.
describe('listMaintenanceSchedules', () => {
	it('names who holds a place on the open occurrence, and nobody when it is empty', async () => {
		selectQueue = [
			[
				{
					id: 'ms-1',
					name: 'Weekly bathroom clean',
					assignees: 'Ada Lovelace\nBo Diddley',
					lastClosedAt: null
				},
				{ id: 'ms-2', name: 'Monthly deep clean', assignees: null, lastClosedAt: null }
			]
		];
		const rows = await listMaintenanceSchedules();
		expect(rows.map((r) => r.assignees)).toEqual([['Ada Lovelace', 'Bo Diddley'], []]);
	});

	it('counts only places still held, and only on the open occurrence', async () => {
		selectQueue = [[]];
		await listMaintenanceSchedules();
		const select = vi.mocked((await import('$lib/server/db')).db.select).mock.calls[0][0] as any;
		const rendered = new SQLiteSyncDialect().sqlToQuery(select.assignees as SQL).sql;
		expect(rendered).toContain('"volunteer_signup"');
		expect(rendered).toContain("'claimed', 'confirmed', 'completed'");
	});
});

// #1512: a committee reads and retires only its own recurring work.
describe('committee-owned schedules', () => {
	it('narrows the list to one committee when asked', async () => {
		selectQueue = [[]];
		await listMaintenanceSchedules({ groupId: 'grp-booking' });
		const where = chainCalls.find((c) => c.method === 'where')!.args[0] as SQL;
		const q = new SQLiteSyncDialect().sqlToQuery(where);
		expect(q.sql).toContain('"group_id"');
		expect(q.params).toContain('grp-booking');
	});

	it('lists every schedule for staff', async () => {
		selectQueue = [[]];
		await listMaintenanceSchedules();
		expect(chainCalls.find((c) => c.method === 'where')?.args[0]).toBeUndefined();
	});

	it('reads the owning committee from the row, and 404s on an unknown schedule', async () => {
		selectQueue = [[{ groupId: 'grp-booking' }], []];
		expect(await getScheduleGroupId('ms-1')).toBe('grp-booking');
		await expect(getScheduleGroupId('nope')).rejects.toThrow('Recurring work not found');
	});
});
