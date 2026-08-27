import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockUser } from '$lib/server/db/test-factory';

/**
 * Guard tests for the band custom-domain remote functions.
 *
 * The domain config includes the TXT tokens a band publishes to prove they own
 * their domain — band-private configuration that only the owner should read.
 * `getCustomDomain` originally required nothing beyond a logged-in user, so any
 * member could read any band's domain setup by passing its slug.
 */

const mockBand = {
	id: 'band-1',
	name: 'The Velvet Underground',
	slug: 'the-velvet-underground',
	ownerId: 'user-owner',
	tier: 'premium' as string,
	customDomain: 'velvet.example.com',
	customDomainStatus: 'pending' as string | null,
	customDomainHostnameId: 'hostname-1',
	customDomainVerification: {
		ownership: { name: '_cf-custom-hostname.velvet.example.com', value: 'secret-token' },
		ssl: { name: '_acme-challenge.velvet.example.com', value: 'ssl-token' },
		cnameTarget: 'domains.corvmc.org'
	},
	memberCount: 3,
	createdAt: new Date(),
	updatedAt: new Date()
};

const bandServiceMock = {
	getBySlug: vi.fn(async () => mockBand),
	getUserRole: vi.fn(async () => 'owner' as string | null)
};
vi.mock('$lib/server/band/band-service', () => bandServiceMock);

const testUser = mockUser({ id: 'user-owner', name: 'Test Owner' });
vi.mock('$lib/server/authorization', () => ({ requireUser: () => testUser }));
vi.mock('$lib/server/feature-flags', () => ({ requireFeature: vi.fn(async () => undefined) }));
vi.mock('$lib/server/db', () => ({ db: {} }));
vi.mock('$lib/server/db/schema/band', () => ({ band: {} }));
vi.mock('$lib/server/band/band-host-service', () => ({ forgetCustomDomain: vi.fn() }));
vi.mock('$lib/server/band/custom-domain-service', () => ({
	CustomDomainError: class extends Error {},
	assertDomainUnclaimed: vi.fn(),
	cnameTarget: () => 'domains.corvmc.org',
	createCustomHostname: vi.fn(),
	deleteCustomHostname: vi.fn(),
	isCustomDomainConfigured: () => true,
	normalizeCustomDomain: (s: string) => s,
	readCustomHostname: vi.fn()
}));

vi.mock('$app/server', () => ({
	getRequestEvent: () => ({
		locals: { user: testUser },
		params: { slug: 'the-velvet-underground' },
		request: { headers: new Headers() }
	}),
	// SvelteKit validates that every export of a .remote.ts file is a remote
	// function, so the stubs have to carry the same marker the real ones do.
	form: (_schema: unknown, handler: (...args: any[]) => any) => {
		(handler as any).__ = { type: 'form' };
		(handler as any).for = () => handler;
		return handler;
	},
	query: (...args: unknown[]) => {
		const handler = (typeof args[0] === 'function' ? args[0] : args[1]) as any;
		handler.__ = { type: 'query' };
		return handler;
	}
}));

beforeEach(() => {
	vi.clearAllMocks();
	bandServiceMock.getBySlug.mockResolvedValue(mockBand);
	bandServiceMock.getUserRole.mockResolvedValue('owner');
});

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------

// The import stays dynamic so it resolves after the `vi.mock` calls above, and
// sits at module scope so the cold Vite transform of the whole module graph is
// paid once, during file evaluation — not inside a test or hook, where it would
// race the 5s test / 10s hook timeout on a cold `node_modules/.vite`.
const { getCustomDomain } = await import('./band-custom-domain.remote');

describe('getCustomDomain', () => {
	it('returns the domain config to the band owner', async () => {
		const result = await (getCustomDomain as unknown as (slug: string) => Promise<unknown>)(
			'the-velvet-underground'
		);
		expect(result).toMatchObject({ domain: 'velvet.example.com', status: 'pending' });
	});

	it('rejects a member who does not own the band', async () => {
		bandServiceMock.getUserRole.mockResolvedValue('member');
		await expect(
			(getCustomDomain as unknown as (slug: string) => Promise<unknown>)('the-velvet-underground')
		).rejects.toMatchObject({ status: 403 });
	});

	it('rejects a logged-in user with no role in the band', async () => {
		bandServiceMock.getUserRole.mockResolvedValue(null);
		await expect(
			(getCustomDomain as unknown as (slug: string) => Promise<unknown>)('the-velvet-underground')
		).rejects.toMatchObject({ status: 403 });
	});
});
