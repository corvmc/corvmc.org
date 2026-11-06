import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGenerateRecurring = vi.fn();

vi.mock('#lib/server/reservation/generation-job.js', () => ({
	generateRecurring: (...args: unknown[]) => mockGenerateRecurring(...args)
}));

vi.mock('$app/env/private', async () =>
	(await import('#lib/testing/env-mock.js')).envMock({ CRON_SECRET: 'test-secret' })
);

beforeEach(() => {
	vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function req(secret?: string) {
	return {
		request: new Request('http://localhost/api/cron/generate-recurring-reservations', {
			method: 'POST',
			headers: { Authorization: `Bearer ${secret ?? 'test-secret'}` }
		})
	} as any;
}

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------

// The import stays dynamic so it resolves after the `vi.mock` calls above, and
// sits at module scope so the cold Vite transform of the whole module graph is
// paid once, during file evaluation — not inside a test or hook, where it would
// race the 5s test / 10s hook timeout on a cold `node_modules/.vite`.
const { POST } = await import('./+server');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/cron/generate-recurring-reservations', () => {
	it('rejects requests without valid auth', async () => {
		await expect(POST(req('wrong-secret'))).rejects.toThrow();
	});

	it('delegates to generateRecurring', async () => {
		mockGenerateRecurring.mockResolvedValue({ created: 5, skipped: 2 });

		await POST(req());

		expect(mockGenerateRecurring).toHaveBeenCalled();
	});

	it('returns result from generation job', async () => {
		const result = { events: {}, reservations: { created: 3, skipped: 1, errors: [] } };
		mockGenerateRecurring.mockResolvedValue(result);

		const response = await POST(req());
		const body = await response.json();

		expect(body).toEqual(result);
	});
});
