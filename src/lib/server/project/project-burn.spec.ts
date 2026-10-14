import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Contractor spend reaches a project through its work orders, and only from
 * engagements somebody worked. Both are SQL, so they run against a real SQLite.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite();
});

vi.mock('$lib/server/db', () => ({ db: testDb }));
vi.mock('$lib/server/volunteer/hour-value', () => ({ getHourValueCents: vi.fn(async () => 0) }));

const { getProjectBurn, listProjectAttachments } = await import('./project-service');

function engagement(id: string, workOrderId: string, status: string, money: string) {
	sqlite.exec(
		`insert into contractor_job (id, contractor_id, work_order_id, status, ${money.split('=')[0]})
			values ('${id}', 'c-1', '${workOrderId}', '${status}', ${money.split('=')[1]})`
	);
}

beforeEach(() => {
	for (const table of ['contractor_job', 'work_order', 'contractor', 'project']) {
		sqlite.exec(`delete from ${table}`);
	}
	sqlite.exec(
		`insert into project (id, name) values ('proj-1', 'Stage power'), ('proj-2', 'Other')`
	);
	sqlite.exec(
		`insert into contractor (id, name, trade) values ('c-1', 'Benton Electric', 'electrical')`
	);
	sqlite.exec(
		`insert into work_order (id, title, project_id) values
			('wo-1', 'Add a dedicated circuit', 'proj-1'),
			('wo-2', 'Somebody else''s circuit', 'proj-2')`
	);
});

describe('contractor burn', () => {
	it("counts engagements on the project's work orders, and only those", async () => {
		engagement('job-1', 'wo-1', 'completed', 'cost_cents=94500');
		engagement('job-2', 'wo-2', 'completed', 'cost_cents=10000');

		const burn = await getProjectBurn('proj-1');

		expect(burn.cash.contractorCents).toBe(94_500);
	});

	it('does not count a cancelled engagement that carries a cost', async () => {
		engagement('job-1', 'wo-1', 'completed', 'cost_cents=94500');
		engagement('job-2', 'wo-1', 'cancelled', 'cost_cents=30000');

		expect((await getProjectBurn('proj-1')).cash.contractorCents).toBe(94_500);
	});

	it('does not count a declined quote, cash or donated', async () => {
		engagement('job-1', 'wo-1', 'declined', 'cost_cents=30000');
		sqlite.exec(
			`insert into contractor_job (id, contractor_id, work_order_id, status, is_donated, fair_value_cents)
				values ('job-2', 'c-1', 'wo-1', 'declined', 1, 42000)`
		);

		const burn = await getProjectBurn('proj-1');

		expect(burn.cash.contractorCents).toBe(0);
		expect(burn.contributed.donatedServicesCents).toBe(0);
	});
});

describe('attached contractor jobs', () => {
	it('are the engagements on the project’s work orders, titled by them', async () => {
		engagement('job-1', 'wo-1', 'booked', 'quoted_cents=50000');
		engagement('job-2', 'wo-2', 'booked', 'quoted_cents=50000');

		const { jobs } = await listProjectAttachments('proj-1');

		expect(jobs.map((j) => [j.id, j.title, j.workOrderId])).toEqual([
			['job-1', 'Add a dedicated circuit', 'wo-1']
		]);
	});
});
