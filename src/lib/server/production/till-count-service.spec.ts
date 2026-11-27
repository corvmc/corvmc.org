import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * The door cash counts, against a real SQLite (#3273).
 *
 * The staff row's uniqueness is an index and its replacement is a batch, which
 * a mocked `db` would agree with. No test here expects a refusal for who made
 * a count: one person counting the whole till warns and is recorded.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', async () => ({
	db: testDb,
	getRowCount: (await import('#lib/server/db/row-count.js')).getRowCount
}));
const audit = vi.hoisted(() => ({ recordAuditEntry: vi.fn(async () => undefined) }));
vi.mock('#lib/server/audit/audit-service.js', () => audit);

const { recordHandoff, removeHandoff, recordStaffCount, handoffOwner, TillCountNotFoundError } =
	await import('./till-count-service');
const { tillSummary } = await import('./till-summary');
const { getSettlement } = await import('./settlement-service');
const { transitionProduction } = await import('./production-service');
const { ProductionTerminalError } = await import('./production-scope');
const { ProductionNotFoundError } = await import('./production-service');

const figures = (cashCents: number | null, splitActsPercent: number | null = null) => ({
	cashCents,
	count: 80,
	splitActsPercent
});

const kinds = () =>
	sqlite
		.prepare(
			`select kind, cash_cents as cash, counted_by_user_id as by from production_till_count
			 where production_id = 'prod' order by kind, cash_cents`
		)
		.all();

beforeEach(() => {
	vi.clearAllMocks();
	sqlite.exec(`
		delete from production_till_count; delete from production; delete from event_listing;
		delete from project; delete from user;
		insert into user (id, name, email) values ('ana', 'Ana', 'ana@example.com'),
			('ben', 'Ben', 'ben@example.com');
		insert into project (id, name, kind) values ('proj', 'Show', 'production');
		insert into production (id, project_id, status) values ('prod', 'proj', 'completed');
		insert into event_listing (id, title, starts_at, ends_at, status, source, kind, created_by_user_id, project_id)
			values ('ev', 'Show', 0, 1, 'published', 'cmc', 'show', 'ana', 'proj');
	`);
});

describe('a handoff', () => {
	it('records who counted and when, and a show can have many', async () => {
		await recordHandoff('prod', 'ana', 200_00);
		await recordHandoff('prod', 'ben', 300_00);
		const summary = await tillSummary('prod');
		expect(summary.handoffs.map((h) => [h.cashCents, h.byName])).toEqual(
			expect.arrayContaining([
				[200_00, 'Ana'],
				[300_00, 'Ben']
			])
		);
		expect(summary.handoffs.every((h) => h.at instanceof Date)).toBe(true);
		expect(summary.handoffTotalCents).toBe(500_00);
	});

	it('is removed by id, and a missing one is not found', async () => {
		const id = await recordHandoff('prod', 'ana', 200_00);
		expect(await handoffOwner(id)).toEqual({
			productionId: 'prod',
			countedByUserId: 'ana',
			counterName: 'Ana',
			cashCents: 200_00
		});
		await removeHandoff(id);
		expect(kinds()).toEqual([]);
		expect(audit.recordAuditEntry).toHaveBeenCalledWith({
			action: 'production.till_count_removed',
			subject: { type: 'production', id: 'prod' },
			details: { cashCents: 200_00, counterName: 'Ana' }
		});
		await expect(removeHandoff(id)).rejects.toBeInstanceOf(TillCountNotFoundError);
	});

	it('refuses a closed show and a show that is not there', async () => {
		await expect(recordHandoff('nope', 'ana', 1)).rejects.toBeInstanceOf(ProductionNotFoundError);
		const id = await recordHandoff('prod', 'ana', 1);
		sqlite.exec(`update production set status = 'closed'`);
		await expect(recordHandoff('prod', 'ana', 1)).rejects.toBeInstanceOf(ProductionTerminalError);
		await expect(removeHandoff(id)).rejects.toBeInstanceOf(ProductionTerminalError);
		await expect(recordStaffCount('prod', 'ana', figures(1))).rejects.toBeInstanceOf(
			ProductionTerminalError
		);
	});
});

describe('the staff count', () => {
	it('replaces itself rather than adding a second, with the headcount and split', async () => {
		await recordStaffCount('prod', 'ana', figures(500_00));
		await recordStaffCount('prod', 'ben', figures(480_00, 60));
		expect(kinds()).toEqual([{ kind: 'staff', cash: 480_00, by: 'ben' }]);
		expect(
			sqlite.prepare('select door_count as c, door_split_acts_percent as s from production').get()
		).toEqual({ c: 80, s: 60 });
	});

	it('is cleared by an empty cash figure, which is not a zero', async () => {
		await recordStaffCount('prod', 'ana', figures(500_00));
		await recordStaffCount('prod', 'ana', figures(null));
		expect(kinds()).toEqual([]);
		await recordStaffCount('prod', 'ana', figures(0));
		expect(kinds()).toEqual([{ kind: 'staff', cash: 0, by: 'ana' }]);
	});

	it('audits a difference from the handoffs, and only a difference', async () => {
		await recordHandoff('prod', 'ana', 500_00);
		await recordStaffCount('prod', 'ben', figures(500_00));
		expect(audit.recordAuditEntry).not.toHaveBeenCalled();
		await recordStaffCount('prod', 'ben', figures(480_00));
		expect(audit.recordAuditEntry).toHaveBeenCalledWith(
			expect.objectContaining({
				action: 'production.door_recounted',
				details: { firstCents: 500_00, secondCents: 480_00 }
			})
		);
	});

	// The regression for the reversed #2722 rule: this used to throw
	// SameCounterError. It now records, and the summary says so.
	it('records one person making every count, and says so', async () => {
		await recordHandoff('prod', 'ana', 500_00);
		await recordStaffCount('prod', 'ana', figures(500_00));
		expect(kinds()).toHaveLength(2);
		expect(await tillSummary('prod')).toMatchObject({ check: 'agreed', oneCounter: true });
	});

	it('is not one counter when a second person counted a handoff', async () => {
		await recordHandoff('prod', 'ben', 200_00);
		await recordHandoff('prod', 'ana', 300_00);
		await recordStaffCount('prod', 'ana', figures(500_00));
		expect((await tillSummary('prod')).oneCounter).toBe(false);
	});
});

describe('the settlement reads the counts', () => {
	it('is absent until counted', async () => {
		const s = await getSettlement('ev');
		expect(s?.door).toBeNull();
		expect(s?.doorCounts).toBeNull();
	});

	it('uses the handoffs sum when there is no staff count, and the staff count when there is', async () => {
		await recordHandoff('prod', 'ana', 200_00);
		await recordHandoff('prod', 'ben', 300_00);
		const handoffsOnly = await getSettlement('ev');
		expect(handoffsOnly?.door?.cashCents).toBe(500_00);
		expect(handoffsOnly?.doorCounts).toMatchObject({ check: 'single', staff: null });

		await recordStaffCount('prod', 'ana', figures(480_00));
		const counted = await getSettlement('ev');
		expect(counted?.door?.cashCents).toBe(480_00);
		expect(counted?.doorCounts).toMatchObject({
			check: 'mismatch',
			oneCounter: false,
			staff: { cashCents: 480_00, byName: 'Ana' }
		});
		expect(counted?.doorCounts?.handoffs).toHaveLength(2);
	});

	it('derives settled from the payouts, not from the status', async () => {
		expect((await getSettlement('ev'))?.settled).toBe(false);
		sqlite.exec(`
			insert into production_slot (id, production_id, sort_order, set_length_minutes, paid_cents)
			values ('s1', 'prod', 1, 30, 100), ('s2', 'prod', 2, 30, null);
		`);
		expect((await getSettlement('ev'))?.settled).toBe(false);
		sqlite.exec(`update production_slot set paid_cents = 0 where id = 's2'`);
		expect((await getSettlement('ev'))?.settled).toBe(true);
		expect((await getSettlement('ev'))?.status).toBe('completed');
	});
});

describe('settling warns from the counts', () => {
	const warningsFor = async () => {
		sqlite.exec(`update production set status = 'completed'`);
		return (await transitionProduction('prod', 'settled')).warnings;
	};

	it('says nothing for an uncounted show and for counts that agree between two people', async () => {
		expect(await warningsFor()).toEqual([]);
		await recordHandoff('prod', 'ben', 500_00);
		await recordStaffCount('prod', 'ana', figures(500_00));
		expect(await warningsFor()).toEqual([]);
	});

	it('warns on one kind of count, a mismatch and one counter, and never refuses', async () => {
		await recordHandoff('prod', 'ana', 500_00);
		expect(await warningsFor()).toEqual(['The door cash was counted once.']);

		await recordStaffCount('prod', 'ana', figures(480_00));
		expect(await warningsFor()).toEqual([
			'The staff count and the handoff counts differ.',
			'One person made every door cash count.'
		]);
	});
});
