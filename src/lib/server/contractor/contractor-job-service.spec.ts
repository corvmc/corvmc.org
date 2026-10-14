import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Contractor jobs.
 *
 * What is worth pinning here is custody, because it is the half a reader cannot
 * check by eye: the job row and the asset's stock ledger are two records of one
 * event, and the rules about when they move together are all conditional.
 *
 * The sharpest of them is cancellation. Calling off the tech does not mend the
 * amp, so a cancelled job must leave the unit out of service — the opposite of
 * what "undo the scheduling" would do, and the version that keeps a broken amp
 * away from the next member who books.
 */

let selectResults: unknown[][] = [];
let updateValues: Record<string, unknown>[] = [];
let insertValues: unknown[] = [];
let batches: unknown[][] = [];

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
				return chain(() => [{ id: 'job-1', ...(v as object) }]);
			}
		})),
		update: vi.fn(() => ({
			set: (values: Record<string, unknown>) => {
				updateValues.push(values);
				return chain(() => [{ id: 'job-1', ...values }]);
			}
		})),
		batch: vi.fn(async (statements: unknown[]) => {
			batches.push(statements);
			return statements.map(() => []);
		})
	}
}));

const resolveWorkOrder = vi.fn(async () => ({}));
vi.mock('$lib/server/volunteer/work-order-service', () => ({
	resolveWorkOrder: (...args: unknown[]) => resolveWorkOrder(...(args as []))
}));

const setAssetStatus = vi.fn(async () => ({}));
vi.mock('$lib/server/inventory/asset-service', () => ({
	setAssetStatus: (...args: unknown[]) => setAssetStatus(...(args as []))
}));

const {
	createJob,
	scheduleJob,
	completeJob,
	cancelJob,
	ContractorJobStateError,
	ContractorJobNotFoundError
} = await import('./contractor-job-service');

beforeEach(() => {
	selectResults = [];
	updateValues = [];
	insertValues = [];
	batches = [];
	setAssetStatus.mockClear();
	resolveWorkOrder.mockClear();
});

const JOB = 'job-1';
const ASSET = 'asset-1';
const WO = 'wo-1';
const ACTOR = 'staff-1';

/**
 * An engagement as `getJobById` reads it: the job row, with its work order's
 * title, unit and state beside it. `assetId` and `title` belong to the work
 * order; everything else to the job.
 */
function engagement(over: Record<string, unknown> = {}) {
	const { assetId = null, title = 'Retube', workOrderResolvedAt = null, ...job } = over;
	return {
		job: { id: JOB, workOrderId: WO, ...job },
		title,
		assetId,
		projectId: null,
		workOrderResolvedAt,
		workOrderCancelledAt: null
	};
}

/** A job read, then the asset-status read that custody decisions depend on. */
function jobThenAsset(job: Record<string, unknown>, assetStatus?: string) {
	selectResults = [[engagement(job)]];
	if (assetStatus) selectResults.push([{ status: assetStatus }]);
}

describe('createJob', () => {
	it('refuses a contractor who has been archived', async () => {
		selectResults = [[{ id: 'c-1', archivedAt: new Date() }]];

		await expect(createJob({ contractorId: 'c-1', title: 'Retube the Bassman' })).rejects.toThrow(
			ContractorJobStateError
		);
	});

	it('creates the work order and the engagement in one batch', async () => {
		selectResults = [[{ id: 'c-1', archivedAt: null }], [engagement({ status: 'asked' })]];

		await createJob({ contractorId: 'c-1', title: 'Replace the panel', requestedByUserId: ACTOR });

		expect(batches).toHaveLength(1);
		expect(batches[0]).toHaveLength(2);
		expect(insertValues[0]).toMatchObject({
			title: 'Replace the panel',
			volunteerRoleId: null,
			postedAt: null,
			createdByUserId: ACTOR
		});
		const wo = insertValues[0] as { id: string };
		expect(insertValues[1]).toMatchObject({ contractorId: 'c-1', workOrderId: wo.id });
	});

	it('refuses a new work order with no title', async () => {
		selectResults = [[{ id: 'c-1', archivedAt: null }]];

		await expect(createJob({ contractorId: 'c-1', title: '  ' })).rejects.toThrow(
			ContractorJobStateError
		);
		expect(batches).toHaveLength(0);
	});

	it('engages a contractor on a work order that already exists', async () => {
		selectResults = [
			[{ id: 'c-1', archivedAt: null }],
			[{ id: WO, resolvedAt: null, cancelledAt: null }],
			[engagement({ status: 'asked' })]
		];

		await createJob({ contractorId: 'c-1', workOrderId: WO });

		expect(batches).toHaveLength(0);
		expect(insertValues).toHaveLength(1);
		expect(insertValues[0]).toMatchObject({ contractorId: 'c-1', workOrderId: WO });
	});

	it('refuses a work order that was called off', async () => {
		selectResults = [
			[{ id: 'c-1', archivedAt: null }],
			[{ id: WO, resolvedAt: null, cancelledAt: new Date() }]
		];

		await expect(createJob({ contractorId: 'c-1', workOrderId: WO })).rejects.toThrow(
			ContractorJobStateError
		);
		expect(insertValues).toHaveLength(0);
	});
});

describe('scheduleJob', () => {
	it('takes an in-service unit out of service', async () => {
		jobThenAsset({ id: JOB, status: 'asked', assetId: ASSET, title: 'Retube' }, 'in_service');

		await scheduleJob(JOB, { scheduledFor: new Date('2026-09-10T17:00:00Z') });

		expect(updateValues[0]).toMatchObject({ status: 'booked' });
		expect(setAssetStatus).toHaveBeenCalledWith(ASSET, 'maintenance', expect.anything());
	});

	it('does not write a second repair_out for a unit already in maintenance', async () => {
		jobThenAsset({ id: JOB, status: 'asked', assetId: ASSET, title: 'Retube' }, 'maintenance');

		await scheduleJob(JOB);

		expect(setAssetStatus).not.toHaveBeenCalled();
	});

	it('leaves a unit that is out on loan alone', async () => {
		jobThenAsset({ id: JOB, status: 'asked', assetId: ASSET, title: 'Retube' }, 'on_loan');

		await scheduleJob(JOB);

		expect(setAssetStatus).not.toHaveBeenCalled();
	});

	it('touches no asset for building work', async () => {
		selectResults = [[engagement({ status: 'asked', assetId: null, title: 'Replace panel' })]];

		await scheduleJob(JOB);

		expect(updateValues[0]).toMatchObject({ status: 'booked' });
		expect(setAssetStatus).not.toHaveBeenCalled();
	});

	it('refuses a job that is already finished', async () => {
		selectResults = [[engagement({ status: 'completed', assetId: null })]];

		await expect(scheduleJob(JOB)).rejects.toThrow(ContractorJobStateError);
	});
});

describe('completeJob', () => {
	it('brings the unit back and records the invoice', async () => {
		jobThenAsset({ id: JOB, status: 'booked', assetId: ASSET, title: 'Retube' }, 'maintenance');

		await completeJob(JOB, { costCents: 18000, invoiceRef: 'CAW-4471', actorId: ACTOR });

		expect(updateValues[0]).toMatchObject({
			status: 'completed',
			costCents: 18000,
			invoiceRef: 'CAW-4471'
		});
		expect(setAssetStatus).toHaveBeenCalledWith(ASSET, 'in_service', expect.anything());
	});

	it('does not resurrect a unit retired while it sat at the shop', async () => {
		jobThenAsset({ id: JOB, status: 'booked', assetId: ASSET, title: 'Retube' }, 'retired');

		await completeJob(JOB, { actorId: ACTOR });

		expect(setAssetStatus).not.toHaveBeenCalled();
	});

	it('leaves the unit out of service when the repair did not take', async () => {
		jobThenAsset({ id: JOB, status: 'booked', assetId: ASSET, title: 'Retube' }, 'maintenance');

		await completeJob(JOB, { returnToService: false, actorId: ACTOR });

		expect(setAssetStatus).not.toHaveBeenCalled();
	});

	it('resolves the work order it was engaged on', async () => {
		jobThenAsset({ status: 'booked' });

		await completeJob(JOB, { actorId: ACTOR });

		expect(resolveWorkOrder).toHaveBeenCalledWith(WO, { resolvedByUserId: ACTOR });
	});

	it('leaves a work order staff already ticked alone', async () => {
		jobThenAsset({ status: 'booked', workOrderResolvedAt: new Date() });

		await completeJob(JOB, { actorId: ACTOR });

		expect(updateValues[0]).toMatchObject({ status: 'completed' });
		expect(resolveWorkOrder).not.toHaveBeenCalled();
	});

	it('refuses a job that is already completed', async () => {
		selectResults = [[engagement({ status: 'completed', assetId: null })]];

		await expect(completeJob(JOB, { actorId: ACTOR })).rejects.toThrow(ContractorJobStateError);
	});

	// SQLite cannot add a CHECK through ALTER TABLE, so the "donated implies
	// nothing was paid" rule lives here. It is not tidiness: `getProjectBurn`
	// reads the flag to keep a donated job out of cash spend, so a row that
	// carried both would be counted twice — as money out and as value given.
	describe('donated work', () => {
		it('records the fair value and leaves cost null', async () => {
			jobThenAsset({ id: JOB, status: 'booked', assetId: null, title: 'Rewire' });

			await completeJob(JOB, {
				isDonated: true,
				fairValueCents: 42000,
				fairValueBasis: 'Their rate card, 4 hours',
				actorId: ACTOR
			});

			expect(updateValues[0]).toMatchObject({
				isDonated: true,
				fairValueCents: 42000,
				fairValueBasis: 'Their rate card, 4 hours',
				costCents: null
			});
		});

		it('refuses a job that is both donated and invoiced', async () => {
			jobThenAsset({ id: JOB, status: 'booked', assetId: null, title: 'Rewire' });

			await expect(
				completeJob(JOB, { isDonated: true, costCents: 42000, actorId: ACTOR })
			).rejects.toThrow(ContractorJobStateError);
		});

		it('clears a stale fair value when the flag comes off', async () => {
			// Otherwise a number nothing reads sits on the row and reappears the
			// moment somebody ticks the box again.
			jobThenAsset({
				id: JOB,
				status: 'booked',
				assetId: null,
				title: 'Rewire',
				isDonated: true,
				fairValueCents: 42000,
				fairValueBasis: 'Their rate card'
			});

			await completeJob(JOB, { isDonated: false, costCents: 51000, actorId: ACTOR });

			expect(updateValues[0]).toMatchObject({
				isDonated: false,
				fairValueCents: null,
				fairValueBasis: null,
				costCents: 51000
			});
		});
	});
});

describe('cancelJob', () => {
	/**
	 * The rule this file exists for. Cancelling the engagement is not a repair,
	 * so the amp stays out of service and out of the booking pool.
	 */
	it('leaves the unit out of service', async () => {
		selectResults = [[engagement({ status: 'booked', assetId: ASSET, title: 'Retube' })]];

		await cancelJob(JOB);

		expect(updateValues[0]).toMatchObject({ status: 'cancelled' });
		expect(setAssetStatus).not.toHaveBeenCalled();
	});

	it('refuses a job that is already cancelled', async () => {
		selectResults = [[engagement({ status: 'cancelled', assetId: null })]];

		await expect(cancelJob(JOB)).rejects.toThrow(ContractorJobStateError);
	});
});

describe('getJobById', () => {
	it('throws when there is no such job', async () => {
		selectResults = [[]];

		await expect(cancelJob('nope')).rejects.toThrow(ContractorJobNotFoundError);
	});
});
