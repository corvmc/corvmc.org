import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Completing an engagement ticks its work order; ticking the work order does not
 * complete the engagement. Both directions cross two services and two tables,
 * so they run against a real SQLite.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite();
});

vi.mock('$lib/server/db', () => ({ db: testDb }));

const { completeJob } = await import('./contractor-job-service');
const { resolveWorkOrder } = await import('$lib/server/volunteer/work-order-service');
// `resolveWorkOrder` imports these lazily; loading them here keeps that cost
// out of the first test's 5s budget on a cold cache.
await import('$lib/server/inventory/work-request-service');
await import('$lib/server/volunteer/orientation-service');

const row = (sql: string) => sqlite.prepare(sql).get() as Record<string, unknown>;

beforeEach(() => {
	for (const table of ['financial_entry', 'contractor_job', 'work_order', 'contractor']) {
		sqlite.exec(`delete from ${table}`);
	}
	sqlite.exec(
		`insert into contractor (id, name, trade) values ('c-1', 'Benton Electric', 'electrical')`
	);
	sqlite.exec(`insert into work_order (id, title) values ('wo-1', 'Add a dedicated circuit')`);
	sqlite.exec(
		`insert into contractor_job (id, contractor_id, work_order_id, status)
			values ('job-1', 'c-1', 'wo-1', 'booked')`
	);
});

describe('an engagement and its work order', () => {
	it('completing the engagement resolves the work order', async () => {
		await completeJob('job-1', { costCents: 94_500, actorId: 'staff-1' });

		expect(row(`select status, completed_at from contractor_job where id = 'job-1'`)).toMatchObject(
			{ status: 'completed', completed_at: expect.any(Number) }
		);
		expect(
			row(`select resolved_at, resolved_by_user_id from work_order where id = 'wo-1'`)
		).toMatchObject({ resolved_at: expect.any(Number), resolved_by_user_id: 'staff-1' });
	});

	it('keeps the resolution staff already recorded', async () => {
		sqlite.exec(`update work_order set resolved_at = 1000, resolved_by_user_id = 'staff-0'`);

		await completeJob('job-1', { actorId: 'staff-1' });

		expect(row(`select resolved_at, resolved_by_user_id from work_order`)).toEqual({
			resolved_at: 1000,
			resolved_by_user_id: 'staff-0'
		});
	});

	it('resolving the work order leaves the engagement where it was', async () => {
		await resolveWorkOrder('wo-1', { resolvedByUserId: 'staff-1' });

		expect(row(`select status, completed_at from contractor_job where id = 'job-1'`)).toEqual({
			status: 'booked',
			completed_at: null
		});
	});
});
