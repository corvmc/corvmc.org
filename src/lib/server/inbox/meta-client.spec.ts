import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'crypto';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const metaEnv: Record<string, string | undefined> = {
	META_APP_SECRET: 'app-secret',
	META_PAGE_ACCESS_TOKEN: 'page-token'
};

vi.mock('$env/dynamic/private', () => ({ env: metaEnv }));

beforeEach(() => {
	metaEnv.META_APP_SECRET = 'app-secret';
	metaEnv.META_PAGE_ACCESS_TOKEN = 'page-token';
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------

// The import stays dynamic so it resolves after the `vi.mock` above, and sits at
// module scope so the cold Vite transform of the module graph is paid once,
// during file evaluation — not inside a test, where it would race the timeout.
const {
	verifyMetaSignature,
	normalizeMetaEvent,
	metaMessageBody,
	sendMetaMessage,
	fetchMetaProfile,
	testMetaConnection
} = await import('./meta-client');

function sign(body: string, secret = 'app-secret'): string {
	return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
}

function okResponse(payload: unknown) {
	return {
		ok: true,
		status: 200,
		json: async () => payload,
		text: async () => JSON.stringify(payload)
	};
}

function errorResponse(status: number, payload: unknown) {
	return {
		ok: false,
		status,
		json: async () => payload,
		text: async () => JSON.stringify(payload)
	};
}

// ---------------------------------------------------------------------------

describe('verifyMetaSignature', () => {
	const body = '{"object":"instagram"}';

	it('accepts a signature made with the app secret', () => {
		expect(verifyMetaSignature(body, sign(body))).toBe(true);
	});

	it('rejects a signature over different content', () => {
		expect(verifyMetaSignature(body, sign('{"object":"page"}'))).toBe(false);
	});

	it('rejects a signature made with the wrong secret', () => {
		expect(verifyMetaSignature(body, sign(body, 'not-the-secret'))).toBe(false);
	});

	it('rejects a missing header rather than treating it as a pass', () => {
		expect(verifyMetaSignature(body, null)).toBe(false);
		expect(verifyMetaSignature(body, '')).toBe(false);
	});

	it('rejects everything when no app secret is configured', () => {
		metaEnv.META_APP_SECRET = undefined;
		expect(verifyMetaSignature(body, sign(body))).toBe(false);
	});

	// A shorter header must not throw out of timingSafeEqual, which requires
	// equal-length buffers — that would surface as a 500 on an attacker's probe.
	it('rejects a truncated header without throwing', () => {
		expect(verifyMetaSignature(body, 'sha256=abc')).toBe(false);
	});
});

describe('normalizeMetaEvent', () => {
	it('reads an ordinary inbound message', () => {
		const result = normalizeMetaEvent({
			sender: { id: 'ig-1' },
			recipient: { id: 'page-1' },
			timestamp: 1700000000,
			message: { mid: 'm-1', text: 'Do you rent hourly?' }
		});

		expect(result).toEqual({
			kind: 'inbound',
			senderId: 'ig-1',
			messageId: 'm-1',
			body: 'Do you rent hourly?',
			timestamp: 1700000000,
			attachments: null,
			replyTo: null
		});
	});

	// The inversion is the whole point: on an echo the Page is the sender, so
	// keying the thread on `sender.id` would file every reply we send under a
	// contact whose external id is our own page.
	it('takes the contact from `recipient` on an echo', () => {
		const result = normalizeMetaEvent({
			sender: { id: 'page-1' },
			recipient: { id: 'ig-1' },
			timestamp: 1700000001,
			message: { mid: 'm-2', text: 'Yes, $15/hr.', is_echo: true }
		});

		expect(result).toEqual({
			kind: 'echo',
			contactId: 'ig-1',
			messageId: 'm-2',
			body: 'Yes, $15/hr.',
			timestamp: 1700000001
		});
	});

	it.each([
		['delivery', { delivery: { mids: ['m-1'] } }],
		['read', { read: { watermark: 1 } }],
		['reaction', { reaction: { emoji: '❤️' } }],
		['postback', { postback: { payload: 'GET_STARTED' } }]
	])('skips a %s event', (_label, extra) => {
		const result = normalizeMetaEvent({ sender: { id: 'ig-1' }, ...extra });
		expect(result.kind).toBe('skip');
	});

	it('skips an event with no message payload', () => {
		expect(normalizeMetaEvent({ sender: { id: 'ig-1' } }).kind).toBe('skip');
	});

	// Without a mid there is no dedupe key, and Meta redelivers for 36 hours.
	it('skips a message with no mid', () => {
		const result = normalizeMetaEvent({ sender: { id: 'ig-1' }, message: { text: 'hi' } });
		expect(result).toEqual({ kind: 'skip', reason: 'message has no mid' });
	});

	it('skips a message with no sender id', () => {
		const result = normalizeMetaEvent({ message: { mid: 'm-1', text: 'hi' } });
		expect(result).toEqual({ kind: 'skip', reason: 'message has no sender id' });
	});

	it('skips an echo with no recipient id', () => {
		const result = normalizeMetaEvent({
			sender: { id: 'page-1' },
			message: { mid: 'm-1', text: 'hi', is_echo: true }
		});
		expect(result).toEqual({ kind: 'skip', reason: 'echo has no recipient id' });
	});

	it('carries attachments and reply_to through to the caller', () => {
		const result = normalizeMetaEvent({
			sender: { id: 'ig-1' },
			message: {
				mid: 'm-3',
				attachments: [{ type: 'image', payload: { url: 'https://cdn.example/1.jpg' } }],
				reply_to: { story: { id: 's-1', url: 'https://cdn.example/story' } }
			}
		});

		expect(result).toMatchObject({
			kind: 'inbound',
			attachments: [{ type: 'image', payload: { url: 'https://cdn.example/1.jpg' } }],
			replyTo: { story: { id: 's-1', url: 'https://cdn.example/story' } }
		});
	});
});

describe('metaMessageBody', () => {
	it('uses the text when there is text', () => {
		expect(metaMessageBody({ text: 'Hello there' })).toBe('Hello there');
	});

	it.each([
		['image', '[Photo]'],
		['video', '[Video]'],
		['audio', '[Voice message]'],
		['file', '[File]'],
		['share', '[Shared a post]'],
		['story_mention', '[Mentioned you in a story]'],
		['ig_reel', '[Shared a reel]']
	])('labels a bare %s attachment', (type, expected) => {
		expect(metaMessageBody({ attachments: [{ type }] })).toBe(expected);
	});

	it('labels an unknown attachment type rather than dropping it', () => {
		expect(metaMessageBody({ attachments: [{ type: 'something_new' }] })).toBe('[Attachment]');
	});

	it('marks a story reply and keeps the text', () => {
		const body = metaMessageBody({
			text: 'love this',
			reply_to: { story: { id: 's-1' } }
		});
		expect(body).toBe('[Replied to your story] love this');
	});

	it('collapses repeated attachment types into one label', () => {
		const body = metaMessageBody({ attachments: [{ type: 'image' }, { type: 'image' }] });
		expect(body).toBe('[Photo]');
	});

	// `inbox_message.body` is NOT NULL, and an empty preview reads as a broken
	// row rather than as an attachment nobody labelled.
	it('never returns an empty body', () => {
		expect(metaMessageBody({})).toBe('[Message]');
		expect(metaMessageBody({ text: '   ' })).toBe('[Message]');
	});
});

describe('sendMetaMessage', () => {
	it('sends a RESPONSE inside the 24-hour window and returns the message id', async () => {
		const fetchMock = vi.fn().mockResolvedValue(okResponse({ message_id: 'mid-out-1' }));
		vi.stubGlobal('fetch', fetchMock);

		const id = await sendMetaMessage({
			recipientId: 'ig-1',
			body: 'On our way',
			lastInboundAt: new Date(Date.now() - 60 * 60 * 1000)
		});

		expect(id).toBe('mid-out-1');
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('https://graph.facebook.com/v21.0/me/messages');
		expect(JSON.parse(init.body)).toEqual({
			recipient: { id: 'ig-1' },
			message: { text: 'On our way' },
			messaging_type: 'RESPONSE'
		});
		expect(init.headers.Authorization).toBe('Bearer page-token');
	});

	it('tags a reply sent past 24 hours as HUMAN_AGENT', async () => {
		const fetchMock = vi.fn().mockResolvedValue(okResponse({ message_id: 'mid-out-2' }));
		vi.stubGlobal('fetch', fetchMock);

		await sendMetaMessage({
			recipientId: 'ig-1',
			body: 'Sorry for the delay',
			lastInboundAt: new Date(Date.now() - 48 * 60 * 60 * 1000)
		});

		expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
			messaging_type: 'MESSAGE_TAG',
			tag: 'HUMAN_AGENT'
		});
	});

	it('treats a thread we have never heard from as outside the window', async () => {
		const fetchMock = vi.fn().mockResolvedValue(okResponse({ message_id: 'mid-out-3' }));
		vi.stubGlobal('fetch', fetchMock);

		await sendMetaMessage({ recipientId: 'ig-1', body: 'Hi', lastInboundAt: null });

		expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ tag: 'HUMAN_AGENT' });
	});

	it('refuses to send without a page token', async () => {
		metaEnv.META_PAGE_ACCESS_TOKEN = undefined;
		await expect(
			sendMetaMessage({ recipientId: 'ig-1', body: 'Hi', lastInboundAt: null })
		).rejects.toThrow('META_PAGE_ACCESS_TOKEN is not configured');
	});

	it('explains a closed messaging window instead of surfacing the raw blob', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValue(
					errorResponse(400, { error: { code: 10, error_subcode: 2018278, message: 'nope' } })
				)
		);

		await expect(
			sendMetaMessage({ recipientId: 'ig-1', body: 'Hi', lastInboundAt: null })
		).rejects.toThrow(/messaging window has closed/);
	});

	it('names an expired token', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(errorResponse(401, { error: { code: 190, message: 'expired' } }))
		);

		await expect(
			sendMetaMessage({ recipientId: 'ig-1', body: 'Hi', lastInboundAt: null })
		).rejects.toThrow(/META_PAGE_ACCESS_TOKEN/);
	});

	// An unmapped failure has to stay diagnosable rather than being flattened
	// into a friendly sentence that hides what Meta actually said.
	it('passes an unrecognised failure through verbatim', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(errorResponse(500, { error: { code: 99999, message: 'boom' } }))
		);

		await expect(
			sendMetaMessage({ recipientId: 'ig-1', body: 'Hi', lastInboundAt: null })
		).rejects.toThrow(/Meta API error \(500\)/);
	});
});

describe('fetchMetaProfile', () => {
	it('returns the name and username', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(okResponse({ name: 'Ada Lovelace', username: 'ada' }))
		);

		await expect(fetchMetaProfile('ig-1')).resolves.toEqual({
			name: 'Ada Lovelace',
			username: 'ada'
		});
	});

	// Every failure here is non-fatal: the lookup needs its own permission and
	// can 400 on a contact who has never messaged the Page. Losing the message
	// over a missing display name would be the worse trade.
	it('returns null on a non-200', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(errorResponse(400, { error: {} })));
		await expect(fetchMetaProfile('ig-1')).resolves.toBeNull();
	});

	it('returns null when the network throws', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
		await expect(fetchMetaProfile('ig-1')).resolves.toBeNull();
	});

	it('returns null without calling Meta when no token is configured', async () => {
		metaEnv.META_PAGE_ACCESS_TOKEN = undefined;
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);

		await expect(fetchMetaProfile('ig-1')).resolves.toBeNull();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('returns null on an empty profile rather than an empty name', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse({})));
		await expect(fetchMetaProfile('ig-1')).resolves.toBeNull();
	});
});

describe('testMetaConnection', () => {
	it('names the page the token belongs to', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(okResponse({ name: 'Corvallis Music Collective' }))
		);

		await expect(testMetaConnection()).resolves.toEqual({
			ok: true,
			pageName: 'Corvallis Music Collective'
		});
	});

	// Returns rather than throws: the settings page has to render the failure,
	// and a 500 there tells a staffer nothing about which secret is wrong.
	it('reports a missing token instead of throwing', async () => {
		metaEnv.META_PAGE_ACCESS_TOKEN = undefined;
		const result = await testMetaConnection();
		expect(result.ok).toBe(false);
		expect(result.error).toMatch(/META_PAGE_ACCESS_TOKEN/);
	});

	it('reports a rejected token instead of throwing', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(errorResponse(401, { error: { code: 190, message: 'expired' } }))
		);

		const result = await testMetaConnection();
		expect(result.ok).toBe(false);
		expect(result.error).toMatch(/expired or been revoked/);
	});
});
