import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Projects.
 *
 * Three things are worth pinning here, and they are the three a reader cannot
 * check by eye:
 *
 * - **Burn is derived and two-columned.** Cash and contributed value are summed
 *   from different tables and must never be added together — a total that mixes
 *   an electrician's invoice with donated hours is wrong for the budget and
 *   wrong for the grant report.
 * - **A status change carries its suggestion.** That is the loop `suggestionId`
 *   exists to close, and it is one `db.batch` rather than two writes that can
 *   disagree.
 * - **Only a committee owns a project.** No CHECK can express it, so nothing but
 *   this test stands between the rule and a band appearing in a committee view.
 */

let selectResults: unknown[][] = [];
let updateValues: Record<string, unknown>[] = [];
let insertValues: unknown[] = [];
let batchCalls: unknown[][] = [];

function chain(queue: () => unknown[]): unknown {
	const proxy: unknown = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') {
				return (resolve: (v: unknown[]) => void) => resolve(queue());
			}
			return () => proxy;
		}
	});
	return proxy;
}

const next = () => (selectResults.length > 0 ? selectResults.shift()! : []);

vi.mock('$lib/server/db', () => ({
	db: {
		select: vi.fn(() => chain(next)),
		insert: vi.fn(() => ({
			values: (v: unknown) => {
				insertValues.push(v);
				return chain(() => [{ id: 'proj-1', ...(v as object) }]);
			}
		})),
		update: vi.fn(() => ({
			set: (values: Record<string, unknown>) => {
				updateValues.push(values);
				return chain(() => [{ id: 'row-1', ...values }]);
			}
		})),
		batch: vi.fn(async (writes: unknown[]) => {
			batchCalls.push(writes);
			return writes.map(() => []);
		})
	}
}));

const {
	createProject,
	updateProject,
	setProjectStatus,
	getProjectById,
	attachToProject,
	detachFromProject,
	getProjectBurn,
	ProjectNotFoundError,
	ProjectOwnerError,
	ProjectStateError
} = await import('./project-service');

beforeEach(() => {
	selectResults = [];
	updateValues = [];
	insertValues = [];
	batchCalls = [];
});

const COMMITTEE = [{ kind: 'committee', deletedAt: null }];
const PROJECT = (over: Record<string, unknown> = {}) => [
	{ id: 'proj-1', budgetCents: null, suggestionId: null, status: 'open', ...over }
];

describe('createProject', () => {
	it('refuses a group that is not a committee', async () => {
		selectResults = [[{ kind: 'band', deletedAt: null }]];

		await expect(createProject({ name: 'Repaint the live room', groupId: 'g-1' })).rejects.toThrow(
			ProjectOwnerError
		);
		expect(insertValues).toHaveLength(0);
	});

	it('refuses a committee that has been deleted', async () => {
		selectResults = [[{ kind: 'committee', deletedAt: new Date() }]];

		await expect(createProject({ name: 'Rewire', groupId: 'g-1' })).rejects.toThrow(
			ProjectOwnerError
		);
	});

	it('accepts a committee owner', async () => {
		selectResults = [COMMITTEE];

		const row = await createProject({ name: 'Rewire the panel', groupId: 'g-1' });

		expect(row).toMatchObject({ name: 'Rewire the panel', groupId: 'g-1' });
	});

	it('refuses a suggestion another project already answers', async () => {
		// The suggestion exists, and a different project has claimed it.
		selectResults = [[{ id: 's-1' }], [{ id: 'proj-other' }]];

		await expect(createProject({ name: 'Cable rack', suggestionId: 's-1' })).rejects.toThrow(
			ProjectStateError
		);
	});

	it('lets a project keep the suggestion it already answers', async () => {
		selectResults = [PROJECT({ suggestionId: 's-1' }), [{ id: 's-1' }], [{ id: 'proj-1' }]];

		await expect(updateProject('proj-1', { suggestionId: 's-1' })).resolves.toBeDefined();
	});
});

describe('getProjectById', () => {
	it('throws rather than returning undefined', async () => {
		selectResults = [[]];
		await expect(getProjectById('nope')).rejects.toThrow(ProjectNotFoundError);
	});
});

describe('setProjectStatus', () => {
	it('moves the answered suggestion in the same batch', async () => {
		selectResults = [PROJECT({ suggestionId: 's-1' }), PROJECT({ status: 'done' })];

		await setProjectStatus('proj-1', 'done');

		// One batch, two writes: the project and the suggestion it answers. Two
		// separate awaits would let the pair disagree, and D1 has no transaction.
		expect(batchCalls).toHaveLength(1);
		expect(batchCalls[0]).toHaveLength(2);
		expect(updateValues.map((v) => v.status)).toEqual(['done', 'done']);
	});

	it('writes only the project when no suggestion is linked', async () => {
		selectResults = [PROJECT(), PROJECT({ status: 'in_progress' })];

		await setProjectStatus('proj-1', 'in_progress');

		expect(batchCalls).toHaveLength(0);
		expect(updateValues).toHaveLength(1);
	});
});

describe('attachment', () => {
	it('sets project_id on the named table', async () => {
		selectResults = [PROJECT()];

		await attachToProject('contractor_job', 'job-1', 'proj-1');

		expect(updateValues.at(-1)).toMatchObject({ projectId: 'proj-1' });
	});

	it('nulls it on detach', async () => {
		await detachFromProject('work_order', 'wo-1');

		expect(updateValues.at(-1)).toMatchObject({ projectId: null });
	});

	it('refuses to attach to a project that does not exist', async () => {
		selectResults = [[]];

		await expect(attachToProject('event', 'e-1', 'gone')).rejects.toThrow(ProjectNotFoundError);
	});
});

describe('getProjectBurn', () => {
	/** The project, then contractor, orders, acquisitions and labour in call order. */
	function ledgers(over: Record<string, unknown> = {}) {
		selectResults = [
			PROJECT({ budgetCents: over.budgetCents ?? null }),
			[{ cents: over.contractor ?? 0 }],
			[{ cents: over.orders ?? 0 }],
			[{ paidCents: over.paid ?? 0, donatedCents: over.donated ?? 0 }],
			[{ minutes: over.minutes ?? 0 }]
		];
	}

	it('adds the three cash ledgers and nothing else', async () => {
		ledgers({ contractor: 94_500, orders: 21_400, paid: 18_000, donated: 250_000, minutes: 600 });

		const burn = await getProjectBurn('proj-1');

		expect(burn.cash.totalCents).toBe(94_500 + 21_400 + 18_000);
		// Donated goods and volunteer time are contributions, not spend. If either
		// ever lands in `cash.totalCents`, every budget in the app overstates.
		expect(burn.contributed.donatedGoodsCents).toBe(250_000);
		expect(burn.contributed.volunteerMinutes).toBe(600);
	});

	it('reports volunteer time in minutes, never as money', async () => {
		ledgers({ minutes: 480 });

		const burn = await getProjectBurn('proj-1');

		expect(burn.contributed.volunteerMinutes).toBe(480);
		expect(burn.cash.totalCents).toBe(0);
	});

	it('leaves remaining null when no budget is set, rather than zero', async () => {
		ledgers({ contractor: 5000 });

		expect((await getProjectBurn('proj-1')).remainingCents).toBeNull();
	});

	it('subtracts cash spend from the budget, and goes negative when overspent', async () => {
		ledgers({ budgetCents: 100_000, contractor: 94_500, orders: 21_400 });

		expect((await getProjectBurn('proj-1')).remainingCents).toBe(100_000 - 115_900);
	});

	it('treats an empty ledger as zero rather than NaN', async () => {
		selectResults = [PROJECT({ budgetCents: 50_000 }), [], [], [], []];

		const burn = await getProjectBurn('proj-1');

		expect(burn.cash.totalCents).toBe(0);
		expect(burn.remainingCents).toBe(50_000);
	});
});
