import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSuppressByEmail = vi.fn(async () => true);

vi.mock('$lib/server/marketing/subscriber-service', () => ({
	suppressByEmail: (...args: unknown[]) => mockSuppressByEmail(...(args as [])),
	__esModule: true
}));

vi.mock('$env/dynamic/private', () => ({
	env: { POSTMARK_WEBHOOK_TOKEN: 'hook-secret' }
}));

beforeEach(() => {
	vi.clearAllMocks();
	mockSuppressByEmail.mockResolvedValue(true);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function req(body: unknown, token: string | null = 'hook-secret') {
	const headers: Record<string, string> = { 'content-type': 'application/json' };
	if (token !== null) headers['x-postmark-token'] = token;
	return {
		request: new Request('http://localhost/api/webhooks/postmark/events', {
			method: 'POST',
			headers,
			body: JSON.stringify(body)
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

describe('POST /api/webhooks/postmark/events', () => {
	it('rejects requests with a missing/wrong token', async () => {
		await expect(
			POST(req({ RecordType: 'SpamComplaint', Email: 'a@b.com' }, 'nope'))
		).rejects.toThrow();
		await expect(
			POST(req({ RecordType: 'SpamComplaint', Email: 'a@b.com' }, null))
		).rejects.toThrow();
		expect(mockSuppressByEmail).not.toHaveBeenCalled();
	});

	it('maps SpamComplaint to a complaint suppression', async () => {
		const res = await POST(req({ RecordType: 'SpamComplaint', Email: 'spam@example.com' }));

		expect(mockSuppressByEmail).toHaveBeenCalledWith('spam@example.com', 'complaint');
		expect(await res.json()).toMatchObject({ ok: true, reason: 'complaint' });
	});

	it('maps a HardBounce to a bounce suppression', async () => {
		await POST(req({ RecordType: 'Bounce', Type: 'HardBounce', Email: 'bad@example.com' }));

		expect(mockSuppressByEmail).toHaveBeenCalledWith('bad@example.com', 'bounce');
	});

	it('suppresses any Bounce flagged Inactive', async () => {
		await POST(
			req({ RecordType: 'Bounce', Type: 'SomethingElse', Inactive: true, Email: 'x@example.com' })
		);

		expect(mockSuppressByEmail).toHaveBeenCalledWith('x@example.com', 'bounce');
	});

	it('ignores soft/transient bounces', async () => {
		const res = await POST(
			req({ RecordType: 'Bounce', Type: 'SoftBounce', Email: 'soft@example.com' })
		);

		expect(mockSuppressByEmail).not.toHaveBeenCalled();
		expect(await res.json()).toMatchObject({ skipped: 'transient' });
	});
});
