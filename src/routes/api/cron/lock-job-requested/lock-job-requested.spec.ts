import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRunRequestedLockJob = vi.fn();
vi.mock('#lib/server/lock/lock-job-request.js', () => ({
	runRequestedLockJob: (...args: unknown[]) => mockRunRequestedLockJob(...args)
}));

vi.mock('$app/env/private', async () =>
	(await import('#lib/testing/env-mock.js')).envMock({ CRON_SECRET: 'test-secret' })
);

beforeEach(() => {
	vi.clearAllMocks();
});

function req(secret?: string) {
	return {
		request: new Request('http://localhost/api/cron/lock-job-requested', {
			method: 'POST',
			headers: { Authorization: `Bearer ${secret ?? 'test-secret'}` }
		})
	} as any;
}

const { POST } = await import('./+server');

const summary = {
	provisioned: 1,
	cleaned: 0,
	confirmed: 2,
	online: true,
	fallbackActive: true,
	errors: [] as string[]
};

describe('POST /api/cron/lock-job-requested', () => {
	it('rejects requests without valid auth', async () => {
		await expect(POST(req('wrong-secret'))).rejects.toThrow();
		expect(mockRunRequestedLockJob).not.toHaveBeenCalled();
	});

	it('reports ok when nobody asked for a run', async () => {
		mockRunRequestedLockJob.mockResolvedValue(null);
		const response = await POST(req());
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ran: false });
	});

	it('returns the run it made', async () => {
		mockRunRequestedLockJob.mockResolvedValue(summary);
		const response = await POST(req());
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ ran: true, provisioned: 1, confirmed: 2 });
	});

	it('fails the check-in when the run recorded errors', async () => {
		mockRunRequestedLockJob.mockResolvedValue({ ...summary, errors: ['Provisioning failed'] });
		const response = await POST(req());
		expect(response.status).toBe(500);
	});
});
