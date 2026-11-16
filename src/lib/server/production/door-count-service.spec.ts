import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Two counts of the drawer, against a real SQLite (#2722).
 *
 * The same-person refusal and the "restamp only when the figure changes" rule
 * live in the UPDATE's WHERE and CASE, which a mocked `db` would agree with.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));
const audit = vi.hoisted(() => ({ recordAuditEntry: vi.fn(async () => undefined) }));
vi.mock('#lib/server/audit/audit-service.js', () => audit);

const { recordDoorTake, recordDoorRecount, SameCounterError, DoorNotCountedError } =
	await import('./door-count-service');
const { getSettlement } = await import('./settlement-service');
const { ProductionTerminalError } = await import('./production-scope');

const take = (cashCents: number | null, splitActsPercent: number | null = null) => ({
	cashCents,
	count: 80,
	splitActsPercent
});

const row = () =>
	sqlite
		.prepare(
			`select door_cash_cents as first, door_cash_counted_by_user_id as firstBy,
				door_cash_recount_cents as second, door_cash_recounted_by_user_id as secondBy
			 from production where id = 'prod'`
		)
		.get() as {
		first: number | null;
		firstBy: string | null;
		second: number | null;
		secondBy: string | null;
	};

beforeEach(() => {
	vi.clearAllMocks();
	sqlite.exec(`
		delete from production; delete from event_listing; delete from project; delete from user;
		insert into user (id, name, email) values ('ana', 'Ana', 'ana@example.com'),
			('ben', 'Ben', 'ben@example.com');
		insert into project (id, name, kind) values ('proj', 'Show', 'production');
		insert into production (id, project_id, status) values ('prod', 'proj', 'completed');
		insert into event_listing (id, title, starts_at, ends_at, status, source, kind, created_by_user_id, project_id)
			values ('ev', 'Show', 0, 1, 'published', 'cmc', 'show', 'ana', 'proj');
	`);
});

describe('the first count', () => {
	it('stamps who counted, and leaves them when only the split changes', async () => {
		await recordDoorTake('prod', 'ana', take(500_00));
		await recordDoorTake('prod', 'ben', take(500_00, 50));
		expect(row()).toMatchObject({ first: 500_00, firstBy: 'ana' });
	});

	it('restamps the counter when the figure changes', async () => {
		await recordDoorTake('prod', 'ana', take(500_00));
		await recordDoorTake('prod', 'ben', take(480_00));
		expect(row()).toMatchObject({ first: 480_00, firstBy: 'ben' });
	});

	it('clears the second count with the first', async () => {
		await recordDoorTake('prod', 'ana', take(500_00));
		await recordDoorRecount('prod', 'ben', 500_00);
		await recordDoorTake('prod', 'ana', take(null));
		expect(row()).toEqual({ first: null, firstBy: null, second: null, secondBy: null });
	});

	it('refuses the second counter changing the first figure', async () => {
		await recordDoorTake('prod', 'ana', take(500_00));
		await recordDoorRecount('prod', 'ben', 480_00);
		await expect(recordDoorTake('prod', 'ben', take(480_00))).rejects.toBeInstanceOf(
			SameCounterError
		);
		expect(row()).toMatchObject({ first: 500_00, firstBy: 'ana' });
		// The split is not the count, so the second counter may still change it.
		await recordDoorTake('prod', 'ben', take(500_00, 60));
	});
});

describe('the second count', () => {
	it('refuses the person who made the first count', async () => {
		await recordDoorTake('prod', 'ana', take(500_00));
		await expect(recordDoorRecount('prod', 'ana', 500_00)).rejects.toBeInstanceOf(SameCounterError);
		expect(row().second).toBeNull();
	});

	it('refuses a second count of a drawer nobody counted', async () => {
		await expect(recordDoorRecount('prod', 'ben', 500_00)).rejects.toBeInstanceOf(
			DoorNotCountedError
		);
	});

	it('records a count that differs, and audits both figures', async () => {
		await recordDoorTake('prod', 'ana', take(500_00));
		await recordDoorRecount('prod', 'ben', 480_00);
		expect(row()).toMatchObject({ second: 480_00, secondBy: 'ben' });
		expect(audit.recordAuditEntry).toHaveBeenCalledWith(
			expect.objectContaining({
				action: 'production.door_recounted',
				details: { firstCents: 500_00, secondCents: 480_00 }
			})
		);
	});

	it('takes a second count back', async () => {
		await recordDoorTake('prod', 'ana', take(500_00));
		await recordDoorRecount('prod', 'ben', 480_00);
		await recordDoorRecount('prod', 'ana', null);
		expect(row()).toMatchObject({ first: 500_00, second: null, secondBy: null });
	});

	it('refuses either count on a closed show', async () => {
		sqlite.exec(`update production set status = 'closed'`);
		await expect(recordDoorTake('prod', 'ana', take(1))).rejects.toBeInstanceOf(
			ProductionTerminalError
		);
		await expect(recordDoorRecount('prod', 'ben', 1)).rejects.toBeInstanceOf(
			ProductionTerminalError
		);
	});
});

describe('the settlement reads both counts', () => {
	it('is absent until counted', async () => {
		expect((await getSettlement('ev'))?.doorCounts).toBeNull();
	});

	it('names both counters and tells agreement from a mismatch', async () => {
		await recordDoorTake('prod', 'ana', take(500_00));
		expect((await getSettlement('ev'))?.doorCounts).toMatchObject({
			check: 'single',
			first: { byName: 'Ana' },
			second: null
		});

		await recordDoorRecount('prod', 'ben', 480_00);
		expect((await getSettlement('ev'))?.doorCounts).toMatchObject({
			check: 'mismatch',
			second: { cashCents: 480_00, byName: 'Ben' }
		});

		await recordDoorRecount('prod', 'ben', 500_00);
		expect((await getSettlement('ev'))?.doorCounts?.check).toBe('agreed');
	});
});
