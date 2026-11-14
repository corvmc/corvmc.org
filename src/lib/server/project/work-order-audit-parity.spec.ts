import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * The shift page and the project page change the same work orders through
 * different doors (#1906). Each pair here makes one change both ways, to two
 * twin work orders, and expects the same entries on each one's log.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', async () => ({
	db: testDb,
	getRowCount: (await import('#lib/server/db/row-count.js')).getRowCount
}));
vi.mock('$app/server', () => ({
	getRequestEvent: () => {
		throw new Error('outside a request');
	}
}));
vi.mock('#lib/server/volunteer/volunteer-profile-service.js', () => ({
	requireActiveVolunteer: vi.fn(async () => undefined)
}));
const emit = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => undefined));
vi.mock('#lib/server/event-bus/event-bus.js', () => ({ domainEvents: { emit } }));
vi.mock('#lib/server/sentry.js', () => ({ captureException: vi.fn() }));
vi.mock('#lib/server/volunteer/member-certification-service.js', () => ({
	missingRequirements: vi.fn(async () => [])
}));

const tasks = await import('./project-task-service');
const shifts = await import('#lib/server/volunteer/work-order-service.js');

const PROJECT = 'proj-1';
const OTHER = 'proj-2';
const ROLE = 'role-1';
const STAFF = 'usr-staff';
const ADA = 'usr-ada';
const BO = 'usr-bo';
const CAM = 'usr-cam';
const OUTSIDER = 'usr-outsider';
const COMMITTEE = 'grp-facilities';

function insert(table: string, row: Record<string, unknown>) {
	const keys = Object.keys(row);
	sqlite
		.prepare(
			`insert into ${table} (${keys.map((k) => `"${k}"`).join(', ')})
				values (${keys.map(() => '?').join(', ')})`
		)
		.run(...keys.map((k) => row[k]));
}

const all = <T>(q: string, ...args: unknown[]) => sqlite.prepare(q).all(...args) as T[];

beforeEach(() => {
	emit.mockClear();
	for (const t of [
		'audit_log',
		'contractor_job',
		'work_task',
		'volunteer_signup',
		'volunteer_shift',
		'work_order_assignee',
		'work_order',
		'duty_list_item',
		'duty_list',
		'project_section',
		'project_committee',
		'group_member',
		'"group"',
		'model_has_roles',
		'roles',
		'volunteer_role',
		'project',
		'user'
	]) {
		sqlite.exec(`delete from ${t}`);
	}
	for (const id of [STAFF, ADA, BO, CAM, OUTSIDER]) {
		insert('user', { id, name: id.slice(4), email: `${id}@example.com`, email_verified: 0 });
	}
	insert('project', { id: PROJECT, name: 'Renovation', starts_at: 1_900_000_000 });
	insert('project', { id: OTHER, name: 'Other' });
	insert('volunteer_role', { id: ROLE, name: 'Work Party', is_active: 1 });
	insert('roles', { id: 1, name: 'admin', guard_name: 'web' });
	insert('roles', { id: 2, name: 'not-a-position', guard_name: 'web' });
	insert('model_has_roles', { role_id: 1, user_id: STAFF });
	insert('model_has_roles', { role_id: 2, user_id: OUTSIDER });
	insert('"group"', { id: COMMITTEE, name: 'Facilities', slug: 'facilities', kind: 'committee' });
	insert('project_committee', { project_id: PROJECT, group_id: COMMITTEE, role: 'owner' });
	for (const u of [ADA, BO, CAM]) {
		insert('group_member', {
			id: `gm-${u}`,
			group_id: COMMITTEE,
			user_id: u,
			role: 'member',
			status: 'active'
		});
	}
});

const task = (id: string, cols: Record<string, unknown> = {}) =>
	insert('work_order', { id, project_id: PROJECT, title: id, ...cols });

/** Two twins on the project: `viaTask` changes through the task list, `viaShift` the shift page. */
function twins() {
	for (const id of ['viaTask', 'viaShift']) task(id, { volunteer_role_id: ROLE });
}

/** A shift still to come on the shift-page twin, with two places. */
function viaShiftShift() {
	insert('volunteer_shift', {
		id: 'sh',
		work_order_id: 'viaShift',
		starts_at: 4_000_000_000,
		ends_at: 4_000_003_600,
		capacity: 2
	});
}

const logOf = (id: string) =>
	all<{ action: string; details: string }>(
		`select action, details from audit_log where subject_id = ? order by rowid`,
		id
	).map((r) => ({ action: r.action, details: JSON.parse(r.details) }));

const actions = (id: string) => logOf(id).map((e) => e.action);

describe('the same entries from either page', () => {
	it('calls it off', async () => {
		twins();
		await tasks.cancelTask(PROJECT, 'viaTask', STAFF);
		await shifts.cancelShift('viaShift', STAFF);

		expect(actions('viaTask')).toEqual(['work_order.cancelled']);
		expect(logOf('viaShift')).toEqual(logOf('viaTask'));
	});

	it('names the fields a task edit and a shift edit changed, leaving times to rescheduled', async () => {
		twins();
		viaShiftShift();
		await shifts.editTask('viaShift', { title: 'Prime' });
		await shifts.editShift('sh', { capacity: 3, notes: 'Bring rollers' });

		expect(logOf('viaShift')).toEqual([
			{ action: 'work_order.edited', details: { fields: ['title'] } },
			{ action: 'work_order.edited', details: { fields: ['capacity', 'notes'] } }
		]);
	});

	it('records nothing for an edit that changed nothing', async () => {
		twins();
		viaShiftShift();
		await shifts.editTask('viaShift', { title: 'viaShift' });
		await shifts.editShift('sh', { capacity: 2 });

		expect(logOf('viaShift')).toEqual([]);
	});
});
