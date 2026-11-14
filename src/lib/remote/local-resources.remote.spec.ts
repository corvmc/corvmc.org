import { describe, it, expect, vi, beforeEach } from 'vitest';

// The tips queue (#1566): staff-only, and the listings page carries its count
// so the two can sit side by side without a second query.

let held = new Set<string>();
const requireCapability = vi.fn(async (cap: string) => {
	if (!held.has(cap)) throw new Error(`403: ${cap}`);
	return { id: 'acting-staff' };
});
vi.mock('#lib/server/authorization.js', () => ({
	requireCapability: (cap: string) => requireCapability(cap)
}));
vi.mock('#lib/server/turnstile.js', () => ({ verifyTurnstile: vi.fn(async () => true) }));

const service = {
	countPendingTips: vi.fn(async () => 4),
	listResourcesForStaff: vi.fn(async () => []),
	listCategories: vi.fn(async () => []),
	LOCAL_RESOURCE_DESCRIPTION_MAX: 1000,
	LOCAL_RESOURCE_FIELD_MAX: 200,
	LOCAL_RESOURCE_NAME_MAX: 120
};
vi.mock('#lib/server/local-resource/local-resource-service.js', () => service);

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

describe('getStaffLocalResources', () => {
	it('carries the pending tip count for the status filter', async () => {
		held = new Set(['localResource.manage']);
		const out = await remote.getStaffLocalResources({});
		expect(out.tipCount).toBe(4);
	});
});
