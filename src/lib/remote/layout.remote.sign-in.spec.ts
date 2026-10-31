import { describe, it, expect, vi } from 'vitest';

/**
 * A signed-out request for a panel layout is the sign-in interrupt (#1999):
 * the redirect carries the page it came from, so signing in lands back there.
 * A remote's `url` is the calling page's, from Kit's pathname/search headers.
 */

vi.mock('$lib/server/band/band-service', () => ({
	getBySlug: vi.fn(async () => null),
	getUserRole: vi.fn(async () => null),
	listForUser: vi.fn(async () => [])
}));
vi.mock('$lib/server/band/band-address-service', () => ({
	resolveBandSlug: vi.fn(async () => null)
}));
vi.mock('$lib/server/authorization', () => ({
	capabilitySet: () => [],
	isElevated: vi.fn(async () => false),
	positionsFor: vi.fn(async () => []),
	committeeCapabilitiesFor: vi.fn(async () => [])
}));
vi.mock('$lib/server/inventory/item-service', () => ({
	hasLoanableItems: vi.fn(async () => false)
}));
vi.mock('$lib/server/feature-flags', () => ({ getAllFeatureFlags: vi.fn(async () => ({})) }));
vi.mock('$lib/server/inbox/unified-service', () => ({
	countUnifiedUnread: vi.fn(async () => 0),
	countUnifiedUnreadFor: vi.fn(async () => 0)
}));
vi.mock('$lib/server/inbox/direct-service', () => ({
	countPendingRequests: vi.fn(async () => 0)
}));
vi.mock('$lib/server/moderation/moderation-service', () => ({
	acceptsDirectMessages: vi.fn(async () => true)
}));
vi.mock('$lib/server/notification/in-app-service', () => ({
	getForUser: vi.fn(async () => []),
	getUnreadCount: vi.fn(async () => 0)
}));
vi.mock('$lib/server/user/staff-queue-counts', () => ({
	countStaffQueues: vi.fn(async () => ({}))
}));
vi.mock('$lib/server/storage', () => ({ resolveImageUrl: (v: unknown) => v ?? null }));
vi.mock('$lib/server/sentry', () => ({ captureException: vi.fn() }));

vi.mock('$app/server', () => ({
	getRequestEvent: () => ({
		locals: { user: null },
		url: new URL('http://localhost/member/bands?tab=mine')
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

const BACK = `/login?redirect=${encodeURIComponent('/member/bands?tab=mine')}`;

describe('panel layouts, signed out', () => {
	it.each([
		['getMemberLayout', []],
		['getStaffLayout', []],
		['getBandLayout', ['some-band']]
	])('%s redirects to sign-in, returning to this page', async (name, args) => {
		await expect(layout[name](...args)).rejects.toMatchObject({ status: 302, location: BACK });
	});
});
