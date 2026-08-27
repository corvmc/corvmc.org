import { describe, it, expect, vi, beforeEach } from 'vitest';
import { formatDateInTz, formatTimeInTz } from '$lib/server/reservation/timezone';
import { DEFAULT_TIMEZONE } from '$lib/config';

// ---------------------------------------------------------------------------
// Mocks — credentials + a cached token so no token refresh fetch is needed.
// ---------------------------------------------------------------------------

vi.mock('$env/dynamic/private', () => ({ env: {} }));

vi.mock('$lib/server/kv', () => ({
	getJson: vi.fn().mockResolvedValue({ accessToken: 'tok', expiresAt: Date.now() + 1_000_000 }),
	putJson: vi.fn()
}));

vi.mock('$lib/server/site-config/site-config-service', () => ({
	getConfigsByPrefix: vi.fn().mockResolvedValue({
		clientId: 'cid',
		clientSecret: 'secret',
		deviceId: 'DEV-1',
		refreshToken: 'refresh'
	})
}));

const {
	generateLockCode,
	createTemporaryUser,
	createControlUser,
	removeTemporaryUser,
	listLockUsers,
	LOCK_GRACE_MINUTES,
	buildAuthorizeUrl,
	exchangeAuthorizationCode
} = await import('./ultraloc-client');

let lastBody: any = null;
let lastUrl: string | null = null;

function mockFetch(payload: Record<string, unknown>) {
	lastBody = null;
	vi.stubGlobal(
		'fetch',
		vi.fn(async (_url: string, init: RequestInit) => {
			lastBody = JSON.parse(init.body as string);
			return { ok: true, json: async () => ({ payload }) } as Response;
		})
	);
}

// Captures the request URL (token endpoint calls are GETs with query params).
function mockFetchUrl(json: Record<string, unknown>, ok = true) {
	lastUrl = null;
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string) => {
			lastUrl = url;
			return {
				ok,
				status: ok ? 200 : 400,
				json: async () => json,
				text: async () => ''
			} as Response;
		})
	);
}

beforeEach(() => {
	vi.unstubAllGlobals();
	lastBody = null;
	lastUrl = null;
});

describe('generateLockCode', () => {
	it('always returns a 4-digit integer', () => {
		for (let i = 0; i < 200; i++) {
			const code = generateLockCode();
			expect(Number.isInteger(code)).toBe(true);
			expect(code).toBeGreaterThanOrEqual(1000);
			expect(code).toBeLessThanOrEqual(9999);
		}
	});
});

describe('createTemporaryUser', () => {
	it('sends an st.lockUser add command with a flat temporary-user payload', async () => {
		mockFetch({ devices: [{ states: [] }] });

		const startTime = new Date('2026-07-01T18:00:00-07:00');
		const endTime = new Date('2026-07-01T20:00:00-07:00');

		await createTemporaryUser({ name: 'Jordan', startTime, endTime, code: 4242 });

		const cmd = lastBody.payload.devices[0].command;
		expect(lastBody.payload.devices[0].id).toBe('DEV-1');
		expect(cmd.capability).toBe('st.lockUser');
		expect(cmd.name).toBe('add');
		expect(cmd.arguments.type).toBe(2);
		expect(cmd.arguments.password).toBe(4242);
		expect(cmd.arguments.name).toBe('Jordan');

		// daterange end = reservation end + grace, formatted in the venue timezone.
		const graceEnd = new Date(endTime.getTime() + LOCK_GRACE_MINUTES * 60_000);
		const expectedEnd = `${formatDateInTz(graceEnd, DEFAULT_TIMEZONE)} ${formatTimeInTz(graceEnd, DEFAULT_TIMEZONE)}`;
		const expectedStart = `${formatDateInTz(startTime, DEFAULT_TIMEZONE)} ${formatTimeInTz(startTime, DEFAULT_TIMEZONE)}`;
		expect(cmd.arguments.daterange).toEqual([expectedStart, expectedEnd]);

		// Temporary users require the full schedule quartet or U-tec returns BAD-REQUEST.
		expect(cmd.arguments.weeks).toEqual([0, 1, 2, 3, 4, 5, 6]);
		expect(cmd.arguments.timerange).toEqual(['00:00', '23:59']);
		expect(cmd.arguments.limit).toBe(0);
	});
});

describe('createControlUser', () => {
	it('sends a minimal normal-user (type 0) add — name/type/password only', async () => {
		mockFetch({ devices: [{ states: [] }] });

		await createControlUser('CMC Self-Test', 4242);

		const cmd = lastBody.payload.devices[0].command;
		expect(cmd.name).toBe('add');
		expect(cmd.arguments).toEqual({ name: 'CMC Self-Test', type: 0, password: 4242 });
	});
});

describe('removeTemporaryUser', () => {
	it('sends an st.lockUser delete command with the user id', async () => {
		mockFetch({ devices: [{ states: [] }] });

		await removeTemporaryUser(987);

		const cmd = lastBody.payload.devices[0].command;
		expect(cmd.name).toBe('delete');
		expect(cmd.arguments).toEqual({ id: 987 });
	});
});

describe('listLockUsers', () => {
	it('parses the users array from the device list', async () => {
		const users = [
			{ id: 1, name: 'A', type: 2 },
			{ id: 2, name: 'B', type: 0 }
		];
		mockFetch({ devices: [{ id: 'DEV-1', users }] });

		const result = await listLockUsers();

		expect(result).toEqual(users);
		expect(lastBody.payload.devices[0].command.name).toBe('list');
	});

	it('returns an empty array when no users are present', async () => {
		mockFetch({ devices: [{ id: 'DEV-1' }] });
		expect(await listLockUsers()).toEqual([]);
	});
});

describe('buildAuthorizeUrl', () => {
	it('builds the authorize URL with the OAuth params', () => {
		const url = new URL(
			buildAuthorizeUrl('cid', 'https://corvmc.org/api/integrations/utec/callback', 'st8')
		);
		expect(url.origin + url.pathname).toBe('https://oauth.u-tec.com/authorize');
		expect(url.searchParams.get('response_type')).toBe('code');
		expect(url.searchParams.get('client_id')).toBe('cid');
		expect(url.searchParams.get('redirect_uri')).toBe(
			'https://corvmc.org/api/integrations/utec/callback'
		);
		expect(url.searchParams.get('scope')).toBe('openapi');
		expect(url.searchParams.get('state')).toBe('st8');
	});
});

describe('exchangeAuthorizationCode', () => {
	it("unwraps U-tec's {code,data} envelope and returns the refresh token", async () => {
		// U-tec nests the OAuth fields under `data`.
		mockFetchUrl({
			code: 200,
			data: { access_token: 'at', refresh_token: 'rt', expires_in: 601200 }
		});

		const result = await exchangeAuthorizationCode('the-code', 'https://corvmc.org/cb');

		expect(result.refreshToken).toBe('rt');
		expect(result.accessToken).toBe('at');
		expect(result.expiresIn).toBe(601200);
		const url = new URL(lastUrl!);
		expect(url.origin + url.pathname).toBe('https://oauth.u-tec.com/token');
		expect(url.searchParams.get('grant_type')).toBe('authorization_code');
		expect(url.searchParams.get('code')).toBe('the-code');
		expect(url.searchParams.get('redirect_uri')).toBe('https://corvmc.org/cb');
		expect(url.searchParams.get('client_id')).toBe('cid');
		expect(url.searchParams.get('client_secret')).toBe('secret');
	});

	it('also accepts an already-flat token response', async () => {
		mockFetchUrl({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 });
		const result = await exchangeAuthorizationCode('c', 'https://corvmc.org/cb');
		expect(result.refreshToken).toBe('rt');
	});

	it('throws when no refresh token is returned', async () => {
		mockFetchUrl({ code: 400, data: {} });
		await expect(exchangeAuthorizationCode('c', 'https://corvmc.org/cb')).rejects.toThrow(
			/no refresh_token/
		);
	});
});
