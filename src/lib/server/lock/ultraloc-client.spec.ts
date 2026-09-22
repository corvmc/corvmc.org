import { describe, it, expect, vi, beforeEach } from 'vitest';
import { formatDateInTz, formatTimeInTz } from '$lib/server/reservation/timezone';
import { DEFAULT_TIMEZONE } from '$lib/config';

// ---------------------------------------------------------------------------
// Mocks — credentials + a cached token so no token refresh fetch is needed.
// ---------------------------------------------------------------------------

// Fixture values, not credentials. Both credentials resolve the same way —
// stored value first, env var as the fallback for a checkout that has none.
const ENV_CREDENTIALS = {
	ULTRALOC_CLIENT_SECRET: 'env-client-secret-fixture',
	ULTRALOC_REFRESH_TOKEN: 'env-refresh-token-fixture'
};
const STORED_SECRET = 'kv-client-secret-stored';

vi.mock('$env/dynamic/private', () => ({ env: {} }));

vi.mock('$lib/server/kv', () => ({
	getJson: vi.fn().mockResolvedValue({ accessToken: 'tok', expiresAt: Date.now() + 1_000_000 }),
	putJson: vi.fn()
}));

vi.mock('$lib/server/site-config/site-config-service', () => ({
	getConfigsByPrefix: vi.fn().mockResolvedValue({
		clientId: 'cid',
		deviceId: 'DEV-1',
		clientSecret: 'kv-client-secret-stored',
		refreshToken: 'kv-refresh-token'
	})
}));

const { env } = await import('$env/dynamic/private');
const { getConfigsByPrefix } = await import('$lib/server/site-config/site-config-service');

const {
	credentialStatus,
	generateLockCode,
	createTemporaryUser,
	addLockUser,
	removeTemporaryUser,
	updateLockUser,
	listLockUsers,
	getLockUser,
	queryDeviceHealth,
	LOCK_GRACE_MINUTES,
	testConnection,
	buildAuthorizeUrl,
	exchangeAuthorizationCode
} = await import('./ultraloc-client');

let lastBody: any = null;
let lastUrl: string | null = null;
let lastTokenParams: URLSearchParams | null = null;
let addBody: any = null;

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

/**
 * `addLockUser` lists, adds, then lists again to recover the assigned id, so an
 * add test needs a fetch that answers each command differently. Captures the
 * `add` body specifically — `lastBody` would otherwise hold the trailing list.
 */
function mockAddFetch(
	before: Array<Record<string, unknown>>,
	after: Array<Record<string, unknown>>
) {
	let listCalls = 0;
	addBody = null;
	vi.stubGlobal(
		'fetch',
		vi.fn(async (_url: string, init: RequestInit) => {
			const body = JSON.parse(init.body as string);
			const command = body.payload.devices[0].command;
			if (command.name === 'add') {
				addBody = body;
				return {
					ok: true,
					json: async () => ({ payload: { devices: [{ states: [] }] } })
				} as Response;
			}
			const users = listCalls++ === 0 ? before : after;
			return { ok: true, json: async () => ({ payload: { devices: [{ users }] } }) } as Response;
		})
	);
}

// Captures the request URL (token endpoint calls are GETs with query params).
/**
 * The token endpoint. Credentials travel in the POST body, so `lastTokenParams`
 * is what the assertions read; `lastUrl` stays for the endpoint itself.
 */
function mockFetchUrl(json: Record<string, unknown>, ok = true) {
	lastUrl = null;
	lastTokenParams = null;
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init?: RequestInit) => {
			lastUrl = url;
			// Only the token endpoint: `testConnection` follows it with an API call
			// whose JSON body would otherwise overwrite this.
			if (init?.body && url === 'https://oauth.u-tec.com/token') {
				lastTokenParams = new URLSearchParams(init.body as string);
			}
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
	lastTokenParams = null;
	addBody = null;

	// Every lock command resolves the credentials, so the deployed secrets are
	// the baseline; the tests that care about their absence clear them.
	for (const key of Object.keys(ENV_CREDENTIALS)) delete env[key];
	Object.assign(env, ENV_CREDENTIALS);
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
		mockAddFetch(
			[{ id: 1, name: 'Existing', type: 0 }],
			[
				{ id: 1, name: 'Existing', type: 0 },
				{ id: 55, name: 'Jordan', type: 2 }
			]
		);

		const startTime = new Date('2026-07-01T18:00:00-07:00');
		const endTime = new Date('2026-07-01T20:00:00-07:00');

		const id = await createTemporaryUser({ name: 'Jordan', startTime, endTime, code: 4242 }, 0);

		expect(id).toBe(55);
		const cmd = addBody.payload.devices[0].command;
		expect(addBody.payload.devices[0].id).toBe('DEV-1');
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

describe('addLockUser', () => {
	it('sends the add payload through and returns the id the lock assigned', async () => {
		mockAddFetch([], [{ id: 438263, name: 'CMC Self-Test', type: 0 }]);

		const id = await addLockUser({ name: 'CMC Self-Test', type: 0, password: 4242 }, 0);

		expect(id).toBe(438263);
		const cmd = addBody.payload.devices[0].command;
		expect(cmd.name).toBe('add');
		expect(cmd.arguments).toEqual({ name: 'CMC Self-Test', type: 0, password: 4242 });
	});

	it('returns null when nothing new appeared — the add is queued, not applied', async () => {
		mockAddFetch([{ id: 1, name: 'A', type: 0 }], [{ id: 1, name: 'A', type: 0 }]);
		expect(await addLockUser({ name: 'X', type: 0, password: 1111 }, 0)).toBeNull();
	});

	it('returns null rather than guessing when two rows appeared', async () => {
		mockAddFetch(
			[],
			[
				{ id: 1, name: 'A', type: 0 },
				{ id: 2, name: 'B', type: 0 }
			]
		);
		expect(await addLockUser({ name: 'X', type: 0, password: 1111 }, 0)).toBeNull();
	});
});

describe('updateLockUser', () => {
	it('sends a partial update carrying the id — U-tec merges rather than replaces', async () => {
		mockFetch({ devices: [{ states: [] }] });

		await updateLockUser(438263, { daterange: ['2026-09-06 09:00', '2026-09-06 11:00'] });

		const cmd = lastBody.payload.devices[0].command;
		expect(cmd.name).toBe('update');
		expect(cmd.arguments).toEqual({
			id: 438263,
			daterange: ['2026-09-06 09:00', '2026-09-06 11:00']
		});
	});
});

describe('getLockUser', () => {
	it('returns the full record, mapping sync_status onto syncStatus', async () => {
		mockFetch({
			devices: [
				{
					user: {
						id: 706106,
						name: 'Res 12',
						type: 2,
						status: 1,
						sync_status: 1,
						password: '9725',
						daterange: ['2027-09-05 09:00', '2027-09-05 11:00'],
						weeks: [0, 1, 2, 3, 4, 5, 6],
						timerange: ['00:00', '23:59']
					}
				}
			]
		});

		const user = await getLockUser(706106);

		expect(lastBody.payload.devices[0].command.name).toBe('get');
		expect(lastBody.payload.devices[0].command.arguments).toEqual({ id: 706106 });
		expect(user?.syncStatus).toBe(1);
		expect(user?.password).toBe('9725');
		expect(user?.daterange).toEqual(['2027-09-05 09:00', '2027-09-05 11:00']);
	});

	it('returns null when the lock has no such user', async () => {
		mockFetch({ devices: [{}] });
		expect(await getLockUser(1)).toBeNull();
	});
});

describe('queryDeviceHealth', () => {
	it('reads online off st.healthCheck, with the cached lock state and battery', async () => {
		mockFetch({
			devices: [
				{
					states: [
						{ capability: 'st.healthCheck', name: 'status', value: 'Online' },
						{ capability: 'st.lock', name: 'lockState', value: 'Locked' },
						{ capability: 'st.batteryLevel', name: 'level', value: 4 }
					]
				}
			]
		});

		expect(await queryDeviceHealth()).toEqual({
			online: true,
			lockState: 'Locked',
			batteryLevel: 4
		});
		expect(lastBody.header.name).toBe('Query');
	});

	it('reports offline for anything that is not exactly "Online"', async () => {
		mockFetch({
			devices: [{ states: [{ capability: 'st.healthCheck', name: 'status', value: 'Offline' }] }]
		});

		const health = await queryDeviceHealth();
		expect(health.online).toBe(false);
		expect(health.batteryLevel).toBeNull();
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
		mockFetch({
			devices: [
				{
					id: 'DEV-1',
					users: [
						{ id: 1, name: 'A', type: 2, status: 1, sync_status: 0 },
						{ id: 2, name: 'B', type: 0, status: 1, sync_status: 1 }
					]
				}
			]
		});

		const result = await listLockUsers();

		expect(result).toEqual([
			{ id: 1, name: 'A', type: 2, status: 1, syncStatus: 0 },
			{ id: 2, name: 'B', type: 0, status: 1, syncStatus: 1 }
		]);
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
		// The grant goes in the body, not the query: U-tec's own collection says
		// `client_authentication: "body"`, and a credential on a URL is logged.
		expect(lastUrl).toBe('https://oauth.u-tec.com/token');
		expect(lastTokenParams?.get('grant_type')).toBe('authorization_code');
		expect(lastTokenParams?.get('code')).toBe('the-code');
		expect(lastTokenParams?.get('redirect_uri')).toBe('https://corvmc.org/cb');
		expect(lastTokenParams?.get('client_id')).toBe('cid');
	});

	// The id and the secret have to come from the same place, or they drift and
	// U-tec answers `invalid_client` — which is the whole reason #745 was undone.
	it('signs the exchange with the stored secret, beside the stored id', async () => {
		mockFetchUrl({ code: 200, data: { refresh_token: 'rt' } });
		await exchangeAuthorizationCode('c', 'https://corvmc.org/cb');

		// Read off the body, not the query: the grant travels as a form post now.
		expect(lastTokenParams?.get('client_secret')).toBe(STORED_SECRET);
		expect(lastTokenParams?.get('client_id')).toBe('cid');
	});

	it('falls back to the environment when nothing is stored', async () => {
		vi.mocked(getConfigsByPrefix).mockResolvedValueOnce({ clientId: 'cid' });
		mockFetchUrl({ code: 200, data: { refresh_token: 'rt' } });
		await exchangeAuthorizationCode('c', 'https://corvmc.org/cb');

		expect(lastTokenParams?.get('client_secret')).toBe(ENV_CREDENTIALS.ULTRALOC_CLIENT_SECRET);
	});

	it('refuses to exchange when neither source has a client secret', async () => {
		vi.mocked(getConfigsByPrefix).mockResolvedValueOnce({ clientId: 'cid' });
		delete env.ULTRALOC_CLIENT_SECRET;
		await expect(exchangeAuthorizationCode('c', 'https://corvmc.org/cb')).rejects.toThrow(
			/not configured/
		);
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

describe('credential resolution', () => {
	// Presence and provenance only: the page renders the source, never the value.
	it('reports the client secret from storage, which now holds it', async () => {
		expect(await credentialStatus('clientSecret')).toEqual({ configured: true, source: 'kv' });
	});

	it('falls the client secret back to the environment when none is stored', async () => {
		vi.mocked(getConfigsByPrefix).mockResolvedValueOnce({ clientId: 'cid' });
		expect(await credentialStatus('clientSecret')).toEqual({ configured: true, source: 'env' });
	});

	it('reports the client secret unset when neither source has one', async () => {
		vi.mocked(getConfigsByPrefix).mockResolvedValueOnce({ clientId: 'cid' });
		delete env.ULTRALOC_CLIENT_SECRET;
		expect(await credentialStatus('clientSecret')).toEqual({ configured: false, source: null });
	});

	it('reports the refresh token from KV, which still stores it', async () => {
		expect(await credentialStatus('refreshToken')).toEqual({ configured: true, source: 'kv' });
	});

	it('falls the refresh token back to the environment when KV holds none', async () => {
		vi.mocked(getConfigsByPrefix).mockResolvedValueOnce({ clientId: 'cid' });
		expect(await credentialStatus('refreshToken')).toEqual({ configured: true, source: 'env' });
	});

	it('reports the refresh token unset when neither source has one', async () => {
		vi.mocked(getConfigsByPrefix).mockResolvedValueOnce({ clientId: 'cid' });
		delete env.ULTRALOC_REFRESH_TOKEN;
		expect(await credentialStatus('refreshToken')).toEqual({ configured: false, source: null });
	});

	it('signs a token request with the stored secret', async () => {
		mockFetchUrl({ code: 200, data: { access_token: 'at', expires_in: 3600 } });

		expect(await testConnection()).toEqual({ ok: true });

		expect(lastTokenParams?.get('client_secret')).toBe(STORED_SECRET);
		expect(lastTokenParams?.get('refresh_token')).toBeTruthy();
	});

	it('runs on a stored client secret with no environment variable', async () => {
		delete env.ULTRALOC_CLIENT_SECRET;
		mockFetchUrl({ code: 200, data: { access_token: 'at', expires_in: 3600 } });

		await expect(testConnection()).resolves.toEqual({ ok: true });
	});
});
