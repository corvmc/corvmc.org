import { describe, it, expect, vi, beforeEach } from 'vitest';

// Regression: the staff settings remote functions are directly addressable
// endpoints (there is no +layout.server.ts backstop), and several of them —
// including getIntegrationSettings, which returns the U-tec door-lock OAuth
// client secret and refresh token — shipped without a requireStaff() guard.
// These tests pin that every staff-only query/form/command in settings.remote
// rejects before touching config or Stripe/lock services when the caller is
// not staff, and that the two genuinely public queries stay public.

const requireStaff = vi.fn<() => Promise<unknown>>(async () => {
	throw new Error('403: Staff access required');
});
vi.mock('$lib/server/authorization', () => ({
	requireStaff: (...args: unknown[]) => requireStaff(...(args as []))
}));

const getConfigsByPrefix = vi.fn(async (prefix: string) => {
	if (prefix === 'integration.utec') {
		return {
			clientId: 'utec-client',
			clientSecret: 'utec-secret',
			deviceId: 'device-1',
			refreshToken: 'utec-refresh'
		};
	}
	return { socialFacebook: 'fb', addressStreet: '123 Main St' };
});
const updateSiteConfigs = vi.fn(async () => undefined);
const updateSiteConfig = vi.fn(async () => undefined);
vi.mock('$lib/server/site-config/site-config-service', () => ({
	getConfigsByPrefix: (...args: unknown[]) => getConfigsByPrefix(...(args as [string])),
	updateSiteConfigs: (...args: unknown[]) => updateSiteConfigs(...(args as [])),
	updateSiteConfig: (...args: unknown[]) => updateSiteConfig(...(args as []))
}));

const getAllProductConfigs = vi.fn(async () => []);
const updateProductConfig = vi.fn(async () => undefined);
vi.mock('$lib/server/finance/product-config-service', () => ({
	getAllProductConfigs: () => getAllProductConfigs(),
	updateProductConfig: (...args: unknown[]) => updateProductConfig(...(args as []))
}));

const testConnection = vi.fn(async () => ({ ok: true }));
vi.mock('$lib/server/lock/ultraloc-client', () => ({
	testConnection: () => testConnection()
}));

vi.mock('$lib/server/lock/lock-service', () => ({
	issueLockSelfTest: vi.fn(async () => ({ code: '1234' })),
	revokeLockSelfTest: vi.fn(async () => undefined)
}));

// `ALL_FLAGS` is the real list on purpose: `VALID_FLAGS` in settings.remote is
// an alias of it, so mocking it out would stop this suite from catching a flag
// that the settings page can toggle but the handler rejects.
vi.mock('$lib/server/feature-flags', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/feature-flags')>()),
	getAllFeatureFlags: vi.fn(async () => ({}))
}));

vi.mock('$lib/server/finance/subscription-sync-service', () => ({
	syncAllSubscriptions: vi.fn(async () => ({ synced: 0 }))
}));

vi.mock('$lib/server/finance/community-stats', () => ({
	refreshCommunityStats: vi.fn(async () => undefined)
}));

vi.mock('$app/server', () => ({
	getRequestEvent: () => ({
		locals: { user: null },
		url: new URL('http://localhost/'),
		request: { headers: new Headers() }
	}),
	query: (...args: unknown[]) => {
		const handler = (typeof args[0] === 'function' ? args[0] : args[1]) as (
			...a: unknown[]
		) => unknown;
		(handler as unknown as Record<string, unknown>).__ = { type: 'query' };
		return handler;
	},
	form: (_schema: unknown, handler: (...a: unknown[]) => unknown) => {
		const fn = handler as unknown as Record<string, unknown>;
		fn.__ = { type: 'form' };
		fn.for = () => fn;
		return handler;
	},
	command: (handler: (...a: unknown[]) => unknown) => {
		(handler as unknown as Record<string, unknown>).__ = { type: 'command' };
		return handler;
	}
}));

const settings = (await import('./settings.remote')) as unknown as Record<
	string,
	((...args: unknown[]) => Promise<unknown>) & { refresh?: () => void }
>;

beforeEach(() => {
	vi.clearAllMocks();
	requireStaff.mockRejectedValue(new Error('403: Staff access required'));
	// query results carry a .refresh() used by the forms after a successful write
	for (const fn of Object.values(settings)) {
		if (typeof fn === 'function') fn.refresh = () => undefined;
	}
});

const STAFF_ONLY: Array<{ name: string; args?: unknown[] }> = [
	{ name: 'getProducts' },
	{ name: 'getReservationSettings' },
	{ name: 'getOrgSettings' },
	{ name: 'getVolunteerValueSettings' },
	{ name: 'getVenueSettings' },
	{ name: 'getIntegrationSettings' },
	{ name: 'getStaffSettingsPage' },
	{ name: 'testUtecConnection' },
	{ name: 'runLockSelfTest' },
	{ name: 'revokeLockTest' },
	{ name: 'getFeatureFlags' },
	{ name: 'syncSubscriptions' },
	{ name: 'refreshCommunityStats' },
	{
		name: 'updateProduct',
		args: [{ key: 'contribution', name: 'x', description: '', unitAmountCents: '100' }]
	},
	{
		name: 'updateReservationSettings',
		args: [
			{
				operatingHoursStart: '09:00',
				operatingHoursEnd: '22:00',
				timeSlotMinutes: 30,
				minDurationHours: 1,
				maxDurationHours: 8,
				bufferMinutes: 0,
				minAdvanceMinutes: 0,
				maxAdvanceDaysOneoff: 14,
				maxAdvanceDaysRecurring: 17.5,
				hourlyRateCents: 1500
			}
		]
	},
	{
		name: 'updateOrgSettings',
		args: [{ name: 'CMC', shortName: 'CMC', contactEmail: 'a@b.co', timezone: 'UTC' }]
	},
	// Guarded all along, but unlisted here until the completeness check below
	// went looking — so the form that flips any feature flag had no test
	// pinning that it rejects a non-staff caller.
	{ name: 'updateFeatureFlag', args: [{ flag: 'directMessages', enabled: true }] },
	{
		name: 'updateVolunteerValueSettings',
		args: [{ hourValueCents: 3766, hourValueSource: 'Independent Sector, Oregon, 2025' }]
	},
	{ name: 'updateVenueSettings', args: [{ consoleChannels: 16 }] },
	{
		name: 'updateIntegrationSettings',
		args: [{ clientId: '', clientSecret: '', deviceId: '', refreshToken: '' }]
	}
];

/**
 * The three deliberately public queries. Everything the footer and `/contact`
 * render for a logged-out visitor, and nothing else.
 */
const PUBLIC = ['getSocialLinks', 'getOrgAddress', 'getFooterInfo'];

describe('settings.remote staff guards', () => {
	for (const { name, args = [] } of STAFF_ONLY) {
		it(`${name} rejects non-staff callers before doing any work`, async () => {
			await expect(settings[name](...args)).rejects.toThrow('Staff access required');
			// Nothing sensitive was read or written on the failed call.
			expect(getConfigsByPrefix).not.toHaveBeenCalled();
			expect(updateSiteConfigs).not.toHaveBeenCalled();
			expect(updateProductConfig).not.toHaveBeenCalled();
			expect(testConnection).not.toHaveBeenCalled();
		});
	}

	it('getIntegrationSettings returns lock credentials only once staff', async () => {
		requireStaff.mockResolvedValue(undefined);
		const result = await settings.getIntegrationSettings();
		expect(requireStaff).toHaveBeenCalled();
		expect(result).toEqual({
			clientId: 'utec-client',
			clientSecret: 'utec-secret',
			deviceId: 'device-1',
			refreshToken: 'utec-refresh'
		});
	});

	it('the footer and contact queries remain public (rendered for logged-out visitors)', async () => {
		await settings.getSocialLinks();
		await settings.getOrgAddress();
		await settings.getFooterInfo();
		expect(requireStaff).not.toHaveBeenCalled();
	});

	it('getFooterInfo reads the org config once and shapes both halves', async () => {
		expect(await settings.getFooterInfo()).toEqual({
			social: await settings.getSocialLinks(),
			address: await settings.getOrgAddress()
		});
	});

	it('no arbitrary-key config reader is exported (it could read integration secrets)', () => {
		expect(settings.config).toBeUndefined();
	});

	// `STAFF_ONLY` above is hand-maintained, and a hand-maintained list of things
	// that need a guard is the drift that let `getIntegrationSettings` ship
	// without one in the first place. This closes it: a new export is either
	// covered by the loop above or named public on purpose, and adding one
	// without deciding which turns this red.
	it('every exported remote function is either guarded above or deliberately public', () => {
		const covered = new Set([...STAFF_ONLY.map((entry) => entry.name), ...PUBLIC]);

		const remotes = Object.entries(settings)
			.filter(([, fn]) => typeof fn === 'function' && '__' in fn)
			.map(([name]) => name);

		expect(remotes.length).toBeGreaterThan(0);
		expect(remotes.filter((name) => !covered.has(name))).toEqual([]);
	});
});
