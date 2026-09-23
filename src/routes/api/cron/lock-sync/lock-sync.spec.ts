import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockReconcileUpcomingSync = vi.fn();

vi.mock('$lib/server/lock/lock-service', () => ({
	reconcileUpcomingSync: (...args: unknown[]) => mockReconcileUpcomingSync(...args)
}));

vi.mock('$env/dynamic/private', () => ({
	env: { CRON_SECRET: 'test-secret' }
}));

beforeEach(() => {
	vi.clearAllMocks();
});

function req(secret?: string) {
	return {
		request: new Request('http://localhost/api/cron/lock-sync', {
			method: 'POST',
			headers: { Authorization: `Bearer ${secret ?? 'test-secret'}` }
		})
	} as any;
}

// Module scope, after the mocks: a cold Vite transform inside a test races
// the 5s timeout.
const { POST } = await import('./+server');

describe('POST /api/cron/lock-sync', () => {
	it('rejects requests without valid auth', async () => {
		await expect(POST(req('wrong-secret'))).rejects.toThrow();
		expect(mockReconcileUpcomingSync).not.toHaveBeenCalled();
	});

	it('delegates to reconcileUpcomingSync', async () => {
		mockReconcileUpcomingSync.mockResolvedValue({ confirmed: 2, errors: [] });

		const response = await POST(req());

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ confirmed: 2, errors: [] });
	});

	// The check-in is derived from response.ok alone, so errors must redden it.
	it('fails its own run when a read failed', async () => {
		mockReconcileUpcomingSync.mockResolvedValue({ confirmed: 0, errors: ['rate limited'] });

		const response = await POST(req());

		expect(response.status).toBe(500);
	});
});
