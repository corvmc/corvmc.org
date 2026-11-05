import { beforeEach, describe, expect, it, vi } from 'vitest';
import twilio from 'twilio';

const mockHandleTwilioInbound = vi.fn(async () => ({}));
vi.mock('$lib/server/inbox/inbound-handlers', () => ({
	handleTwilioInbound: (...args: unknown[]) => mockHandleTwilioInbound(...(args as []))
}));
vi.mock('$lib/server/inbox/channel-config-service', () => ({
	isChannelEnabled: async () => true
}));

const mockEnv: Record<string, string | undefined> = {};
vi.mock('$env/dynamic/private', () => ({
	get env() {
		return mockEnv;
	}
}));

const { POST } = await import('./+server');

const TOKEN = 'local-token';
const URL_ = 'http://localhost/api/inbox/twilio';
const params = { From: '+15415550100', To: '+15415550199', Body: 'hi', MessageSid: 'SM1' };

function post(signature: string | null) {
	const request = new Request(URL_, {
		method: 'POST',
		headers: {
			'content-type': 'application/x-www-form-urlencoded',
			...(signature === null ? {} : { 'x-twilio-signature': signature })
		},
		body: new URLSearchParams(params).toString()
	});
	return POST({ request, url: new URL(URL_) } as unknown as Parameters<typeof POST>[0]);
}

const signed = () => twilio.getExpectedTwilioSignature(TOKEN, URL_, params);

beforeEach(() => {
	vi.clearAllMocks();
	mockEnv.TWILIO_AUTH_TOKEN = TOKEN;
});

describe('POST /api/inbox/twilio', () => {
	it('accepts a correctly signed post', async () => {
		const res = await post(signed());

		expect(res.status).toBe(200);
		expect(mockHandleTwilioInbound).toHaveBeenCalledOnce();
	});

	it('refuses a wrong signature', async () => {
		await expect(post('wrong')).rejects.toMatchObject({ status: 403 });
		expect(mockHandleTwilioInbound).not.toHaveBeenCalled();
	});

	// Production has no TWILIO_* secrets. A post cannot be verified, so it is refused
	// as one that failed verification, as Meta and Postmark do, and is not a crash.
	it('refuses a signed post when the auth token is not configured', async () => {
		mockEnv.TWILIO_AUTH_TOKEN = undefined;

		await expect(post(signed())).rejects.toMatchObject({ status: 403 });
		expect(mockHandleTwilioInbound).not.toHaveBeenCalled();
	});
});
