import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * The Contacts list (#2760) against a real SQLite: role, type, search and
 * archived filters, each sort, paging, and a viewer who may read only some
 * roles. People rows are written with raw SQL, so this file never names the
 * guarded contact table.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite({ foreignKeys: true });
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));
const auth = vi.hoisted(() => ({
	requireCapability: vi.fn(async (_cap: string) => ({ id: 'staff-1' })),
	requireUser: () => ({ id: 'staff-1' }),
	can: vi.fn(async () => true)
}));
vi.mock('#lib/server/authorization.js', () => auth);

const { listContacts } = await import('./contact-list');

const sec = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const STAFF = { visibleRoles: 'all', people: true } as const;
const ids = (r: { rows: { id: string }[] }) => r.rows.map((x) => x.id);

beforeEach(() => {
	auth.requireCapability.mockClear();
	sqlite.exec(`
		delete from activity; delete from work_order_link; delete from work_order;
		delete from party_role; delete from contact; delete from organization;
		insert into organization (id, name, website, archived_at) values
			('o-arts', 'Arts Council', 'artscouncil.example', null),
			('o-amps', 'Amp Shop', null, null),
			('o-bare', 'Bare Co', null, null),
			('o-old', 'Old Trust', null, ${sec('2026-01-01T00:00:00Z')});
		insert into party_role (id, organization_id, role) values
			('r1', 'o-arts', 'funder'), ('r2', 'o-amps', 'sponsor'), ('r3', 'o-amps', 'supplier'),
			('r4', 'o-old', 'funder');
		insert into contact (id, organization_id, name, email, source, created_at) values
			('p-main', 'o-amps', 'Zed Main', null, 'staff_entered', 1),
			('p-later', 'o-amps', 'Second', null, 'staff_entered', 2),
			('p-donor', null, 'Dana Donor', null, 'staff_entered', 1),
			('p-loose', null, null, 'loose@example.test', 'staff_entered', 1);
		insert into party_role (id, contact_id, role) values ('r5', 'p-donor', 'donor');
		insert into activity (id, organization_id, contact_id, kind, occurred_on, body) values
			('a1', 'o-arts', null, 'note', '2026-10-01', 'x'),
			('a2', 'o-amps', null, 'note', '2026-11-01', 'x'),
			('a3', null, 'p-donor', 'call', '2026-09-01', 'x');
		insert into work_order (id, title, due_at) values
			('w1', 'Later', ${sec('2026-12-20T20:00:00Z')}),
			('w2', 'Sooner', ${sec('2026-12-01T20:00:00Z')});
		insert into work_order_link (id, work_order_id, organization_id, contact_id) values
			('l1', 'w1', 'o-arts', null), ('l2', 'w2', null, 'p-donor');
	`);
});

describe('the Contacts list filters', () => {
	it('lists every live organization and every person with none, by name', async () => {
		const page = await listContacts(STAFF);
		expect(ids(page)).toEqual(['o-amps', 'o-arts', 'o-bare', 'p-donor', 'p-loose']);
		expect(page.rows.find((r) => r.id === 'o-amps')).toMatchObject({
			type: 'organization',
			mainPerson: 'Zed Main',
			roles: expect.arrayContaining(['sponsor', 'supplier'])
		});
		expect(page.rows.find((r) => r.id === 'p-loose')).toMatchObject({
			type: 'person',
			name: 'loose@example.test'
		});
	});

	it('takes any of several roles, for organizations and people alike', async () => {
		expect(ids(await listContacts({ ...STAFF, roles: ['funder', 'donor'] }))).toEqual([
			'o-arts',
			'p-donor'
		]);
		expect(ids(await listContacts({ ...STAFF, roles: ['supplier'] }))).toEqual(['o-amps']);
	});

	it('narrows to one type', async () => {
		expect(ids(await listContacts({ ...STAFF, type: 'person' }))).toEqual(['p-donor', 'p-loose']);
		expect(ids(await listContacts({ ...STAFF, type: 'organization' }))).toEqual([
			'o-amps',
			'o-arts',
			'o-bare'
		]);
	});

	it('searches name, main person and website', async () => {
		expect(ids(await listContacts({ ...STAFF, search: 'bare' }))).toEqual(['o-bare']);
		expect(ids(await listContacts({ ...STAFF, search: 'zed' }))).toEqual(['o-amps']);
		expect(ids(await listContacts({ ...STAFF, search: 'COUNCIL.EX' }))).toEqual(['o-arts']);
	});

	it('shows archived organizations only on request', async () => {
		const all = await listContacts({ ...STAFF, includeArchived: true, roles: ['funder'] });
		expect(ids(all)).toEqual(['o-arts', 'o-old']);
	});
});

describe('the Contacts list sorts', () => {
	it('runs name both ways', async () => {
		expect(ids(await listContacts({ ...STAFF, type: 'organization', sort: '-name' }))).toEqual([
			'o-bare',
			'o-arts',
			'o-amps'
		]);
	});

	it('runs last activity both ways, with none last either way', async () => {
		expect(ids(await listContacts({ ...STAFF, sort: '-activity' }))).toEqual([
			'o-amps',
			'o-arts',
			'p-donor',
			'o-bare',
			'p-loose'
		]);
		expect(ids(await listContacts({ ...STAFF, sort: 'activity' })).slice(0, 3)).toEqual([
			'p-donor',
			'o-arts',
			'o-amps'
		]);
	});

	it('runs next task by due date, with none last', async () => {
		const page = await listContacts({ ...STAFF, sort: 'task' });
		expect(ids(page).slice(0, 2)).toEqual(['p-donor', 'o-arts']);
		expect(ids(await listContacts({ ...STAFF, sort: '-task' })).slice(0, 2)).toEqual([
			'o-arts',
			'p-donor'
		]);
	});

	it('sorts before it pages', async () => {
		const second = await listContacts({ ...STAFF, sort: '-name', page: 2, pageSize: 2 });
		expect(ids(second)).toEqual(['o-bare', 'o-arts']);
		expect(second.pagination).toMatchObject({ total: 5, totalPages: 3 });
	});
});

describe('a viewer who may read only some roles', () => {
	const FUNDING = { visibleRoles: ['funder', 'sponsor'], people: false } as const;

	it('sees only those roles’ organizations, with no people and no main person', async () => {
		const page = await listContacts(FUNDING);
		expect(ids(page)).toEqual(['o-amps', 'o-arts']);
		expect(page.rows.every((r) => r.mainPerson === null)).toBe(true);
		expect(auth.requireCapability).not.toHaveBeenCalled();
	});

	it('cannot widen past them with a role filter or a main-person search', async () => {
		expect(ids(await listContacts({ ...FUNDING, roles: ['supplier', 'funder'] }))).toEqual([
			'o-arts'
		]);
		expect(ids(await listContacts({ ...FUNDING, search: 'zed' }))).toEqual([]);
	});
});
