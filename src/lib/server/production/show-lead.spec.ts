import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * A show's event lead (#2726), against a real SQLite: who leads, what leading
 * grants, who hears about it, and which shows reach the lead's dashboard.
 */
const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', async () => ({
	db: testDb,
	getRowCount: (await import('#lib/server/db/row-count.js')).getRowCount
}));
vi.mock('./run-of-show-service', () => ({ recomputeSetTimes: async () => undefined }));
const emit = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('#lib/server/event-bus/event-bus.js', () => ({ domainEvents: { emit } }));

const {
	leadsProject,
	leadsOpenShow,
	roleGrantAllowsOnProject,
	roleGrantAllows,
	holdsLeadOnOpenShow
} = await import('#lib/server/capability/capability-grants.js');
const { EVENT_LEAD_VOLUNTEER_ROLE } = await import('#lib/config.js');
const { userHasCapability } = await import('#lib/server/authorization.js');
const {
	setShowLead,
	listShowsLedBy,
	searchLeadCandidates,
	ShowLeadNotFoundError,
	ensureLeadTask,
	getShowLead
} = await import('./show-lead-service');

const SHOW = 'proj-show';
const OTHER = 'proj-other';
const NOW = new Date('2031-05-01T19:00:00Z');
const secs = (d: Date) => Math.floor(d.getTime() / 1000);
const HOUR = 3_600_000;

function exec(sql: string) {
	sqlite.exec(sql);
}

function show(project: string, prod: string, evt: string, startsAt: Date, status = 'confirmed') {
	exec(`insert into project (id, name, kind) values ('${project}', '${project}', 'production')`);
	exec(
		`insert into production (id, project_id, status) values ('${prod}', '${project}', '${status}')`
	);
	exec(`insert into event_listing (id, title, starts_at, ends_at, created_by_user_id, source, kind, project_id)
		values ('${evt}', 'Show ${evt}', ${secs(startsAt)}, ${secs(startsAt) + 10800}, 'u-staff', 'cmc', 'show', '${project}')`);
}

const lead = (prod: string) =>
	(
		sqlite.prepare('select producer_user_id as id from production where id = ?').get(prod) as {
			id: string | null;
		}
	).id;

beforeEach(() => {
	vi.clearAllMocks();
	for (const t of [
		'work_order_assignee',
		'work_order',
		'volunteer_role_capability',
		'volunteer_role',
		'event_listing',
		'production',
		'project',
		'user'
	]) {
		exec(`delete from ${t}`);
	}
	for (const u of ['u-staff', 'u-lead', 'u-other']) {
		exec(
			`insert into user (id, name, email, email_verified) values ('${u}', 'Name ${u}', '${u}@x.test', 0)`
		);
	}
	exec(
		`insert into user (id, name, email, email_verified, deleted_at) values ('u-gone', 'Name gone', 'g@x.test', 0, 1)`
	);
	show(SHOW, 'prod-1', 'evt-1', new Date(NOW.getTime() + 48 * HOUR));
	show(OTHER, 'prod-2', 'evt-2', new Date(NOW.getTime() + 72 * HOUR));
});

describe('leading a show', () => {
	it('gives production.run on that show only, and never production.book', async () => {
		await setShowLead('prod-1', 'u-lead', 'u-staff');

		expect(lead('prod-1')).toBe('u-lead');
		expect(await leadsProject('u-lead', SHOW)).toBe(true);
		expect(await leadsProject('u-lead', OTHER)).toBe(false);
		expect(await leadsProject('u-other', SHOW)).toBe(false);
		expect(await userHasCapability('u-lead', 'production.run', { projectId: SHOW })).toBe(true);
		expect(await userHasCapability('u-lead', 'production.run', { projectId: OTHER })).toBe(false);
		expect(await userHasCapability('u-lead', 'production.book', { projectId: SHOW })).toBe(false);
	});

	it('opens the staff panel while the show is open, and not once it is cancelled', async () => {
		await setShowLead('prod-1', 'u-lead', 'u-staff');
		expect(await leadsOpenShow('u-lead')).toBe(true);
		exec(`update production set status = 'cancelled' where id = 'prod-1'`);
		expect(await leadsOpenShow('u-lead')).toBe(false);
	});

	it('clears the lead, and the grant with it', async () => {
		await setShowLead('prod-1', 'u-lead', 'u-staff');
		await setShowLead('prod-1', null, 'u-staff');
		expect(lead('prod-1')).toBeNull();
		expect(await leadsProject('u-lead', SHOW)).toBe(false);
	});

	it('refuses an account that is gone', async () => {
		await expect(setShowLead('prod-1', 'u-gone', 'u-staff')).rejects.toBeInstanceOf(
			ShowLeadNotFoundError
		);
		expect(lead('prod-1')).toBeNull();
	});
});

describe('telling the lead', () => {
	it('tells a lead somebody else named, once', async () => {
		await setShowLead('prod-1', 'u-lead', 'u-staff');
		await setShowLead('prod-1', 'u-lead', 'u-staff');

		expect(emit).toHaveBeenCalledTimes(1);
		expect(emit).toHaveBeenCalledWith(
			'production.lead_assigned',
			expect.objectContaining({
				eventId: 'evt-1',
				leadUserId: 'u-lead',
				leadEmail: 'u-lead@x.test',
				assignedByName: 'Name u-staff'
			})
		);
	});

	it('says nothing to somebody who named themselves, or when the lead is cleared', async () => {
		await setShowLead('prod-1', 'u-lead', 'u-lead');
		await setShowLead('prod-1', null, 'u-staff');
		expect(emit).not.toHaveBeenCalled();
	});
});

describe('the shows a member leads', () => {
	it('lists open shows soonest first, through the night of the show', async () => {
		show('proj-3', 'prod-3', 'evt-3', new Date(NOW.getTime() - 2 * HOUR));
		show('proj-4', 'prod-4', 'evt-4', new Date(NOW.getTime() - 48 * HOUR));
		show('proj-5', 'prod-5', 'evt-5', new Date(NOW.getTime() + HOUR), 'cancelled');
		exec(
			`update production set producer_user_id = 'u-lead' where id in ('prod-1','prod-2','prod-3','prod-4','prod-5')`
		);

		const led = await listShowsLedBy('u-lead', NOW);
		expect(led.map((s) => s.eventId)).toEqual(['evt-3', 'evt-1', 'evt-2']);
		expect(await listShowsLedBy('u-other', NOW)).toEqual([]);
	});

	it('finds candidates by name and leaves out closed accounts', async () => {
		const found = await searchLeadCandidates('Name');
		expect(found.map((u) => u.id).sort()).toEqual(['u-lead', 'u-other', 'u-staff']);
		expect(found[0]).not.toHaveProperty('email');
	});
});

/**
 * The event lead as a volunteer role (#3274): a task with no shift, whose
 * assignee holds `production.run` on the show's project and `event.manageGuests`
 * on its event, from assignment until `graceDays` after the show.
 */
describe('the Event lead role', () => {
	const DAY = 24 * HOUR;
	const showStart = new Date(NOW.getTime() + 48 * HOUR);

	function leadRole(caps = ['production.run', 'event.manageGuests']) {
		exec(
			`insert into volunteer_role (id, name) values ('role-lead', '${EVENT_LEAD_VOLUNTEER_ROLE}')`
		);
		for (const c of caps) {
			exec(
				`insert into volunteer_role_capability (volunteer_role_id, capability) values ('role-lead', '${c}')`
			);
		}
	}
	const assign = (taskId: string, userId: string) =>
		exec(
			`insert into work_order_assignee (work_order_id, user_id) values ('${taskId}', '${userId}')`
		);

	it('gives the assignee production.run on that show only, never production.book', async () => {
		leadRole();
		const task = await ensureLeadTask('evt-1');
		assign(task!, 'u-lead');

		expect(await userHasCapability('u-lead', 'production.run', { projectId: SHOW })).toBe(true);
		expect(await userHasCapability('u-lead', 'production.run', { projectId: OTHER })).toBe(false);
		expect(await userHasCapability('u-lead', 'production.book', { projectId: SHOW })).toBe(false);
		expect(await userHasCapability('u-other', 'production.run', { projectId: SHOW })).toBe(false);
		expect(await userHasCapability('u-lead', 'event.manageGuests', { eventId: 'evt-1' })).toBe(
			true
		);
		expect(await userHasCapability('u-lead', 'event.manageGuests', { eventId: 'evt-2' })).toBe(
			false
		);
	});

	it('holds from assignment, however far ahead the show is, and ends after graceDays', async () => {
		leadRole();
		assign((await ensureLeadTask('evt-1'))!, 'u-lead');
		const ends = secs(showStart) + 10800;
		const at = (days: number) => new Date((ends + days * 86_400) * 1000);

		const farAhead = new Date(showStart.getTime() - 400 * DAY);
		expect(await roleGrantAllowsOnProject('u-lead', 'production.run', SHOW, farAhead)).toBe(true);
		expect(await roleGrantAllows('u-lead', 'event.manageGuests', 'evt-1', farAhead)).toBe(true);
		expect(await roleGrantAllowsOnProject('u-lead', 'production.run', SHOW, at(6))).toBe(true);
		expect(await roleGrantAllowsOnProject('u-lead', 'production.run', SHOW, at(8))).toBe(false);
		expect(await roleGrantAllows('u-lead', 'event.manageGuests', 'evt-1', at(8))).toBe(false);
	});

	it('grants nothing once the task is called off', async () => {
		leadRole();
		assign((await ensureLeadTask('evt-1'))!, 'u-lead');
		exec(`update work_order set cancelled_at = ${secs(NOW)}`);

		expect(await userHasCapability('u-lead', 'production.run', { projectId: SHOW })).toBe(false);
		expect(await holdsLeadOnOpenShow('u-lead')).toBe(false);
	});

	it('opens the staff panel while the show is open, and not once it is cancelled', async () => {
		leadRole();
		assign((await ensureLeadTask('evt-1'))!, 'u-lead');
		expect(await holdsLeadOnOpenShow('u-lead')).toBe(true);
		expect(await holdsLeadOnOpenShow('u-other')).toBe(false);
		exec(`update production set status = 'cancelled' where id = 'prod-1'`);
		expect(await holdsLeadOnOpenShow('u-lead')).toBe(false);
	});

	it('grants only what the role carries', async () => {
		leadRole(['event.manageGuests']);
		assign((await ensureLeadTask('evt-1'))!, 'u-lead');
		expect(await userHasCapability('u-lead', 'production.run', { projectId: SHOW })).toBe(false);
		expect(await userHasCapability('u-lead', 'event.manageGuests', { eventId: 'evt-1' })).toBe(
			true
		);
	});

	it('makes the lead task once, and names who holds it', async () => {
		leadRole();
		const [a, b] = await Promise.all([ensureLeadTask('evt-1'), ensureLeadTask('evt-1')]);
		expect(a).not.toBeNull();
		expect(b).toBe(a);
		expect(await ensureLeadTask('evt-1')).toBe(a);
		expect(await getShowLead('evt-1')).toEqual({ workOrderId: a, people: [] });

		assign(a!, 'u-lead');
		expect((await getShowLead('evt-1'))?.people).toEqual([
			{ userId: 'u-lead', name: 'Name u-lead' }
		]);
	});

	it('makes no task, and says so, when the role does not exist', async () => {
		expect(await ensureLeadTask('evt-1')).toBeNull();
		expect(await getShowLead('evt-1')).toBeNull();
		expect(sqlite.prepare('select count(*) as n from work_order').get()).toEqual({ n: 0 });
	});
});
