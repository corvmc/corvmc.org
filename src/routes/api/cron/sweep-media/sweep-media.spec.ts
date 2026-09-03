import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSweep = vi.fn();
vi.mock('$lib/server/media/media-sweep-service', () => ({
	sweepMedia: (...args: unknown[]) => mockSweep(...args)
}));

const mockSweepFiles = vi.fn();
vi.mock('$lib/server/group/file-sweep', () => ({
	sweepGroupFiles: (...args: unknown[]) => mockSweepFiles(...args)
}));

vi.mock('$env/dynamic/private', () => ({
	env: { CRON_SECRET: 'test-secret' }
}));

function post(auth?: string) {
	return new Request('http://localhost/api/cron/sweep-media', {
		method: 'POST',
		headers: auth ? { Authorization: auth } : {}
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	mockSweep.mockResolvedValue({ orphanedAttachments: 0, reapedMedia: 0, failedDeletes: 0 });
	mockSweepFiles.mockResolvedValue({ reapedFiles: 0, failedFileDeletes: 0 });
});

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------

const { POST } = await import('./+server');

describe('POST /api/cron/sweep-media', () => {
	it('refuses a request with no bearer token', async () => {
		// This endpoint deletes files. An open one is a way to delete every
		// unattached object in the bucket on demand.
		await expect(POST({ request: post() } as never)).rejects.toMatchObject({ status: 401 });
		expect(mockSweep).not.toHaveBeenCalled();
		expect(mockSweepFiles).not.toHaveBeenCalled();
	});

	it('refuses a wrong bearer token', async () => {
		await expect(POST({ request: post('Bearer nope') } as never)).rejects.toMatchObject({
			status: 401
		});
		expect(mockSweep).not.toHaveBeenCalled();
		expect(mockSweepFiles).not.toHaveBeenCalled();
	});

	it('runs both reapers and merges their counts', async () => {
		mockSweep.mockResolvedValue({
			orphanedAttachments: 3,
			reapedMedia: 2,
			failedDeletes: 1
		});
		mockSweepFiles.mockResolvedValue({ reapedFiles: 4, failedFileDeletes: 0 });

		const response = await POST({ request: post('Bearer test-secret') } as never);

		expect(mockSweep).toHaveBeenCalledOnce();
		expect(mockSweepFiles).toHaveBeenCalledOnce();
		await expect(response.json()).resolves.toEqual({
			orphanedAttachments: 3,
			reapedMedia: 2,
			failedDeletes: 1,
			reapedFiles: 4,
			failedFileDeletes: 0
		});
	});

	/**
	 * The two reapers touch different buckets and different tables, so one
	 * failing must not be reported as the other having run. `Promise.all` rejects
	 * the whole request, the cron sees a non-200, and the next day's run redoes
	 * both — which is safe, because both are idempotent over what they already
	 * reaped.
	 */
	it('fails the request when either reaper throws', async () => {
		mockSweepFiles.mockRejectedValue(new Error('R2 down'));

		await expect(POST({ request: post('Bearer test-secret') } as never)).rejects.toThrow('R2 down');
	});
});
