import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Money out. The sign is what makes a sum a position rather than a turnover
 * figure, so every one of these is negative.
 */

const recordEntry = vi.fn(async () => undefined);
vi.mock('./financial-entry-service', () => ({
	recordEntry: (...a: unknown[]) => recordEntry(...(a as [])),
	recordEntries: vi.fn()
}));

const { recordCompletedJob } = await import('./contractor-entries');
const { syncAcquisitionSpend } = await import('./in-kind-acquisition');

const OCCURRED = new Date('2026-09-13');
beforeEach(() => vi.clearAllMocks());

describe('contractor jobs', () => {
	it('records a paid job as money out', async () => {
		await recordCompletedJob({
			jobId: 'job-1',
			summary: 'Amp repair',
			occurredAt: OCCURRED,
			costCents: 12_000,
			isDonated: false
		});

		expect(recordEntry).toHaveBeenCalledWith(
			expect.objectContaining({
				amountCents: -12_000,
				kind: 'spent',
				category: 'contractor',
				subjectType: 'contractor_job'
			})
		);
	});

	/**
	 * The two are mutually exclusive by an invariant the job service enforces —
	 * a row that was both would be counted as money spent *and* as value
	 * contributed, which is what `getProjectBurn` must never see.
	 */
	it('records a donated job as value in, not money out', async () => {
		await recordCompletedJob({
			jobId: 'job-1',
			summary: 'Amp repair',
			occurredAt: OCCURRED,
			isDonated: true,
			fairValueCents: 12_000
		});

		expect(recordEntry).toHaveBeenCalledOnce();
		expect(recordEntry).toHaveBeenCalledWith(
			expect.objectContaining({ amountCents: 12_000, kind: 'in_kind' })
		);
	});

	it('records nothing for a job that cost nothing and was not donated', async () => {
		await recordCompletedJob({
			jobId: 'job-1',
			summary: 'Looked at it',
			occurredAt: OCCURRED,
			costCents: 0,
			isDonated: false
		});

		expect(recordEntry).not.toHaveBeenCalled();
	});

	it('carries the project, so burn is one query', async () => {
		await recordCompletedJob({
			jobId: 'job-1',
			summary: 'Amp repair',
			projectId: 'prj-1',
			occurredAt: OCCURRED,
			costCents: 500,
			isDonated: false
		});

		expect(recordEntry).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'prj-1' }));
	});
});

describe('purchased acquisitions', () => {
	const base = { acquisitionId: 'acq-1', description: 'Purchase', occurredAt: OCCURRED };

	it('records the receipt total as money out', async () => {
		await syncAcquisitionSpend({
			...base,
			before: null,
			after: { kind: 'purchase', totalCents: 8240 }
		});

		expect(recordEntry).toHaveBeenCalledWith(
			expect.objectContaining({ amountCents: -8240, kind: 'spent', category: 'equipment' })
		);
	});

	it('writes nothing for a receipt nobody has totalled yet', async () => {
		await syncAcquisitionSpend({
			...base,
			before: null,
			after: { kind: 'purchase', totalCents: null }
		});

		expect(recordEntry).not.toHaveBeenCalled();
	});

	// Same append-only rule the gift side follows: correct by difference.
	it('adds the difference when a total is corrected', async () => {
		await syncAcquisitionSpend({
			...base,
			before: { kind: 'purchase', totalCents: 8240 },
			after: { kind: 'purchase', totalCents: 9000 }
		});

		expect(recordEntry).toHaveBeenCalledWith(expect.objectContaining({ amountCents: -760 }));
	});

	it('never records spend for a donation', async () => {
		await syncAcquisitionSpend({
			...base,
			before: null,
			after: { kind: 'donation', totalCents: 8240 }
		});

		expect(recordEntry).not.toHaveBeenCalled();
	});
});
