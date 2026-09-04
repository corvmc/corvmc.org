import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'crypto';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockHandleMetaInbound = vi.fn(async () => ({
	thread: { id: 't1' },
	message: { id: 'm1' },
	duplicate: false as const
}));
const mockHandleMetaEcho = vi.fn(async () => ({
	thread: { id: 't1' },
	message: { id: 'm2' },
	duplicate: false as const
}));
vi.mock('$lib/server/inbox/inbound-handlers', () => ({
	handleMetaInbound: (...args: unknown[]) => mockHandleMetaInbound(...(args as [])),
	handleMetaEcho: (...args: unknown[]) => mockHandleMetaEcho(...(args as []))
}));

const mockIsChannelEnabled = vi.fn(async () => true);
vi.mock('$lib/server/inbox/channel-config-service', () => ({
	isChannelEnabled: (...args: unknown[]) => mockIsChannelEnabled(...(args as []))
}));

const mockEnv: Record<string, string | undefined> = {
	META_APP_SECRET: 'app-secret',
	META_VERIFY_TOKEN: 'verify-token'
};
vi.mock('$env/dynamic/private', () => ({
	get env() {
		return mockEnv;
	}
}));

beforeEach(() => {
	vi.clearAllMocks();
	mockEnv.META_APP_SECRET = 'app-secret';
	mockEnv.META_VERIFY_TOKEN = 'verify-token';
	mockIsChannelEnabled.mockResolvedValue(true);
});

afterEach(() => {
	vi.unstubAllEnvs();
});

/**
 * Pretend to be production.
 *
 * The route deliberately behaves differently under `import.meta.env.DEV` — it
 * waves an unsigned request through and rethrows a handler failure instead of
 * swallowing it — and vitest runs with DEV set. Without this the two behaviours
 * that only matter in production are the two that cannot be tested.
 */
function asProduction() {
	vi.stubEnv('DEV', false);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sign(body: string): string {
	return 'sha256=' + createHmac('sha256', 'app-secret').update(body).digest('hex');
}

/** A POST event with a valid signature over its own body. */
function req(payload: unknown, headers?: Record<string, string>) {
	const body = JSON.stringify(payload);
	return {
		request: new Request('http://localhost/api/inbox/meta', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'x-hub-signature-256': sign(body),
				...headers
			},
			body
		})
	} as any;
}

function getReq(params: Record<string, string>) {
	const url = new URL('http://localhost/api/inbox/meta');
	for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
	return { url } as any;
}

function payload(messaging: unknown[], object = 'instagram') {
	return { object, entry: [{ id: 'page-1', time: 1, messaging }] };
}

const INBOUND = {
	sender: { id: 'ig-1' },
	recipient: { id: 'page-1' },
	timestamp: 1700000000,
	message: { mid: 'm-1', text: 'Do you rent hourly?' }
};

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------

// The import stays dynamic so it resolves after the `vi.mock` calls above, and
// sits at module scope so the cold Vite transform of the whole module graph is
// paid once, during file evaluation — not inside a test or hook, where it would
// race the 5s test / 10s hook timeout on a cold `node_modules/.vite`.
const { GET, POST } = await import('./+server');

// ---------------------------------------------------------------------------

describe('GET — subscription handshake', () => {
	it('echoes the challenge when the verify token matches', async () => {
		const response = await GET(
			getReq({
				'hub.mode': 'subscribe',
				'hub.verify_token': 'verify-token',
				'hub.challenge': '1234'
			})
		);
		await expect(response.text()).resolves.toBe('1234');
	});

	it('refuses a wrong verify token', async () => {
		await expect(
			GET(getReq({ 'hub.mode': 'subscribe', 'hub.verify_token': 'nope', 'hub.challenge': '1234' }))
		).rejects.toThrow();
	});

	// An unset token must not turn every request into a valid handshake, which is
	// what a plain `token === verifyToken` does when both sides are undefined.
	it('refuses the handshake when no verify token is configured', async () => {
		mockEnv.META_VERIFY_TOKEN = undefined;
		await expect(
			GET(getReq({ 'hub.mode': 'subscribe', 'hub.challenge': '1234' }))
		).rejects.toThrow();
	});
});

describe('POST — authentication', () => {
	it('accepts a correctly signed body', async () => {
		const response = await POST(req(payload([INBOUND])));
		await expect(response.json()).resolves.toEqual({ ok: true });
		expect(mockHandleMetaInbound).toHaveBeenCalledOnce();
	});

	it('refuses a body whose signature does not match', async () => {
		await expect(
			POST(req(payload([INBOUND]), { 'x-hub-signature-256': 'sha256=deadbeef' }))
		).rejects.toThrow();
		expect(mockHandleMetaInbound).not.toHaveBeenCalled();
	});

	// Meta always signs. An unsigned request in production is either a probe or a
	// misconfiguration, and the DEV bypass exists so a curl against the dev
	// server does not need an HMAC.
	it('refuses an unsigned body in production', async () => {
		asProduction();
		const body = JSON.stringify(payload([INBOUND]));
		const request = new Request('http://localhost/api/inbox/meta', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body
		});

		await expect(POST({ request } as any)).rejects.toThrow();
		expect(mockHandleMetaInbound).not.toHaveBeenCalled();
	});

	it('accepts an unsigned body in dev', async () => {
		const body = JSON.stringify(payload([INBOUND]));
		const request = new Request('http://localhost/api/inbox/meta', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body
		});

		const response = await POST({ request } as any);
		await expect(response.json()).resolves.toEqual({ ok: true });
	});

	it('refuses a malformed body', async () => {
		const body = 'not json';
		const request = new Request('http://localhost/api/inbox/meta', {
			method: 'POST',
			headers: { 'x-hub-signature-256': sign(body) },
			body
		});
		await expect(POST({ request } as any)).rejects.toThrow();
	});
});

describe('POST — channel gate', () => {
	it('files nothing when the channel is switched off', async () => {
		mockIsChannelEnabled.mockResolvedValue(false);

		const response = await POST(req(payload([INBOUND])));

		await expect(response.json()).resolves.toEqual({ ok: true, skipped: 'channel disabled' });
		expect(mockHandleMetaInbound).not.toHaveBeenCalled();
	});

	it('asks about instagram for an instagram payload and messenger otherwise', async () => {
		await POST(req(payload([INBOUND], 'instagram')));
		expect(mockIsChannelEnabled).toHaveBeenCalledWith('instagram');

		vi.clearAllMocks();
		mockIsChannelEnabled.mockResolvedValue(true);

		await POST(req(payload([INBOUND], 'page')));
		expect(mockIsChannelEnabled).toHaveBeenCalledWith('messenger');
	});
});

describe('POST — routing', () => {
	it('files an ordinary message as inbound, carrying its attachments', async () => {
		await POST(
			req(
				payload([
					{
						sender: { id: 'ig-1' },
						timestamp: 1700000000,
						message: {
							mid: 'm-1',
							attachments: [{ type: 'image', payload: { url: 'https://cdn.example/1.jpg' } }]
						}
					}
				])
			)
		);

		expect(mockHandleMetaInbound).toHaveBeenCalledWith({
			channel: 'instagram',
			senderId: 'ig-1',
			messageId: 'm-1',
			body: '[Photo]',
			timestamp: 1700000000,
			attachments: [{ type: 'image', payload: { url: 'https://cdn.example/1.jpg' } }],
			replyTo: null
		});
	});

	// The whole reason echoes are handled at all: an unfiltered echo is our own
	// reply arriving back as a message from the contact, which clears
	// awaitingReplySince and puts a thread we just answered back in the queue.
	it('routes an echo to the echo handler, not the inbound one', async () => {
		await POST(
			req(
				payload([
					{
						sender: { id: 'page-1' },
						recipient: { id: 'ig-1' },
						timestamp: 1700000001,
						message: { mid: 'm-2', text: 'Yes, $15/hr.', is_echo: true }
					}
				])
			)
		);

		expect(mockHandleMetaInbound).not.toHaveBeenCalled();
		expect(mockHandleMetaEcho).toHaveBeenCalledWith({
			channel: 'instagram',
			contactId: 'ig-1',
			messageId: 'm-2',
			body: 'Yes, $15/hr.',
			timestamp: 1700000001
		});
	});

	it.each([
		['delivery', { delivery: { mids: ['m-1'] } }],
		['read', { read: { watermark: 1 } }],
		['reaction', { reaction: { emoji: '❤️' } }]
	])('files nothing for a %s receipt', async (_label, extra) => {
		await POST(req(payload([{ sender: { id: 'ig-1' }, ...extra }])));

		expect(mockHandleMetaInbound).not.toHaveBeenCalled();
		expect(mockHandleMetaEcho).not.toHaveBeenCalled();
	});

	it('ignores entry[].changes — comments are not conversations', async () => {
		await POST(
			req({
				object: 'instagram',
				entry: [{ id: 'page-1', time: 1, changes: [{ field: 'comments' }] }]
			})
		);

		expect(mockHandleMetaInbound).not.toHaveBeenCalled();
	});

	it('handles every message in a batched delivery', async () => {
		await POST(
			req(
				payload([
					INBOUND,
					{ sender: { id: 'ig-2' }, timestamp: 2, message: { mid: 'm-9', text: 'second' } }
				])
			)
		);

		expect(mockHandleMetaInbound).toHaveBeenCalledTimes(2);
	});

	// Meta redelivers the entire batch on a non-200 and unsubscribes an app that
	// keeps failing, so one bad message must not cost us the rest of the batch —
	// nor the 200.
	it('keeps going after a handler throws, and still answers 200', async () => {
		asProduction();
		mockHandleMetaInbound.mockRejectedValueOnce(new Error('db down'));

		const response = await POST(
			req(
				payload([
					INBOUND,
					{ sender: { id: 'ig-2' }, timestamp: 2, message: { mid: 'm-9', text: 'second' } }
				])
			)
		);

		await expect(response.json()).resolves.toEqual({ ok: true });
		expect(mockHandleMetaInbound).toHaveBeenCalledTimes(2);
	});
});
