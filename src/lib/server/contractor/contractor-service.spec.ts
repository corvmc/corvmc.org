import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import type { SQL } from 'drizzle-orm';

/**
 * Contractors.
 *
 * Two rules are worth pinning. Archiving is a soft retire, because
 * `contractor_job.contractor_id` restricts deletion and the service history is
 * the point of the table. And the insurance list reads a date rather than a
 * status, which means it has to be explicit about the case a status would have
 * swallowed: a contractor we hold no certificate for is not lapsed, it is
 * unasked, and putting the two in one list makes the list unactionable.
 */

let selectResults: unknown[][] = [];
let updateValues: Record<string, unknown>[] = [];
let insertValues: unknown[] = [];
let whereArgs: unknown[] = [];

function chain(queue: () => unknown[]): unknown {
	const proxy: unknown = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') {
				return (resolve: (v: unknown[]) => void) => resolve(queue());
			}
			if (prop === 'where') {
				return (arg: unknown) => {
					whereArgs.push(arg);
					return proxy;
				};
			}
			return () => proxy;
		}
	});
	return proxy;
}

const next = () => (selectResults.length > 0 ? selectResults.shift()! : []);

// drizzle and the schema are real, so the predicate the service builds can be
// rendered to actual SQL and asserted on rather than taken on faith.
const dialect = new SQLiteSyncDialect();
const renderWhere = (index: number) => dialect.sqlToQuery(whereArgs[index] as SQL);

vi.mock('$lib/server/db', () => ({
	db: {
		select: vi.fn(() => chain(next)),
		insert: vi.fn(() => ({
			values: (v: unknown) => {
				insertValues.push(v);
				return chain(() => [{ id: 'c-1', ...(v as object) }]);
			}
		})),
		update: vi.fn(() => ({
			set: (values: Record<string, unknown>) => {
				updateValues.push(values);
				return chain(() => [{ id: 'c-1', ...values }]);
			}
		}))
	}
}));

const {
	createContractor,
	updateContractor,
	archiveContractor,
	getContractorById,
	listLapsingInsurance,
	ContractorNotFoundError
} = await import('./contractor-service');

beforeEach(() => {
	selectResults = [];
	updateValues = [];
	insertValues = [];
	whereArgs = [];
});

describe('getContractorById', () => {
	it('throws when there is no such contractor', async () => {
		selectResults = [[]];

		await expect(getContractorById('nope')).rejects.toThrow(ContractorNotFoundError);
	});
});

describe('createContractor', () => {
	it('stores the trade and the way to reach them', async () => {
		await createContractor({
			name: 'Corvallis Amp Works',
			trade: 'instrument_repair',
			phone: '541-555-0143'
		});

		expect(insertValues[0]).toMatchObject({
			name: 'Corvallis Amp Works',
			trade: 'instrument_repair',
			phone: '541-555-0143'
		});
	});
});

describe('updateContractor', () => {
	it('refuses to update one that does not exist', async () => {
		selectResults = [[]];

		await expect(updateContractor('nope', { name: 'x' })).rejects.toThrow(ContractorNotFoundError);
	});
});

describe('archiveContractor', () => {
	it('stamps a date rather than deleting the row', async () => {
		selectResults = [[{ id: 'c-1' }]];

		await archiveContractor('c-1');

		expect(updateValues[0].archivedAt).toBeInstanceOf(Date);
	});

	it('clears the stamp to bring somebody back', async () => {
		selectResults = [[{ id: 'c-1' }]];

		await archiveContractor('c-1', false);

		expect(updateValues[0].archivedAt).toBeNull();
	});
});

describe('listLapsingInsurance', () => {
	/**
	 * The horizon is the whole of the query, so it is the thing to assert on:
	 * `days` has to reach forward from `now`, not backward, or the list shows
	 * only the people whose cover has already run out — which is the report you
	 * wanted a warning instead of.
	 */
	it('looks forward by the window it was given', async () => {
		selectResults = [[]];
		const now = new Date('2026-09-01T00:00:00Z');

		await listLapsingInsurance(30, now);

		const horizon = Math.floor(new Date('2026-10-01T00:00:00Z').getTime() / 1000);
		expect(renderWhere(0).params).toContain(horizon);
	});

	/**
	 * Null is "we never asked for a certificate", which is a different problem
	 * from one that ran out and wants a different prompt. SQLite would drop the
	 * row from a bare `<=` anyway, but the intent is explicit in the predicate so
	 * that a later rewrite has to decide to change it.
	 */
	it('excludes contractors we hold no certificate for', async () => {
		selectResults = [[]];

		await listLapsingInsurance(30, new Date('2026-09-01T00:00:00Z'));

		expect(renderWhere(0).sql).toContain('is not null');
	});
});
