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

const { leadsProject, leadsOpenShow } = await import('#lib/server/capability/capability-grants.js');
const { userHasCapability } = await import('#lib/server/authorization.js');
const { setShowLead, listShowsLedBy, searchLeadCandidates, ShowLeadNotFoundError } =
	await import('./show-lead-service');

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
	for (const t of ['event_listing', 'production', 'project', 'user']) exec(`delete from ${t}`);
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
