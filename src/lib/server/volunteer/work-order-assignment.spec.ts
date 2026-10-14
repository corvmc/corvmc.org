import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Who answers a work order, against a real SQLite: the claim board's filter,
 * the member claim's refusal, the derived mode, and the staff reads that must
 * not drop a work order for having no role. Each is a `WHERE` or a join, which
 * a mocked `db` would agree with either way.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite();
});

vi.mock('$lib/server/db', () => ({
	db: testDb,
	getRowCount: (result: unknown) => (result as { changes?: number })?.changes ?? 0
}));
vi.mock('$lib/server/volunteer/volunteer-profile-service', () => ({
	requireActiveVolunteer: vi.fn(async () => undefined)
}));
vi.mock('$lib/server/events', () => ({ domainEvents: { emit: vi.fn(async () => undefined) } }));
vi.mock('$lib/server/sentry', () => ({ captureException: vi.fn() }));
vi.mock('$lib/server/volunteer/member-certification-service', () => ({
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

function workOrder(id: string, cols: Record<string, string | number | null> = {}) {
	insert('work_order', {
		id,
		volunteer_role_id: ROLE,
		starts_at: inHours(48),
		ends_at: inHours(52),
		capacity: 2,
		...cols
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
	for (const t of ['contractor_job', 'volunteer_signup', 'work_order', 'volunteer_role', 'user']) {
		sqlite.exec(`delete from ${t}`);
	}
	insert('user', { id: ADA, name: 'Ada', email: 'ada@example.com', email_verified: 0 });
	insert('volunteer_role', { id: ROLE, name: 'Door', is_active: 1 });
});

describe('the claim board', () => {
	it('lists posted work and leaves out scheduled work nobody posted', async () => {
		workOrder('posted', { posted_at: inHours(-1) });
		workOrder('assigned');
		const board = await listOpenShiftsForMember(ADA);
		expect(board.map((s) => s.id)).toEqual(['posted']);
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
		expect(made.postedAt).not.toBeNull();
		expect((await listOpenShiftsForMember(ADA)).map((s) => s.id)).toEqual([made.id]);
	});
});

describe('claiming', () => {
	it("refuses a member claiming work that isn't open for sign-up", async () => {
		workOrder('assigned');
		const attempt = claimShift('assigned', ADA);
		await expect(attempt).rejects.toBeInstanceOf(ShiftClosedError);
		await expect(attempt).rejects.toThrow("This shift isn't open for sign-up.");
	});

	it('lets staff assign somebody onto that same unposted work', async () => {
		workOrder('assigned');
		const signup = await claimShift('assigned', ADA, { assignedByStaff: true });
		expect(signup.status).toBe('confirmed');
	});

	it('lets a member claim posted work', async () => {
		workOrder('posted', { posted_at: inHours(-1) });
		const signup = await claimShift('posted', ADA);
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
		workOrder('contractor', { volunteer_role_id: null, title: 'Rewire' });
		engagement('contractor', 'completed');
		workOrder('called-off', { posted_at: inHours(-1) });
		engagement('called-off', 'cancelled');
		workOrder('declined', { volunteer_role_id: null, title: 'Quote' });
		engagement('declined', 'declined');
		workOrder('members');
		insert('volunteer_signup', {
			id: 'su-1',
			shift_id: 'members',
			user_id: ADA,
			status: 'confirmed'
		});
		workOrder('dropped');
		insert('volunteer_signup', {
			id: 'su-2',
			shift_id: 'dropped',
			user_id: ADA,
			status: 'cancelled'
		});
		workOrder('typed', { volunteer_role_id: null, title: 'Buy paint' });

		const modes = await workOrderModes([
			'contractor',
			'called-off',
			'declined',
			'members',
			'dropped',
			'typed',
			'missing'
		]);
		expect(Object.fromEntries(modes)).toEqual({
			contractor: 'contractor',
			'called-off': 'open',
			declined: 'unassigned',
			members: 'members',
			dropped: 'unassigned',
			typed: 'unassigned'
		});
	});

	it('answers more ids than one statement can bind', async () => {
		const ids = Array.from({ length: 170 }, (_, i) => `wo-${i}`);
		for (const id of ids) workOrder(id, { posted_at: inHours(-1) });
		const modes = await workOrderModes(ids);
		expect(modes.size).toBe(170);
		expect(new Set(modes.values())).toEqual(new Set(['open']));
	});
});

describe('work orders with no role, on staff surfaces', () => {
	beforeEach(() => {
		workOrder('roleless', { volunteer_role_id: null, title: 'Rewire', capacity: 1 });
		workOrder('roleless-queue', {
			volunteer_role_id: null,
			title: 'Get a quote',
			starts_at: null,
			ends_at: null,
			project_id: 'proj-1'
		});
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
