import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A committee seat that grants a staff module org-wide (#1578, #1602) has to
 * open the staff panel on its own. Otherwise a member holding no position has
 * the guard's consent and no page to use it on.
 */

const positionsFor = vi.fn(async (_id: string) => [] as string[]);
const committeeCapabilitiesFor = vi.fn(async (_id: string) => [] as string[]);

vi.mock('$lib/server/band/band-service', () => ({
	getBySlug: vi.fn(async () => null),
	getUserRole: vi.fn(async () => null),
	listForUser: vi.fn(async () => [])
}));
vi.mock('$lib/server/band/band-address-service', () => ({
	resolveBandSlug: vi.fn(async () => null)
}));
vi.mock('$lib/server/authorization', () => ({
	capabilitySet: (held: string[]) => (held.includes('treasurer') ? ['sponsor.read'] : []),
	isElevated: vi.fn(async () => false),
	positionsFor: (id: string) => positionsFor(id),
	committeeCapabilitiesFor: (id: string) => committeeCapabilitiesFor(id)
}));
vi.mock('$lib/server/inventory/item-service', () => ({
	hasLoanableItems: vi.fn(async () => false)
}));
vi.mock('$lib/server/feature-flags', () => ({ getAllFeatureFlags: vi.fn(async () => ({})) }));
vi.mock('$lib/server/inbox/thread-service', () => ({ getUnresolvedCount: vi.fn(async () => 0) }));
vi.mock('$lib/server/inbox/band-service', () => ({ countBandUnread: vi.fn(async () => 0) }));
vi.mock('$lib/server/inbox/group-chat-service', () => ({
	countGroupChatUnread: vi.fn(async () => 0)
}));
vi.mock('$lib/server/inbox/unified-service', () => ({
	countUnifiedUnread: vi.fn(async () => 0),
	countUnifiedUnreadFor: vi.fn(async () => 0)
}));
vi.mock('$lib/server/inbox/direct-service', () => ({
	countPendingRequests: vi.fn(async () => 0)
}));
vi.mock('$lib/server/volunteer/volunteer-signup-service', () => ({
	countVolunteerWorkWaiting: vi.fn(async () => 0)
}));
vi.mock('$lib/server/event/community-event-service', () => ({
	countPendingSubmissions: vi.fn(async () => 0)
}));
vi.mock('$lib/server/local-resource/local-resource-service', () => ({
	countPendingTips: vi.fn(async () => 0)
}));
vi.mock('$lib/server/suggestion/suggestion-service', () => ({
	countAwaitingModeration: vi.fn(async () => 0),
	countAwaitingResponse: vi.fn(async () => 0),
	countPendingEdits: vi.fn(async () => 0)
}));
vi.mock('$lib/server/moderation/appeal-service', () => ({
	countPendingAppeals: vi.fn(async () => 0)
}));
vi.mock('$lib/server/moderation/moderation-service', () => ({
	acceptsDirectMessages: vi.fn(async () => true)
}));
vi.mock('$lib/server/notification/in-app-service', () => ({
	getForUser: vi.fn(async () => []),
	getUnreadCount: vi.fn(async () => 0)
}));
vi.mock('$lib/server/storage', () => ({ resolveImageUrl: (v: unknown) => v ?? null }));
vi.mock('$lib/server/sentry', () => ({ captureException: vi.fn() }));

vi.mock('$app/server', () => ({
	getRequestEvent: () => ({
		locals: { user: { id: 'user-1', name: 'Dev', email: 'dev@example.com' } },
		url: new URL('http://localhost/staff/sponsors')
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
	() => Promise<Record<string, unknown>>
>;

const SEAT = ['sponsor.read', 'sponsor.manage', 'grant.read', 'grant.manage'];

beforeEach(() => {
	vi.clearAllMocks();
	positionsFor.mockResolvedValue([]);
	committeeCapabilitiesFor.mockResolvedValue([]);
});

describe('getStaffLayout', () => {
	it('opens the panel to a committee member holding no position', async () => {
		committeeCapabilitiesFor.mockResolvedValue(SEAT);
		const out = await layout.getStaffLayout();
		expect(out.capabilities).toEqual(expect.arrayContaining(SEAT));
	});

	it('still turns away someone with neither a position nor a seat', async () => {
		await expect(layout.getStaffLayout()).rejects.toMatchObject({ status: 302, location: '/' });
	});

	it("adds the seat's capabilities to a position's without duplicating them", async () => {
		positionsFor.mockResolvedValue(['treasurer']);
		committeeCapabilitiesFor.mockResolvedValue(SEAT);
		const caps = (await layout.getStaffLayout()).capabilities as string[];
		expect(caps.filter((c) => c === 'sponsor.read')).toHaveLength(1);
		expect(caps).toEqual(expect.arrayContaining(SEAT));
	});
});

describe('getMemberLayout', () => {
	it('offers the Staff panel tab to a seat that grants a staff module', async () => {
		committeeCapabilitiesFor.mockResolvedValue(SEAT);
		const out = await layout.getMemberLayout();
		expect(out.isStaff).toBe(true);
		expect(out.capabilities).toEqual(expect.arrayContaining(SEAT));
	});

	it('offers nothing to a member with neither', async () => {
		const out = await layout.getMemberLayout();
		expect(out.isStaff).toBe(false);
	});
});
