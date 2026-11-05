import { beforeEach, describe, it, expect, vi } from 'vitest';

import { resolveBandSlug } from '#lib/server/band/band-address-service.js';

/**
 * A signed-out request for a panel layout is the sign-in interrupt (#1999):
 * the redirect carries the page it came from, so signing in lands back there.
 * Kit 3 throws on `event.url` inside a query, so the mock does too, and the
 * page arrives as the gate's argument.
 */

vi.mock('#lib/server/band/band-service.js', () => ({
	getBySlug: vi.fn(async () => null),
	getUserRole: vi.fn(async () => null),
	listForUser: vi.fn(async () => [])
}));
vi.mock('#lib/server/band/band-address-service.js', () => ({
	resolveBandSlug: vi.fn(async () => null)
}));
vi.mock('#lib/server/authorization.js', () => ({
	capabilitySet: () => [],
	isElevated: vi.fn(async () => false),
	positionsFor: vi.fn(async () => []),
	committeeCapabilitiesFor: vi.fn(async () => [])
}));
vi.mock('#lib/server/inventory/item-service.js', () => ({
	hasLoanableItems: vi.fn(async () => false)
}));
vi.mock('#lib/server/feature-flags.js', () => ({ getAllFeatureFlags: vi.fn(async () => ({})) }));
vi.mock('#lib/server/inbox/unified-service.js', () => ({
	countUnifiedUnread: vi.fn(async () => 0),
	countUnifiedUnreadFor: vi.fn(async () => 0)
}));
vi.mock('#lib/server/inbox/direct-service.js', () => ({
	countPendingRequests: vi.fn(async () => 0)
}));
vi.mock('#lib/server/moderation/moderation-service.js', () => ({
	acceptsDirectMessages: vi.fn(async () => true)
}));
vi.mock('#lib/server/notification/in-app-service.js', () => ({
	getForUser: vi.fn(async () => []),
	getUnreadCount: vi.fn(async () => 0)
}));
vi.mock('#lib/server/user/staff-queue-counts.js', () => ({
	countStaffQueues: vi.fn(async () => ({}))
}));
vi.mock('#lib/server/storage.js', () => ({ resolveImageUrl: (v: unknown) => v ?? null }));
vi.mock('#lib/server/sentry.js', () => ({ captureException: vi.fn() }));

let currentUser: { id: string; name: string; email: string } | null = null;

vi.mock('$app/server', () => ({
	getRequestEvent: () => ({
		locals: { user: currentUser },
		get url(): URL {
			throw new Error('event.url inside a query');
		}
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

const PAGE = '/member/bands?tab=mine';
const BACK = `/login?redirect=${encodeURIComponent(PAGE)}`;

describe('panel layout gates, signed out', () => {
	beforeEach(() => (currentUser = null));

	it.each([
		['requireLayoutSession', [PAGE]],
		['requireBandLayoutSession', [{ slug: 'some-band', path: PAGE }]]
	])('%s redirects to sign-in, returning to the page it was given', async (name, args) => {
		await expect(layout[name](...args)).rejects.toMatchObject({ status: 302, location: BACK });
	});

	it('drops a return path that leaves the site', async () => {
		await expect(layout.requireLayoutSession('//evil.example/x')).rejects.toMatchObject({
			status: 302,
			location: '/login'
		});
	});
});

describe('panel layout data, signed out', () => {
	beforeEach(() => (currentUser = null));

	it.each([
		['getMemberLayout', []],
		['getStaffLayout', []],
		['getBandLayout', ['some-band']]
	])('%s still refuses, without reading the page', async (name, args) => {
		await expect(layout[name](...args)).rejects.toMatchObject({ status: 302, location: '/login' });
	});
});

describe('band layout gate, renamed band', () => {
	beforeEach(() => {
		currentUser = { id: 'user-1', name: 'Member', email: 'member@example.com' };
		vi.mocked(resolveBandSlug).mockResolvedValue({ kind: 'moved', slug: 'new-name' });
	});

	it('keeps the subpage and query when forwarding an old address', async () => {
		await expect(
			layout.requireBandLayoutSession({ slug: 'old-name', path: '/band/old-name/events?view=past' })
		).rejects.toMatchObject({ status: 302, location: '/band/new-name/events?view=past' });
	});

	it('forwards to the dashboard when the path is not under the old address', async () => {
		await expect(
			layout.requireBandLayoutSession({ slug: 'old-name', path: '/band/old-name-x//evil.example' })
		).rejects.toMatchObject({ status: 302, location: '/band/new-name' });
	});
});
