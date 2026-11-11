import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Who answers a task, against a real SQLite: the board's filter, the member
 * claim's refusal, the derived mode, and the staff reads that must not drop a
 * task for having no role. Each is a `WHERE` or a join, which a mocked `db`
 * would agree with either way. A task's times are its shifts (#2518).
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite, withBatch } = await import('#lib/server/testing/migrated-sqlite.js');
	const db = migratedSqlite();
	return { sqlite: db.sqlite, testDb: withBatch(db) };
});

vi.mock('#lib/server/db/index.js', () => ({
	db: testDb,
	getRowCount: (result: unknown) => (result as { changes?: number })?.changes ?? 0
}));
vi.mock('#lib/server/volunteer/volunteer-profile-service.js', () => ({
	requireActiveVolunteer: vi.fn(async () => undefined)
}));
vi.mock('#lib/server/sentry.js', () => ({ captureException: vi.fn() }));
vi.mock('#lib/server/volunteer/member-certification-service.js', () => ({
	missingRequirements: vi.fn(async () => [])
}));

const { claimShift, ShiftClosedError } = await import('./volunteer-signup-service');
const {
	createShift,
	deriveMode,
	getShiftDetail,
	listOpenShiftsForMember,
	listShifts,
	listShortStaffedShifts,
	listWorkOrders,
	workOrderModes
} = await import('./work-order-service');

const ADA = 'usr-ada';
const ROLE = 'role-1';
const inHours = (n: number) => Math.floor((Date.now() + n * 3_600_000) / 1000);

function insert(table: string, row: Record<string, unknown>) {
	const keys = Object.keys(row);
	sqlite
		.prepare(
			`insert into ${table} (${keys.map((k) => `"${k}"`).join(', ')})
				values (${keys.map(() => '?').join(', ')})`
		)
		.run(...keys.map((k) => row[k]));
}

/** A task, and unless `untimed`, one live shift on it named `<id>-shift`. */
function workOrder(
	id: string,
	cols: Record<string, string | number | null> = {},
	opts: { untimed?: boolean; shift?: Record<string, string | number | null> } = {}
) {
	insert('work_order', { id, volunteer_role_id: ROLE, ...cols });
	if (opts.untimed) return;
	insert('volunteer_shift', {
		id: `${id}-shift`,
		work_order_id: id,
		starts_at: inHours(48),
		ends_at: inHours(52),
		capacity: 2,
		...opts.shift
	});
}

/**
 * An engagement with only the columns this spec cares about. Every other
 * NOT NULL column gets a placeholder read off the live table, so the fixture
 * survives the engagement table being reshaped.
 */
function engagement(workOrderId: string, status: string) {
	const cols = sqlite.prepare(`pragma table_info(contractor_job)`).all() as {
		name: string;
		notnull: number;
		dflt_value: unknown;
	}[];
	const row: Record<string, unknown> = {
		id: `cj-${workOrderId}`,
		work_order_id: workOrderId,
		status
	};
	for (const c of cols) {
		if (!(c.name in row) && c.notnull && c.dflt_value === null) row[c.name] = 'x';
	}
	insert('contractor_job', row);
}

beforeEach(() => {
	for (const t of [
		'contractor_job',
		'volunteer_signup',
		'volunteer_shift',
		'work_order_assignee',
		'work_order',
		'volunteer_role',
		'user'
	]) {
		sqlite.exec(`delete from ${t}`);
	}
	insert('user', { id: ADA, name: 'Ada', email: 'ada@example.com', email_verified: 0 });
	insert('volunteer_role', { id: ROLE, name: 'Door', is_active: 1 });
});

describe('the claim board', () => {
	// A shift is open by existing: there is no posting step (#2518).
	it('lists each live shift on an open task, and no task without one', async () => {
		workOrder('timed');
		workOrder('untimed', {}, { untimed: true });
		workOrder('done', { resolved_at: inHours(-1) });
		workOrder('shift-off', {}, { shift: { cancelled_at: inHours(-1) } });
		const board = await listOpenShiftsForMember(ADA);
		expect(board.map((s) => s.id)).toEqual(['timed-shift']);
	});

	it('still lists a shift made the way staff always made them', async () => {
		const day = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
		const made = await createShift({
			volunteerRoleId: ROLE,
			startsAt: `${day}T18:00`,
			endsAt: `${day}T21:00`,
			capacity: 2,
			createdByUserId: ADA
		});
		expect((await listOpenShiftsForMember(ADA)).map((s) => s.id)).toEqual([made.shiftId]);
	});
});

describe('claiming', () => {
	it('refuses a member and staff alike once the task is done', async () => {
		workOrder('done', { resolved_at: inHours(-1) });
		await expect(claimShift('done-shift', ADA)).rejects.toBeInstanceOf(ShiftClosedError);
		await expect(claimShift('done-shift', ADA, { assignedByStaff: true })).rejects.toThrow(
			'That task is already done.'
		);
	});

	it('lets staff put somebody on a shift, booked', async () => {
		workOrder('door');
		const signup = await claimShift('door-shift', ADA, { assignedByStaff: true });
		expect(signup.status).toBe('confirmed');
	});

	it('lets a member sign up for a shift, unconfirmed', async () => {
		workOrder('door');
		const signup = await claimShift('door-shift', ADA);
		expect(signup.status).toBe('claimed');
	});
});

describe('the assignment mode', () => {
	it('reads contractor over open over members over unassigned', () => {
		const all = { engaged: true, posted: true, staffed: true };
		expect(deriveMode(all)).toBe('contractor');
		expect(deriveMode({ ...all, engaged: false })).toBe('open');
		expect(deriveMode({ engaged: false, posted: false, staffed: true })).toBe('members');
		expect(deriveMode({ engaged: false, posted: false, staffed: false })).toBe('unassigned');
	});

	it('derives each from the rows behind it', async () => {
		workOrder('contractor', { volunteer_role_id: null, title: 'Rewire' }, { untimed: true });
		engagement('contractor', 'completed');
		workOrder('called-off');
		engagement('called-off', 'cancelled');
		workOrder('declined', { volunteer_role_id: null, title: 'Quote' }, { untimed: true });
		engagement('declined', 'declined');
		// Assigned, not signed up: assignment is its own table (#2518).
		workOrder('members', {}, { untimed: true });
		insert('work_order_assignee', { work_order_id: 'members', user_id: ADA, assigned_at: 1 });
		// A called-off shift opens nothing.
		workOrder('shift-off', {}, { shift: { cancelled_at: inHours(-1) } });
		workOrder('typed', { volunteer_role_id: null, title: 'Buy paint' }, { untimed: true });

		const modes = await workOrderModes([
			'contractor',
			'called-off',
			'declined',
			'members',
			'shift-off',
			'typed',
			'missing'
		]);
		expect(Object.fromEntries(modes)).toEqual({
			contractor: 'contractor',
			'called-off': 'open',
			declined: 'unassigned',
			members: 'members',
			'shift-off': 'unassigned',
			typed: 'unassigned'
		});
	});

	it('answers more ids than one statement can bind', async () => {
		const ids = Array.from({ length: 170 }, (_, i) => `wo-${i}`);
		for (const id of ids) workOrder(id);
		const modes = await workOrderModes(ids);
		expect(modes.size).toBe(170);
		expect(new Set(modes.values())).toEqual(new Set(['open']));
	});
});

describe('work orders with no role, on staff surfaces', () => {
	beforeEach(() => {
		workOrder('roleless', { volunteer_role_id: null, title: 'Rewire' }, { shift: { capacity: 1 } });
		workOrder(
			'roleless-queue',
			{ volunteer_role_id: null, title: 'Get a quote', project_id: 'proj-1' },
			{ untimed: true }
		);
	});

	it('are on the schedule and have a detail page', async () => {
		expect((await listShifts()).map((s) => s.id)).toContain('roleless');
		const detail = await getShiftDetail('roleless');
		expect(detail).toMatchObject({ id: 'roleless', volunteerRoleId: null, roleName: null });
	});

	it("are on their project's queue, not the volunteer coordinator's", async () => {
		expect((await listWorkOrders({ projectId: 'proj-1' })).map((w) => w.id)).toEqual([
			'roleless-queue'
		]);
		expect(await listWorkOrders()).toEqual([]);
	});

	it('are never short-staffed, having nobody to fill them', async () => {
		expect(await listShortStaffedShifts(7)).toEqual([]);
	});
});
