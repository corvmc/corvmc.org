import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = new Map<string, unknown>();
vi.mock('#lib/server/kv.js', () => ({
	getJson: async (key: string) => store.get(key) ?? null,
	putJson: async (key: string, value: unknown) => void store.set(key, value),
	deleteKey: async (key: string) => void store.delete(key)
}));

const summary = {
	provisioned: 0,
	cleaned: 0,
	confirmed: 0,
	online: true,
	fallbackActive: true,
	errors: []
};
const runDailyLockJob = vi.fn(async (_by: string | null) => summary);
vi.mock('./lock-service', () => ({ runDailyLockJob }));

const { requestLockJobRun, getLockJobRequest, runRequestedLockJob } =
	await import('./lock-job-request');

beforeEach(() => {
	store.clear();
	vi.clearAllMocks();
});

describe('runRequestedLockJob', () => {
	it('does nothing when nobody asked', async () => {
		expect(await runRequestedLockJob()).toBeNull();
		expect(runDailyLockJob).not.toHaveBeenCalled();
	});

	it('runs the job as the person who asked, then clears the request', async () => {
		await requestLockJobRun('Staff Person');

		expect(await runRequestedLockJob()).toEqual(summary);
		expect(runDailyLockJob).toHaveBeenCalledWith('Staff Person');
		expect(await getLockJobRequest()).toBeNull();
	});

	it('keeps a request made while the job ran, for the next tick', async () => {
		const later = { at: '2026-11-16T10:00:30.000Z', requestedBy: 'B' };
		store.set('ultraloc:jobRequested', { at: '2026-11-16T10:00:00.000Z', requestedBy: 'A' });
		runDailyLockJob.mockImplementationOnce(async () => {
			store.set('ultraloc:jobRequested', later);
			return summary;
		});

		await runRequestedLockJob();

		expect(await getLockJobRequest()).toEqual(later);
	});
});
