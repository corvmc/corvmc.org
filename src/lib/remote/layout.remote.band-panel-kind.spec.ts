import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `getBandLayout` resolved any group by slug, so `/band/{club-slug}` served a
 * club leader the entire band panel — press kit, microsite, subscription and
 * Settings → Delete Act — for a group that by design has no `band_site`.
 */

let group: Record<string, unknown> | null = null;

const getBySlug = vi.fn(async () => group);
const getUserRole = vi.fn(async () => 'owner' as string | null);
vi.mock('$lib/server/band/band-service', () => ({
	getBySlug: () => getBySlug(),
	getUserRole: () => getUserRole(),
	listForUser: vi.fn(async () => [])
}));
vi.mock('$lib/server/band/band-address-service', () => ({
	resolveBandSlug: vi.fn(async () => null)
}));
vi.mock('$lib/server/authorization', () => ({
	capabilitySet: vi.fn(() => ({})),
	isElevated: vi.fn(async () => false),
	positionsFor: vi.fn(async () => [])
}));
vi.mock('$lib/server/inventory/item-service', () => ({
	hasLoanableItems: vi.fn(async () => false)
}));
vi.mock('$lib/server/feature-flags', () => ({ getAllFeatureFlags: vi.fn(async () => ({})) }));
vi.mock('$lib/server/inbox/thread-service', () => ({ getUnresolvedCount: vi.fn(async () => 0) }));
vi.mock('$lib/server/inbox/portal-service', () => ({ countPortalUnread: vi.fn(async () => 0) }));
vi.mock('$lib/server/inbox/band-service', () => ({ countBandUnread: vi.fn(async () => 0) }));
vi.mock('$lib/server/inbox/direct-service', () => ({
	countDirectUnread: vi.fn(async () => 0),
	countPendingRequests: vi.fn(async () => 0)
}));
vi.mock('$lib/server/volunteer/volunteer-signup-service', () => ({
	countVolunteerWorkWaiting: vi.fn(async () => 0)
}));
vi.mock('$lib/server/event/community-event-service', () => ({
	countPendingSubmissions: vi.fn(async () => 0)
}));
vi.mock('$lib/server/suggestion/suggestion-service', () => ({
	countAwaitingModeration: vi.fn(async () => 0),
	countAwaitingResponse: vi.fn(async () => 0),
	countPendingEdits: vi.fn(async () => 0)
}));
vi.mock('$lib/server/storage', () => ({ resolveImageUrl: (v: unknown) => v ?? null }));
vi.mock('$lib/server/sentry', () => ({ captureException: vi.fn() }));

vi.mock('$app/server', () => ({
	getRequestEvent: () => ({
		locals: { user: { id: 'user-1', name: 'Leader', email: 'leader@example.com' } },
		url: new URL('http://localhost/band/real-book-club')
	}),
	query: (...args: unknown[]) => {
		const handler = (typeof args[0] === 'function' ? args[0] : args[1]) as (
			...a: unknown[]
		) => unknown;
		const wrapped = (...a: unknown[]) => Promise.resolve(handler(...a));
		(wrapped as unknown as Record<string, unknown>).__ = { type: 'query' };
		return wrapped;
	}
}));

const layout = (await import('./layout.remote')) as unknown as Record<
	string,
	(...a: unknown[]) => Promise<unknown>
>;

const BAND = { id: 'band-1', kind: 'band', slug: 'the-band', name: 'The Band', avatarKey: null };
const CLUB = {
	id: 'club-1',
	kind: 'club',
	slug: 'real-book-club',
	name: 'Real Book Club',
	avatarKey: null
};

/** Pull the status and location off whatever the guard threw. */
async function thrownBy(fn: () => Promise<unknown>) {
	try {
		await fn();
	} catch (e) {
		const err = e as { status?: number; location?: string };
		return { status: err.status, location: err.location };
	}
	throw new Error('expected a throw');
}

beforeEach(() => {
	vi.clearAllMocks();
	group = BAND;
	getUserRole.mockResolvedValue('owner');
});

describe('getBandLayout', () => {
	it('serves the panel for a band', async () => {
		await expect(layout.getBandLayout('the-band')).resolves.toMatchObject({
			userRole: 'owner'
		});
	});

	/**
	 * A redirect rather than a 404, so a bookmark keeps working and lands where
	 * the controls actually live. Ironically the panel was the only place a club
	 * leader could invite or remove anyone; #712 built the replacement first.
	 */
	it.each([['club'], ['committee']])('redirects a %s to its member page', async (kind) => {
		group = { ...CLUB, kind };

		const { status, location } = await thrownBy(() => layout.getBandLayout(CLUB.slug));
		expect(status).toBe(302);
		expect(location).toBe(`/member/groups/${CLUB.slug}`);
	});

	/**
	 * Before the role check, deliberately. `/band/{club-slug}` is the wrong
	 * address for a program whoever is asking, and a leader who is refused with
	 * 403 learns nothing about where to go.
	 */
	it('redirects a program before asking who the caller is', async () => {
		group = CLUB;
		getUserRole.mockResolvedValue(null);

		const { status } = await thrownBy(() => layout.getBandLayout(CLUB.slug));
		expect(status).toBe(302);
		expect(getUserRole).not.toHaveBeenCalled();
	});
});
