import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockUser } from '$lib/server/db/test-factory';

/**
 * Who may move a band's public address, and — the part worth pinning down — that
 * the band being moved always comes from the owner guard rather than from
 * anything the client submitted.
 */

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockBand = {
	id: 'band-1',
	name: 'The Velvet Underground',
	slug: 'the-velvet-underground',
	bio: 'NYC band',
	ownerId: 'user-owner',
	avatarKey: null,
	memberCount: 3,
	createdAt: new Date(),
	updatedAt: new Date()
};

const bandServiceMock = {
	getBySlug: vi.fn(async () => mockBand),
	getUserRole: vi.fn(async () => 'owner' as string | null)
};

vi.mock('$lib/server/band/band-service', () => bandServiceMock);

const { changeBandSlug, allowRateLimited, SlugUnavailableError } = vi.hoisted(() => ({
	changeBandSlug: vi.fn(async (_bandId: string, slug: string) => ({
		status: 'changed' as const,
		slug,
		previousSlug: 'the-velvet-underground'
	})),
	allowRateLimited: vi.fn(async () => true),
	SlugUnavailableError: class SlugUnavailableError extends Error {}
}));

// The address service's own rules are covered in band-address-service.spec.ts;
// here only normalization matters, so it stays real in spirit but cheap.
vi.mock('$lib/server/band/band-address-service', () => ({
	MAX_BAND_SLUG_LENGTH: 63,
	SlugUnavailableError,
	normalizeBandSlug: (input: string) =>
		input
			.toLowerCase()
			.replace(/[^a-z0-9-]+/g, '')
			.replace(/-{2,}/g, '-')
			.replace(/^-|-$/g, ''),
	assertValidBandSlug: (slug: string) => {
		if (!slug) throw new SlugUnavailableError('Use at least one letter or number.');
	},
	changeBandSlug
}));

vi.mock('$lib/server/rate-limit', () => ({ allowRateLimited }));

const testUser = mockUser({ id: 'user-owner', name: 'Test Owner' });

vi.mock('$lib/server/authorization', () => ({
	requireUser: () => testUser
}));

vi.mock('$app/server', () => ({
	getRequestEvent: () => ({
		locals: { user: testUser },
		request: { headers: new Headers() }
	}),
	form: (_schema: unknown, handler: (...args: any[]) => any) => {
		const fn = handler;
		(fn as any).__ = { type: 'form' };
		(fn as any).for = () => fn;
		return fn;
	}
}));

/** Stands in for SvelteKit's `issue` builder — inert; only `invalid()` throws. */
const issue = new Proxy(
	{},
	{ get: (_, field) => (message: string) => ({ path: [field], message }) }
) as any;

// Module scope, not inside each `it`: a cold Vite cache would otherwise pay the
// transform of this module graph inside the 5s test timeout and report it as a
// timeout. Same reason as commit 75fd70a.
const { changeBandAddress } = (await import('$lib/remote/band-address.remote')) as any;

beforeEach(() => {
	vi.clearAllMocks();
	bandServiceMock.getUserRole.mockResolvedValue('owner');
	allowRateLimited.mockResolvedValue(true);
});

// ---------------------------------------------------------------------------
// changeBandAddress
// ---------------------------------------------------------------------------

describe('changeBandAddress', () => {
	it('moves the band to the requested address', async () => {
		const result = await changeBandAddress(
			{ slug: 'the-velvet-underground', newSlug: 'The Velvets' },
			issue
		);

		// Spaces collapse rather than hyphenating.
		expect(changeBandSlug).toHaveBeenCalledWith('band-1', 'thevelvets');
		expect(result).toEqual({ success: true, slug: 'thevelvets', changed: true });
	});

	it('resolves the band from `slug`, never from `newSlug`', async () => {
		// Both are submitted values now, which is exactly why they must not be
		// confused. `slug` is the ref the guard authorizes on; `newSlug` names a
		// different band on purpose — treated as a lookup key it would let an
		// owner authorize a move against somebody else's band.
		await changeBandAddress({ slug: 'the-velvet-underground', newSlug: 'some-other-band' }, issue);

		expect(changeBandSlug).toHaveBeenCalledWith('band-1', 'some-other-band');
		expect(bandServiceMock.getBySlug).toHaveBeenCalledWith('the-velvet-underground');
	});

	it('rejects admins', async () => {
		bandServiceMock.getUserRole.mockResolvedValue('admin');

		await expect(
			changeBandAddress({ slug: 'the-velvet-underground', newSlug: 'the-velvets' }, issue)
		).rejects.toThrow();
		expect(changeBandSlug).not.toHaveBeenCalled();
	});

	it('rejects members', async () => {
		bandServiceMock.getUserRole.mockResolvedValue('member');

		await expect(
			changeBandAddress({ slug: 'the-velvet-underground', newSlug: 'the-velvets' }, issue)
		).rejects.toThrow();
		expect(changeBandSlug).not.toHaveBeenCalled();
	});

	it('treats the current address as a no-op without spending a change', async () => {
		const result = await changeBandAddress(
			{ slug: 'the-velvet-underground', newSlug: 'The-Velvet-Underground' },
			issue
		);

		expect(result).toEqual({ success: true, slug: 'the-velvet-underground', changed: false });
		expect(allowRateLimited).not.toHaveBeenCalled();
		expect(changeBandSlug).not.toHaveBeenCalled();
	});

	it('stops once the band has used up its recent changes', async () => {
		allowRateLimited.mockResolvedValue(false);

		await expect(
			changeBandAddress({ slug: 'the-velvet-underground', newSlug: 'the-velvets' }, issue)
		).rejects.toThrow();
		expect(allowRateLimited).toHaveBeenCalledWith('band-slug:band-1', 3, 60 * 60 * 24 * 30);
		expect(changeBandSlug).not.toHaveBeenCalled();
	});

	it('surfaces an unavailable address instead of letting it escape as a 500', async () => {
		changeBandSlug.mockRejectedValueOnce(
			new SlugUnavailableError('That address is already taken.')
		);

		await expect(
			changeBandAddress({ slug: 'the-velvet-underground', newSlug: 'the-velvets' }, issue)
		).rejects.toThrow();
	});
});
