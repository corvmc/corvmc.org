import { describe, it, expect, vi, beforeEach } from 'vitest';
import { positionOrder, type Capability, type Position } from '$lib/config';

// ---------------------------------------------------------------------------
// Mocks (the authorize module is imported transitively for STATE_COOKIE, so
// its deps must be mocked too).
// ---------------------------------------------------------------------------

// Simulated against the real matrix, so the tables below exercise what the
// positions actually grant.
let heldPositions: Position[] = ['staff'];
const requested: string[] = [];
vi.mock('$lib/server/authorization', async () => {
	const { error } = await import('@sveltejs/kit');
	const config = await import('$lib/config');
	const holds = (cap: Capability) =>
		heldPositions.some((p) => config.grantsCapability(config.positions[p], cap));
	return {
		can: async (cap: Capability) => holds(cap),
		requireCapability: async (cap: Capability) => {
			requested.push(cap);
			if (!holds(cap)) throw error(403, 'Not permitted');
			return { id: 'staff-1' };
		}
	};
});

const mockExchange = vi.fn();
vi.mock('$lib/server/lock/ultraloc-client', () => ({
	exchangeAuthorizationCode: (...args: unknown[]) => mockExchange(...args),
	buildAuthorizeUrl: vi.fn(() => 'https://oauth.u-tec.com/authorize'),
	getUtecClientId: vi.fn().mockResolvedValue('cid')
}));

const mockUpdateSiteConfig = vi.fn().mockResolvedValue(undefined);
vi.mock('$lib/server/site-config/site-config-service', () => ({
	updateSiteConfig: (...args: unknown[]) => mockUpdateSiteConfig(...args)
}));

const { GET } = await import('./+server');
const { GET: AUTHORIZE } = await import('../authorize/+server');

// Every combination of the six positions, including none.
const subsets = Array.from({ length: 2 ** positionOrder.length }, (_, mask) =>
	positionOrder.filter((_, i) => mask & (1 << i))
);

async function callGET(search: string, cookieValue: string | undefined) {
	const url = new URL(`http://localhost/api/integrations/utec/callback${search}`);
	const cookies = { get: vi.fn(() => cookieValue), delete: vi.fn() };
	try {
		// Partial event is sufficient for this handler.
		await GET({ url, cookies } as never);
		return null;
	} catch (e) {
		return e as { status: number; location: string };
	}
}

beforeEach(() => {
	vi.clearAllMocks();
	heldPositions = ['staff'];
	requested.length = 0;
});

describe('U-tec OAuth callback', () => {
	it('rejects a mismatched state without exchanging', async () => {
		const redirect = await callGET('?code=abc&state=WRONG', 'RIGHT');

		expect(redirect?.status).toBe(303);
		expect(redirect?.location).toBe('/staff/settings?utec=state_error');
		expect(mockExchange).not.toHaveBeenCalled();
		expect(mockUpdateSiteConfig).not.toHaveBeenCalled();
	});

	it('redirects on a provider error', async () => {
		const redirect = await callGET('?error=access_denied&state=RIGHT', 'RIGHT');

		expect(redirect?.location).toBe('/staff/settings?utec=denied');
		expect(mockExchange).not.toHaveBeenCalled();
	});

	it('exchanges the code and stores the refresh token on success', async () => {
		mockExchange.mockResolvedValue({ refreshToken: 'rt', accessToken: 'at', expiresIn: 3600 });

		const redirect = await callGET('?code=abc&state=RIGHT', 'RIGHT');

		expect(mockExchange).toHaveBeenCalledWith(
			'abc',
			'http://localhost/api/integrations/utec/callback'
		);
		expect(mockUpdateSiteConfig).toHaveBeenCalledWith('integration.utec.refreshToken', 'rt');
		expect(redirect?.location).toBe('/staff/settings?utec=connected');
	});

	it('redirects on an exchange failure', async () => {
		mockExchange.mockRejectedValue(new Error('bad code'));
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		const redirect = await callGET('?code=abc&state=RIGHT', 'RIGHT');

		expect(redirect?.location).toBe('/staff/settings?utec=exchange_failed');
		expect(mockUpdateSiteConfig).not.toHaveBeenCalled();

		consoleSpy.mockRestore();
	});
});

describe('the U-tec connection guard', () => {
	async function callAuthorize() {
		const url = new URL('http://localhost/api/integrations/utec/authorize');
		const cookies = { set: vi.fn() };
		try {
			await AUTHORIZE({ url, cookies } as never);
			return { status: 0, cookies };
		} catch (e) {
			return { status: (e as { status: number }).status, cookies };
		}
	}

	it('names lock.manage on both legs', async () => {
		await callAuthorize();
		await callGET('?code=abc&state=s1', 's1');
		expect(requested).toEqual(['lock.manage', 'lock.manage']);
	});

	it('refuses a treasurer with 403, setting no state and exchanging nothing', async () => {
		heldPositions = ['treasurer'];
		const authorize = await callAuthorize();
		expect(authorize.status).toBe(403);
		expect(authorize.cookies.set).not.toHaveBeenCalled();
		expect((await callGET('?code=abc&state=s1', 's1'))?.status).toBe(403);
		expect(mockExchange).not.toHaveBeenCalled();
		expect(mockUpdateSiteConfig).not.toHaveBeenCalled();
	});

	// Before: any position. After: `lock.manage`, which is admin, staff and the
	// technology coordinator, the same people who manage the lock in settings.
	it('admits exactly the lock.manage holders', async () => {
		for (const held of subsets) {
			heldPositions = held;
			const locksmith = held.some((p) => ['admin', 'staff', 'technology_coordinator'].includes(p));
			const label = held.join('+') || '(none)';
			expect((await callAuthorize()).status === 403, label).toBe(!locksmith);
			expect((await callGET('?code=abc&state=s1', 's1'))?.status === 403, label).toBe(!locksmith);
		}
	});
});
