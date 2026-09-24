import { describe, it, expect, vi, beforeEach } from 'vitest';

// The tips queue (#1566): staff-only, and the listings page carries its count
// so the two can sit side by side without a second query.

let held = new Set<string>();
const requireCapability = vi.fn(async (cap: string) => {
	if (!held.has(cap)) throw new Error(`403: ${cap}`);
	return { id: 'acting-staff' };
});
vi.mock('$lib/server/authorization', () => ({
	requireCapability: (cap: string) => requireCapability(cap)
}));
vi.mock('$lib/server/turnstile', () => ({ verifyTurnstile: vi.fn(async () => true) }));

const TIP = { id: 'lr-9', name: 'Fret Shop', submitterEmail: 'fan@example.com' };
const service = {
	listTips: vi.fn(async () => [TIP]),
	countPendingTips: vi.fn(async () => 4),
	listResourcesForStaff: vi.fn(async () => []),
	listCategories: vi.fn(async () => []),
	LOCAL_RESOURCE_DESCRIPTION_MAX: 1000,
	LOCAL_RESOURCE_FIELD_MAX: 200,
	LOCAL_RESOURCE_NAME_MAX: 120
};
vi.mock('$lib/server/local-resource/local-resource-service', () => service);

vi.mock('$app/server', () => ({
	getRequestEvent: () => ({ locals: {} }),
	query: (...args: unknown[]) => {
		const handler = (typeof args[0] === 'function' ? args[0] : args[1]) as (
			...a: unknown[]
		) => Promise<unknown>;
		const wrapped = (...a: unknown[]) => handler(...a);
		(wrapped as unknown as Record<string, unknown>).__ = { type: 'query' };
		return wrapped;
	},
	form: (_schema: unknown, handler: (data: unknown) => unknown) => {
		const wrapped = (data: unknown) => handler(data);
		(wrapped as unknown as Record<string, unknown>).__ = { type: 'form' };
		return wrapped;
	}
}));

const remote = (await import('./local-resources.remote')) as unknown as Record<
	string,
	(arg?: unknown) => Promise<Record<string, unknown>>
>;

beforeEach(() => {
	vi.clearAllMocks();
	held = new Set();
});

describe('getLocalResourceTips', () => {
	it('refuses a caller without localResource.manage before reading anything', async () => {
		await expect(remote.getLocalResourceTips()).rejects.toThrow('403');
		expect(service.listTips).not.toHaveBeenCalled();
	});

	it('returns the pending tips to a holder', async () => {
		held = new Set(['localResource.manage']);
		await expect(remote.getLocalResourceTips()).resolves.toEqual({ tips: [TIP] });
	});
});

describe('getStaffLocalResources', () => {
	it('carries the pending tip count for the tab beside the listings', async () => {
		held = new Set(['localResource.manage']);
		const out = await remote.getStaffLocalResources({});
		expect(out.tipCount).toBe(4);
	});
});
