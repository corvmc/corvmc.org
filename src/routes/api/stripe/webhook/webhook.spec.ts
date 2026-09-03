import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// The route uses the async verifier (`constructEventAsync`) because Workers has
// no synchronous crypto. This mock guards the wiring only — Node vitest cannot
// reproduce the runtime SubtleCrypto-sync failure (Node has sync crypto).
const mockConstructEvent = vi.fn();
vi.mock('$lib/server/stripe', () => ({
	stripeWebhooks: { constructEventAsync: (...args: unknown[]) => mockConstructEvent(...args) },
	webhookCryptoProvider: {}
}));

const mockHandler = vi.fn();
vi.mock('$lib/server/finance/webhook-handlers', () => ({
	webhookHandlerMap: {
		'checkout.session.completed': (...args: unknown[]) => mockHandler(...args)
	} as Record<string, (...args: unknown[]) => Promise<void>>
}));

vi.mock('$env/dynamic/private', () => ({
	env: { STRIPE_WEBHOOK_SECRET: 'whsec_test' }
}));

const mockCaptureException = vi.fn();
vi.mock('$lib/server/sentry', () => ({
	captureException: (...args: unknown[]) => mockCaptureException(...args)
}));

beforeEach(() => {
	vi.clearAllMocks();
});

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

describe('POST /api/stripe/webhook', () => {
	function req(opts?: { signature?: string | null; body?: string }) {
		const headers: Record<string, string> = {};
		if (opts?.signature !== null) {
			headers['stripe-signature'] = opts?.signature ?? 'sig_valid';
		}
		return {
			request: new Request('http://localhost/api/stripe/webhook', {
				method: 'POST',
				headers,
				body: opts?.body ?? '{"test":true}'
			})
		} as any;
	}

	it('returns 400 when stripe-signature header is missing', async () => {
		await expect(POST(req({ signature: null }))).rejects.toThrow();
	});

	it('returns 400 when signature verification fails', async () => {
		mockConstructEvent.mockImplementation(() => {
			throw new Error('Invalid signature');
		});

		await expect(POST(req())).rejects.toThrow();
	});

	it('routes to correct handler from webhookHandlerMap', async () => {
		const mockDataObject = { id: 'cs_123', metadata: {} };
		mockConstructEvent.mockReturnValue({
			type: 'checkout.session.completed',
			id: 'evt_123',
			data: { object: mockDataObject }
		});
		mockHandler.mockResolvedValue(undefined);

		const response = await POST(req());
		const body = (await response.json()) as any;

		expect(body).toEqual({ received: true });
		expect(mockHandler).toHaveBeenCalledWith(mockDataObject);
	});

	it('returns 200 when no handler exists for event type', async () => {
		mockConstructEvent.mockReturnValue({
			type: 'unknown.event.type',
			id: 'evt_456',
			data: { object: {} }
		});

		const response = await POST(req());
		const body = (await response.json()) as any;

		expect(body).toEqual({ received: true });
		expect(mockHandler).not.toHaveBeenCalled();
	});

	it('returns 500 when handler throws so Stripe retries', async () => {
		// The handler only catches errors in non-DEV; vitest sets import.meta.env.DEV true.
		// Handlers are idempotent, so we surface failure (500) to trigger Stripe redelivery
		// rather than silently dropping the event with a 200.
		vi.stubEnv('DEV', false);
		mockConstructEvent.mockReturnValue({
			type: 'checkout.session.completed',
			id: 'evt_789',
			data: { object: {} }
		});
		mockHandler.mockRejectedValue(new Error('handler exploded'));

		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		await expect(POST(req())).rejects.toMatchObject({ status: 500 });
		consoleSpy.mockRestore();
		vi.unstubAllEnvs();
	});

	it('captures error to Sentry with event context when handler throws', async () => {
		vi.stubEnv('DEV', false);
		mockConstructEvent.mockReturnValue({
			type: 'checkout.session.completed',
			id: 'evt_err',
			data: { object: { customer: 'cus_123' } }
		});
		const handlerError = new Error('handler failed');
		mockHandler.mockRejectedValue(handlerError);

		await expect(POST(req())).rejects.toMatchObject({ status: 500 });

		expect(mockCaptureException).toHaveBeenCalledWith(handlerError, {
			stage: 'handler',
			eventType: 'checkout.session.completed',
			eventId: 'evt_err',
			customerId: 'cus_123'
		});
		vi.unstubAllEnvs();
	});
});
