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
		}))
	}
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
	setAssetStatus.mockClear();
});

const JOB = 'job-1';
const ASSET = 'asset-1';

/** A job read, then the asset-status read that custody decisions depend on. */
function jobThenAsset(job: Record<string, unknown>, assetStatus?: string) {
	selectResults = [[job]];
	if (assetStatus) selectResults.push([{ status: assetStatus }]);
}

describe('createJob', () => {
	it('refuses a contractor who has been archived', async () => {
		selectResults = [[{ id: 'c-1', archivedAt: new Date() }]];

		await expect(createJob({ contractorId: 'c-1', summary: 'Retube the Bassman' })).rejects.toThrow(
			ContractorJobStateError
		);
	});

	it('opens as a draft against a live contractor', async () => {
		selectResults = [[{ id: 'c-1', archivedAt: null }]];

		await createJob({ contractorId: 'c-1', summary: 'Replace the panel' });

		expect(insertValues[0]).toMatchObject({ contractorId: 'c-1', summary: 'Replace the panel' });
	});
});

describe('scheduleJob', () => {
	it('takes an in-service unit out of service', async () => {
		jobThenAsset({ id: JOB, status: 'draft', assetId: ASSET, summary: 'Retube' }, 'in_service');

		await scheduleJob(JOB, { scheduledFor: new Date('2026-09-10T17:00:00Z') });

		expect(updateValues[0]).toMatchObject({ status: 'scheduled' });
		expect(setAssetStatus).toHaveBeenCalledWith(ASSET, 'maintenance', expect.anything());
	});

	it('does not write a second repair_out for a unit already in maintenance', async () => {
		jobThenAsset({ id: JOB, status: 'draft', assetId: ASSET, summary: 'Retube' }, 'maintenance');

		await scheduleJob(JOB);

		expect(setAssetStatus).not.toHaveBeenCalled();
	});

	it('leaves a unit that is out on loan alone', async () => {
		jobThenAsset({ id: JOB, status: 'draft', assetId: ASSET, summary: 'Retube' }, 'on_loan');

		await scheduleJob(JOB);

		expect(setAssetStatus).not.toHaveBeenCalled();
	});

	it('touches no asset for building work', async () => {
		selectResults = [[{ id: JOB, status: 'draft', assetId: null, summary: 'Replace panel' }]];

		await scheduleJob(JOB);

		expect(updateValues[0]).toMatchObject({ status: 'scheduled' });
		expect(setAssetStatus).not.toHaveBeenCalled();
	});

	it('refuses a job that is already finished', async () => {
		selectResults = [[{ id: JOB, status: 'completed', assetId: null }]];

		await expect(scheduleJob(JOB)).rejects.toThrow(ContractorJobStateError);
	});
});

describe('completeJob', () => {
	it('brings the unit back and records the invoice', async () => {
		jobThenAsset(
			{ id: JOB, status: 'scheduled', assetId: ASSET, summary: 'Retube' },
			'maintenance'
		);

		await completeJob(JOB, { costCents: 18000, invoiceRef: 'CAW-4471' });

		expect(updateValues[0]).toMatchObject({
			status: 'completed',
			costCents: 18000,
			invoiceRef: 'CAW-4471'
		});
		expect(setAssetStatus).toHaveBeenCalledWith(ASSET, 'in_service', expect.anything());
	});

	it('does not resurrect a unit retired while it sat at the shop', async () => {
		jobThenAsset({ id: JOB, status: 'scheduled', assetId: ASSET, summary: 'Retube' }, 'retired');

		await completeJob(JOB);

		expect(setAssetStatus).not.toHaveBeenCalled();
	});

	it('leaves the unit out of service when the repair did not take', async () => {
		jobThenAsset(
			{ id: JOB, status: 'scheduled', assetId: ASSET, summary: 'Retube' },
			'maintenance'
		);

		await completeJob(JOB, { returnToService: false });

		expect(setAssetStatus).not.toHaveBeenCalled();
	});

	it('refuses a job that is already completed', async () => {
		selectResults = [[{ id: JOB, status: 'completed', assetId: null }]];

		await expect(completeJob(JOB)).rejects.toThrow(ContractorJobStateError);
	});
});

describe('cancelJob', () => {
	/**
	 * The rule this file exists for. Cancelling the engagement is not a repair,
	 * so the amp stays out of service and out of the booking pool.
	 */
	it('leaves the unit out of service', async () => {
		selectResults = [[{ id: JOB, status: 'scheduled', assetId: ASSET, summary: 'Retube' }]];

		await cancelJob(JOB);

		expect(updateValues[0]).toMatchObject({ status: 'cancelled' });
		expect(setAssetStatus).not.toHaveBeenCalled();
	});

	it('refuses a job that is already cancelled', async () => {
		selectResults = [[{ id: JOB, status: 'cancelled', assetId: null }]];

		await expect(cancelJob(JOB)).rejects.toThrow(ContractorJobStateError);
	});
});

describe('getJobById', () => {
	it('throws when there is no such job', async () => {
		selectResults = [[]];

		await expect(cancelJob('nope')).rejects.toThrow(ContractorJobNotFoundError);
	});
});
