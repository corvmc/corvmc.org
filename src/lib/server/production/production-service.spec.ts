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
			update: vi.fn(() => chainable('update')),
			delete: vi.fn(() => chainable('delete')),
			// In order, like D1's: each item is one of the recording proxies above.
			batch: vi.fn(async (items: PromiseLike<unknown>[]) => {
				const out = [];
				for (const item of items) out.push(await item);
				return out;
			})
		}
	};
});

// The recompute is the run of show's business, and it has its own spec. Here
// the only question is whether the hook fires, so it is a spy rather than a
// second copy of that module's database expectations.
const recomputeSetTimes = vi.fn();
vi.mock('./run-of-show-service', () => ({
	recomputeSetTimes: (id: string) => recomputeSetTimes(id)
}));

// The show's project is its own module's business, with its own spec.
const createShowProject = vi.fn();
const deleteShowProject = vi.fn();
vi.mock('./production-project', () => ({
	createShowProject: (input: unknown) => createShowProject(input),
	deleteShowProject: (id: string) => deleteShowProject(id),
	announceProductionCreated: async () => undefined
}));

// The cascade's predicates have their own spec against real SQLite; here the
// question is only which transition reaches it.
const cancelShiftsForProduction = vi.fn(async (..._args: unknown[]) => 0);
// The notice and the deliverables it calls off have their own spec against real SQLite.
vi.mock('./cancellation-notice', () => ({
	announceShowsCancelled: async () => undefined,
	openDeliverablesOnProductions: async () => []
}));
vi.mock('$lib/server/volunteer/show-cancellation', () => ({
	cancelShiftsForProduction: (...args: unknown[]) => cancelShiftsForProduction(...args)
}));
const captureException = vi.fn();
// Whether a show is still open, and the log of what moved, have their own specs.
vi.mock('./production-scope', () => ({
	assertNotTerminal: async () => undefined,
	ProductionTerminalError: class extends Error {}
}));
vi.mock('$lib/server/audit/audit-service', () => ({ recordAuditEntry: async () => undefined }));
vi.mock('$lib/server/sentry', () => ({
	captureException: (...args: unknown[]) => captureException(...args)
}));

import {
	createProduction,
	getProductionByEvent,
	updateProductionDetails,
	transitionProduction,
	cancelProductionsForEvent,
	ProductionNotFoundError,
	ProductionExistsError,
	ProductionMovedError,
	NotACmcListingError,
	ListingNotFoundError
} from './production-service';
import { db } from '$lib/server/db';

const dialect = new SQLiteSyncDialect();

/**
 * The parameters of the first `where(...)` a given operation built: the
 * production's own write, ahead of the project update that follows it.
 */
function whereParams(op: string) {
	const call = calls.find((c) => c.op === op && c.method === 'where');
	if (!call) throw new Error(`no ${op} where() recorded`);
	return dialect.sqlToQuery(call.args[0] as SQL).params;
}

function productionRow(overrides: Record<string, unknown> = {}) {
	return { id: 'prod-1', eventId: 'evt-1', status: 'draft', ...overrides };
}

/** What `createProduction` reads before it inserts: the listing's source, and nothing else. */
function listingSource(source: string) {
	return [[{ source }]];
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
	it('opens a draft production and has the listing announce it', async () => {
		selectQueue = listingSource('cmc');
		returningRows = [{ id: 'prod-1', status: 'draft' }];
		updateRowCount = 1;

		await createProduction('evt-1', { createdByUserId: 'staff-1', id: 'prod-1' });

		// Every production is a project: both, and the committees, in one batch.
		expect(createShowProject).toHaveBeenCalledWith(
			expect.objectContaining({ productionId: 'prod-1', createdByUserId: 'staff-1' })
		);
		const { projectId } = createShowProject.mock.calls[0][0] as { projectId: string };

		// The listing names the production it announces and the project it belongs to.
		const set = calls.find((c) => c.op === 'update' && c.method === 'set')?.args[0];
		expect(set).toMatchObject({ productionId: 'prod-1', projectId });
	});

	// The 1:1 is held by the conditional update — the listing takes a production
	// only while it is announcing none — not by a select-then-insert, which
	// would be a race. Zero rows changed means somebody else got there first.
	it('reports the second production on one event as a conflict', async () => {
		selectQueue = listingSource('cmc');
		returningRows = [{ id: 'prod-2', status: 'draft' }];
		updateRowCount = 0;

		await expect(createProduction('evt-1')).rejects.toThrow(ProductionExistsError);
	});

	it('removes the production it could not get announced', async () => {
		// Otherwise the loser of that race leaves a shell nothing can reach: no
		// listing names it, so no surface can find it to clean it up.
		selectQueue = listingSource('cmc');
		returningRows = [{ id: 'prod-2', status: 'draft' }];
		updateRowCount = 0;

		await expect(createProduction('evt-1', { id: 'prod-2' })).rejects.toThrow(
			ProductionExistsError
		);
		expect(deleteShowProject).toHaveBeenCalledWith('prod-2');
	});

	// A production is the ops record for a show CMC puts on. Roughly nine in ten
	// listings are somebody else's gig at somebody else's venue, and opening a
	// production on one is how `/staff/events/[id]` grew the dead "Space
	// Reservation: no space held" cards that #597 removed — reintroduced from the
	// service side, where the UI gate cannot see it.
	it.each(['band', 'community', 'group'])('refuses a %s listing', async (source) => {
		selectQueue = listingSource(source);

		await expect(createProduction('evt-1')).rejects.toThrow(NotACmcListingError);
		expect(createShowProject).not.toHaveBeenCalled();
	});

	it('reports a listing that does not exist as not found', async () => {
		selectQueue = [[]];

		await expect(createProduction('evt-1')).rejects.toThrow(ListingNotFoundError);
		expect(createShowProject).not.toHaveBeenCalled();
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

	// A moved downbeat moves every set after it, and the schedule is derived with
	// no escape hatch — so the recompute is not optional and not a button.
	it('recomputes the set times when the downbeat is in the payload', async () => {
		await updateProductionDetails('prod-1', { firstSetAt: new Date('2026-10-01T03:30:00Z') });

		expect(recomputeSetTimes).toHaveBeenCalledWith('prod-1');
	});

	it('leaves the set times alone for an edit that cannot move them', async () => {
		await updateProductionDetails('prod-1', { internalNotes: 'Door code is on the whiteboard' });

		expect(recomputeSetTimes).not.toHaveBeenCalled();
	});
});

// The status rules themselves — warnings, overrides, terminal states, reopening
// — run against real SQLite in `production-status.spec.ts`. What stays here is
// which side effects a move reaches.
describe('transitionProduction', () => {
	/** What the move reads first: the status it will swap from, and the listing. */
	const before = (status: string) => [{ status, eventId: 'evt-1', title: 'Friday' }];

	it('calls off the show’s crew shifts when it is cancelled, naming who did (#1705)', async () => {
		selectQueue = [before('confirmed'), [productionRow({ status: 'cancelled' })]];
		await transitionProduction('prod-1', 'cancelled', { actorUserId: 'u-staff' });

		expect(cancelShiftsForProduction).toHaveBeenCalledWith('prod-1', 'u-staff');
	});

	it('leaves the shifts alone on every other transition', async () => {
		selectQueue = [before('offered'), [productionRow({ status: 'confirmed' })]];
		await transitionProduction('prod-1', 'confirmed', { actorUserId: 'u-staff' });

		expect(cancelShiftsForProduction).not.toHaveBeenCalled();
	});

	it('still cancels the production when the shift cascade fails, and reports it', async () => {
		cancelShiftsForProduction.mockRejectedValueOnce(new Error('D1 down'));
		selectQueue = [before('draft'), [productionRow({ status: 'cancelled' })]];

		await expect(transitionProduction('prod-1', 'cancelled')).resolves.toMatchObject({
			moved: true,
			production: { status: 'cancelled' }
		});
		expect(captureException).toHaveBeenCalled();
	});

	it('swaps only from the status it read, and says so when somebody else moved it', async () => {
		selectQueue = [before('offered')];
		updateRowCount = 0;

		await expect(transitionProduction('prod-1', 'confirmed')).rejects.toThrow(ProductionMovedError);
		expect(whereParams('update')).toEqual(expect.arrayContaining(['prod-1', 'offered']));
	});

	it('distinguishes a missing production', async () => {
		selectQueue = [[]];

		await expect(transitionProduction('prod-999', 'confirmed')).rejects.toThrow(
			ProductionNotFoundError
		);
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

	it('is one batch of conditional updates, not a read and a branch', async () => {
		await cancelProductionsForEvent('evt-1');

		// The production, then its project following it to `declined`.
		expect(db.batch).toHaveBeenCalledTimes(1);
		expect(db.update).toHaveBeenCalledTimes(2);
		const sets = calls.filter((c) => c.op === 'update' && c.method === 'set').map((c) => c.args[0]);
		expect(sets[1]).toMatchObject({ status: 'declined' });
	});
});
