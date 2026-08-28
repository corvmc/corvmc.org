import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSweep = vi.fn();
vi.mock('$lib/server/media/media-sweep-service', () => ({
	sweepMedia: (...args: unknown[]) => mockSweep(...args)
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
	});

	it('refuses a wrong bearer token', async () => {
		await expect(POST({ request: post('Bearer nope') } as never)).rejects.toMatchObject({
			status: 401
		});
		expect(mockSweep).not.toHaveBeenCalled();
	});

	it('runs the sweep and returns its counts', async () => {
		mockSweep.mockResolvedValue({
			orphanedAttachments: 3,
			reapedMedia: 2,
			failedDeletes: 1
		});

		const response = await POST({ request: post('Bearer test-secret') } as never);

		expect(mockSweep).toHaveBeenCalledOnce();
		await expect(response.json()).resolves.toEqual({
			orphanedAttachments: 3,
			reapedMedia: 2,
			failedDeletes: 1
		});
	});
});
