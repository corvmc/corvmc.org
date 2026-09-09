import { describe, it, expect, vi, beforeEach } from 'vitest';

let selectResult: unknown[] = [];

function chainable() {
	const proxy: any = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') return (resolve: (v: unknown[]) => void) => resolve(selectResult);
			return () => proxy;
		}
	});
	return proxy;
}

vi.mock('$lib/server/db', () => ({ db: { select: () => chainable() } }));

const { isDeliverable } = await import('./recipient');

beforeEach(() => {
	selectResult = [];
});

describe('isDeliverable', () => {
	it('accepts a live account', async () => {
		selectResult = [{ deletedAt: null }];
		expect(await isDeliverable('u1')).toBe(true);
	});

	it('refuses a removed account', async () => {
		selectResult = [{ deletedAt: new Date('2026-09-01T00:00:00Z') }];
		expect(await isDeliverable('u1')).toBe(false);
	});

	// A purged user is more gone than a soft-deleted one, not less.
	it('refuses an account that is not there at all', async () => {
		selectResult = [];
		expect(await isDeliverable('u1')).toBe(false);
	});
});
