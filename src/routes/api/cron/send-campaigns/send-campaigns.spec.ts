import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockProcessDueCampaigns = vi.fn();

vi.mock('#lib/server/marketing/campaign-service.js', () => ({
	processDueCampaigns: (...args: unknown[]) => mockProcessDueCampaigns(...args)
}));

// isFeatureEnabled reads from site-config which depends on KV (uninitialized in tests).
// Mock the feature-flags layer so the handler runs past the feature gate.
const mockIsFeatureEnabled = vi.fn(async () => true);

vi.mock('#lib/server/feature-flags.js', () => ({
	isFeatureEnabled: (..._args: unknown[]) => mockIsFeatureEnabled()
}));

vi.mock('$env/dynamic/private', () => ({
	env: { CRON_SECRET: 'test-secret' }
}));

beforeEach(() => {
	vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function req(secret?: string) {
	return {
		request: new Request('http://localhost/api/cron/send-campaigns', {
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

describe('POST /api/cron/send-campaigns', () => {
	it('rejects requests without valid auth', async () => {
		await expect(POST(req('wrong-secret'))).rejects.toThrow();
	});

	it('delegates to processDueCampaigns', async () => {
		mockProcessDueCampaigns.mockResolvedValue(3);

		await POST(req());

		expect(mockProcessDueCampaigns).toHaveBeenCalled();
	});

	it('returns processed count in response', async () => {
		mockProcessDueCampaigns.mockResolvedValue(5);

		const response = await POST(req());
		const body = await response.json();

		expect(body).toEqual({ processed: 5 });
	});
});
