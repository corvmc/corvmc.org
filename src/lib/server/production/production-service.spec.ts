import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import type { SQL } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
// A chainable proxy that records what each query built, so the assertions can
// be about the predicate rather than about whatever a stub was told to return —
// the status machine's whole correctness is in its `IN (…)` lists. drizzle and
// the schema stay real so those predicates render to actual SQL;
// `better-sqlite3` is not built in CI, so only `$lib/server/db` is mocked.
// ---------------------------------------------------------------------------

let selectQueue: unknown[][] = [];
let returningRows: unknown[] = [];
let updateRowCount = 1;
let calls: { op: string; method: string; args: unknown[] }[] = [];
let insertShouldViolateUnique = false;

function chainable(op: string) {
	let returned = false;
	const proxy: any = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') {
				if (op === 'insert' && insertShouldViolateUnique) {
					return (_res: unknown, reject: (e: unknown) => void) =>
						reject(new Error('D1_ERROR: UNIQUE constraint failed: production.event_id'));
				}
				if (op === 'select') {
					const rows = selectQueue.shift() ?? [];
					return (resolve: (v: unknown[]) => void) => resolve(rows);
				}
				// An update awaited directly is a row-count check; one that asked
				// for `.returning()` wants the row back.
				if (op === 'update' && !returned) {
					return (resolve: (v: unknown) => void) => resolve({ meta: { changes: updateRowCount } });
				}
				return (resolve: (v: unknown[]) => void) => resolve(returningRows);
			}
			return (...args: unknown[]) => {
				if (prop === 'returning') returned = true;
				calls.push({ op, method: String(prop), args });
				return proxy;
			};
		}
	});
	return proxy;
}

vi.mock('$lib/server/db', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/db')>();
	return {
		...actual,
		db: {
			select: vi.fn(() => chainable('select')),
			insert: vi.fn(() => chainable('insert')),
			update: vi.fn(() => chainable('update'))
		}
	};
});

import {
	createProduction,
	getProductionByEvent,
	updateProductionDetails,
	transitionProduction,
	cancelProductionsForEvent,
	ProductionNotFoundError,
	ProductionExistsError,
	InvalidProductionTransitionError
} from './production-service';
import { db } from '$lib/server/db';

const dialect = new SQLiteSyncDialect();

/** The parameters of the last `where(...)` a given operation built. */
function whereParams(op: string) {
	const call = [...calls].reverse().find((c) => c.op === op && c.method === 'where');
	if (!call) throw new Error(`no ${op} where() recorded`);
	return dialect.sqlToQuery(call.args[0] as SQL).params;
}

function productionRow(overrides: Record<string, unknown> = {}) {
	return { id: 'prod-1', eventId: 'evt-1', status: 'draft', ...overrides };
}

beforeEach(() => {
	vi.clearAllMocks();
	selectQueue = [];
	returningRows = [productionRow()];
	updateRowCount = 1;
	calls = [];
	insertShouldViolateUnique = false;
});

describe('createProduction', () => {
	it('opens a draft production on the event', async () => {
		await createProduction('evt-1', { createdByUserId: 'staff-1' });

		const values = calls.find((c) => c.method === 'values')?.args[0] as Record<string, unknown>;
		expect(values).toMatchObject({ eventId: 'evt-1', createdByUserId: 'staff-1' });
		// Status is the column default, not something the service restates.
		expect(values).not.toHaveProperty('status');
	});

	// The 1:1 is held by uq_production_event, not by a select-then-insert — that
	// would be a race. This is the index's violation reaching the caller as a
	// 409 rather than a 500.
	it('reports the second production on one event as a conflict', async () => {
		insertShouldViolateUnique = true;

		await expect(createProduction('evt-1')).rejects.toThrow(ProductionExistsError);
	});
});

describe('getProductionByEvent', () => {
	it('returns null rather than throwing when an event has none', async () => {
		selectQueue = [[]];

		expect(await getProductionByEvent('evt-1')).toBeNull();
	});
});

describe('updateProductionDetails', () => {
	// Status has exactly one door, and this is not it.
	it('cannot move the status', async () => {
		await updateProductionDetails('prod-1', {
			loadInAt: new Date('2026-10-01T22:00:00Z'),
			internalNotes: 'Door code is on the whiteboard'
		});

		const payload = calls.find((c) => c.method === 'set')?.args[0] as Record<string, unknown>;
		expect(payload).toMatchObject({ internalNotes: 'Door code is on the whiteboard' });
		expect(payload).not.toHaveProperty('status');
	});

	it('throws when the production is gone', async () => {
		returningRows = [];

		await expect(updateProductionDetails('prod-999', {})).rejects.toThrow(ProductionNotFoundError);
	});
});

describe('transitionProduction', () => {
	// Every legal edge, asserted against the source list the UPDATE actually
	// carries — the machine and the SQL cannot drift because they are one table.
	const legal: [string, string[]][] = [
		['draft', ['offered']],
		['offered', ['draft']],
		['confirmed', ['draft', 'offered']],
		['completed', ['confirmed']],
		['settled', ['completed']],
		['closed', ['settled']],
		['cancelled', ['draft', 'offered', 'confirmed']]
	];

	for (const [to, from] of legal) {
		it(`reaches ${to} only from ${from.join(', ')}`, async () => {
			selectQueue = [[productionRow({ status: to })]];

			await transitionProduction('prod-1', to as never);

			const params = whereParams('update');
			expect(params).toContain('prod-1');
			for (const source of from) expect(params).toContain(source);
			// Nothing else may sneak into the list.
			expect(params.filter((p) => typeof p === 'string' && p !== 'prod-1')).toHaveLength(
				from.length
			);
		});
	}

	it('names the actual status when the transition is illegal', async () => {
		updateRowCount = 0;
		selectQueue = [[{ status: 'completed' }]];

		await expect(transitionProduction('prod-1', 'confirmed')).rejects.toThrow(
			/from "completed" to "confirmed"/
		);
	});

	it('distinguishes a missing production from a wrong status', async () => {
		updateRowCount = 0;
		selectQueue = [[]];

		await expect(transitionProduction('prod-999', 'confirmed')).rejects.toThrow(
			ProductionNotFoundError
		);
	});

	// `cancelled` and `closed` are terminal: they appear in no target's source
	// list, so nothing reaches anything from them. `completed` and `settled` are
	// not terminal — they still go forward — but neither walks back to a
	// pre-show state, which is the other half of the same guarantee.
	it('has no way out of cancelled or closed, and no way back from completed', async () => {
		const everySource = legal.flatMap(([, from]) => from);
		expect(everySource).not.toContain('cancelled');
		expect(everySource).not.toContain('closed');

		const preShow = ['draft', 'offered', 'confirmed'];
		for (const [to, from] of legal) {
			if (!preShow.includes(to)) continue;
			expect(from).not.toContain('completed');
			expect(from).not.toContain('settled');
		}
	});
});

describe('cancelProductionsForEvent', () => {
	// A production that already completed describes a night that happened;
	// cancelling the listing afterwards does not un-happen it.
	it('pulls back only the pre-completed statuses', async () => {
		updateRowCount = 1;

		await cancelProductionsForEvent('evt-1');

		const params = whereParams('update');
		expect(params).toEqual(expect.arrayContaining(['evt-1', 'draft', 'offered', 'confirmed']));
		expect(params).not.toContain('completed');
		expect(params).not.toContain('settled');
		expect(params).not.toContain('closed');
	});

	it('is a single conditional update, not a read and a branch', async () => {
		await cancelProductionsForEvent('evt-1');

		expect(db.select).not.toHaveBeenCalled();
		expect(db.update).toHaveBeenCalledTimes(1);
	});
});
