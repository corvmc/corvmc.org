import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * The jobs list's filters are WHERE clauses over two derived states — late and
 * awaiting invoice — so they run against a real SQLite, along with the tab
 * counts that must agree with them.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite();
});

vi.mock('$lib/server/db', () => ({ db: testDb }));

const { listJobs, countJobsByView } = await import('./contractor-job-service');

const NOW = new Date('2026-10-13T12:00:00Z');
const sec = (d: string) => Math.floor(new Date(d).getTime() / 1000);

function job(id: string, status: string, extra: Record<string, number | null> = {}) {
	const cols = ['id', 'contractor_id', 'work_order_id', 'status', ...Object.keys(extra)];
	const vals = [`'${id}'`, `'c-1'`, `'wo-1'`, `'${status}'`, ...Object.values(extra).map(String)];
	sqlite.exec(`insert into contractor_job (${cols.join(', ')}) values (${vals.join(', ')})`);
}

beforeEach(() => {
	for (const table of ['contractor_job', 'work_order', 'contractor']) {
		sqlite.exec(`delete from ${table}`);
	}
	sqlite.exec(
		`insert into contractor (id, name, trade) values ('c-1', 'Benton Electric', 'electrical')`
	);
	sqlite.exec(`insert into work_order (id, title) values ('wo-1', 'Add a dedicated circuit')`);

	job('asked', 'asked');
	job('booked-on-time', 'booked', { expected_back_at: sec('2026-10-20') });
	job('booked-late', 'booked', { expected_back_at: sec('2026-10-01') });
	job('booked-undated', 'booked');
	job('done-no-cost', 'completed');
	job('done-paid', 'completed', { cost_cents: 12_000 });
	job('done-donated', 'completed', { is_donated: 1, fair_value_cents: 30_000 });
	job('declined', 'declined');
	job('no-show', 'no_show', { expected_back_at: sec('2026-10-01') });
	job('cancelled', 'cancelled');
});

const ids = async (view: Parameters<typeof listJobs>[0]) =>
	(await listJobs({ ...view, now: NOW })).map((r) => r.job.id).sort();

describe('jobs list filters', () => {
	it('Open is everyone asked or booked', async () => {
		expect(await ids({ view: 'open' })).toEqual(
			['asked', 'booked-late', 'booked-on-time', 'booked-undated'].sort()
		);
	});

	it('Late is booked with a promised date behind us', async () => {
		expect(await ids({ view: 'late' })).toEqual(['booked-late']);
	});

	it('Awaiting invoice is finished, uncosted and not donated', async () => {
		expect(await ids({ view: 'awaiting-invoice' })).toEqual(['done-no-cost']);
	});

	it('All is everything', async () => {
		expect(await ids({ view: 'all' })).toHaveLength(10);
	});

	it("flags each row Late or Awaiting invoice by the filters' own predicates", async () => {
		const rows = await listJobs({ view: 'all', now: NOW });
		const flagged = (key: 'late' | 'awaitingInvoice') =>
			rows
				.filter((r) => r[key])
				.map((r) => r.job.id)
				.sort();
		expect(flagged('late')).toEqual(await ids({ view: 'late' }));
		expect(flagged('awaitingInvoice')).toEqual(await ids({ view: 'awaiting-invoice' }));
	});

	it('narrows to the given work orders, and to nothing for none', async () => {
		sqlite.exec(`insert into work_order (id, title) values ('wo-2', 'Other work')`);
		sqlite.exec(
			`insert into contractor_job (id, contractor_id, work_order_id, status) values ('elsewhere', 'c-1', 'wo-2', 'asked')`
		);
		expect(await ids({ workOrderIds: ['wo-2'] })).toEqual(['elsewhere']);
		expect(await ids({ workOrderIds: [] })).toEqual([]);
	});

	it('counts each filter with the same predicates', async () => {
		expect(await countJobsByView(NOW)).toEqual({
			open: 4,
			late: 1,
			'awaiting-invoice': 1,
			all: 10
		});
	});
});
