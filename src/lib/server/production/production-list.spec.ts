import { describe, it, expect, beforeAll, vi } from 'vitest';

// The list is a join and an order, so it runs against the real schema.
const { testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', async () => ({
	db: testDb,
	getRowCount: (await import('#lib/server/db/row-count.js')).getRowCount
}));

const { listProductions } = await import('./production-list');

const STAFF = 'usr-staff';

beforeAll(async () => {
	const { user } = await import('#lib/server/db/schema/authentication.js');
	const { eventListing } = await import('#lib/server/db/schema/event.js');
	const { project } = await import('#lib/server/db/schema/project.js');
	const { production } = await import('#lib/server/db/schema/production.js');

	await testDb
		.insert(user)
		.values({ id: STAFF, name: 'Staff', email: 's@example.com', emailVerified: false } as never);
	await testDb.insert(project).values([
		{ id: 'proj-listed', name: 'Listed show', kind: 'production' },
		{
			id: 'proj-unlisted',
			name: 'Unlisted show',
			kind: 'production',
			startsAt: new Date('2026-05-01T02:00:00Z')
		},
		{ id: 'proj-undated', name: 'Undated show', kind: 'production' }
	] as never);
	await testDb.insert(eventListing).values({
		id: 'evt-listed',
		title: 'Listed show',
		startsAt: new Date('2026-03-04T02:00:00Z'),
		endsAt: new Date('2026-03-04T05:00:00Z'),
		createdByUserId: STAFF,
		status: 'draft',
		source: 'cmc',
		kind: 'show',
		projectId: 'proj-listed'
	} as never);
	await testDb.insert(production).values([
		{ id: 'prod-listed', status: 'confirmed', projectId: 'proj-listed', actsWanted: 2 },
		{ id: 'prod-unlisted', status: 'draft', projectId: 'proj-unlisted' },
		{ id: 'prod-undated', status: 'closed', projectId: 'proj-undated' }
	] as never);
});

describe('listProductions', () => {
	it('lists every production, listed or not, newest first and undated last', async () => {
		const { rows, pagination } = await listProductions();
		expect(rows.map((r) => r.id)).toEqual(['prod-unlisted', 'prod-listed', 'prod-undated']);
		expect(pagination.total).toBe(3);
	});

	it('carries the listing where there is one', async () => {
		const { rows } = await listProductions();
		const byId = new Map(rows.map((r) => [r.id, r]));
		expect(byId.get('prod-listed')?.listing).toMatchObject({ id: 'evt-listed', status: 'draft' });
		expect(byId.get('prod-unlisted')?.listing).toBeNull();
	});

	it('finds bills short of the acts their production wants', async () => {
		const { rows } = await listProductions({ needsActs: true });
		expect(rows.map((r) => r.id)).toEqual(['prod-listed']);
	});

	it('filters by the production status', async () => {
		const { rows, pagination } = await listProductions({ status: 'closed' });
		expect(rows.map((r) => r.id)).toEqual(['prod-undated']);
		expect(pagination.total).toBe(1);
	});

	// 2026-03-04T02:00Z is 3 March in club time; 2026-05-01T02:00Z is 30 April.
	const now = new Date('2026-03-01T20:00:00Z');

	it('lists a custom range by the listing date, else the project date, soonest first', async () => {
		const { rows, pagination } = await listProductions(
			{ range: 'custom', from: '2026-03-01', to: '2026-04-30' },
			{},
			now
		);
		expect(rows.map((r) => r.id)).toEqual(['prod-listed', 'prod-unlisted']);
		expect(pagination.total).toBe(2);
	});

	it('leaves a production out once its date falls outside the range', async () => {
		const april = await listProductions(
			{ range: 'custom', from: '2026-04-01', to: '2026-04-29' },
			{},
			now
		);
		expect(april.rows).toEqual([]);
		const week = await listProductions({ range: 'next_7' }, {}, now);
		expect(week.rows.map((r) => r.id)).toEqual(['prod-listed']);
	});

	it('keeps undated productions under Any date only', async () => {
		const fromToday = await listProductions({ range: 'from_today' }, {}, now);
		expect(fromToday.rows.map((r) => r.id)).not.toContain('prod-undated');
		const any = await listProductions({ range: 'any' }, {}, now);
		expect(any.rows.map((r) => r.id)).toContain('prod-undated');
	});
});
