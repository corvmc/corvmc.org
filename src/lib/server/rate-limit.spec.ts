import { describe, it, expect, vi, beforeEach } from 'vitest';

const kvStore = new Map<string, string>();

vi.mock('#lib/server/kv.js', () => ({
	getJson: vi.fn(async (key: string) => {
		const raw = kvStore.get(key);
		return raw !== undefined ? JSON.parse(raw) : null;
	}),
	putJson: vi.fn(async (key: string, value: unknown) => {
		kvStore.set(key, JSON.stringify(value));
	})
}));

import { allowRateLimited } from './rate-limit';

beforeEach(() => {
	kvStore.clear();
});

describe('allowRateLimited', () => {
	it('allows hits up to the max, then blocks', async () => {
		expect(await allowRateLimited('k', 3, 3600)).toBe(true);
		expect(await allowRateLimited('k', 3, 3600)).toBe(true);
		expect(await allowRateLimited('k', 3, 3600)).toBe(true);
		expect(await allowRateLimited('k', 3, 3600)).toBe(false);
	});

	it('tracks keys independently', async () => {
		expect(await allowRateLimited('a', 1, 3600)).toBe(true);
		expect(await allowRateLimited('a', 1, 3600)).toBe(false);
		expect(await allowRateLimited('b', 1, 3600)).toBe(true);
	});
});
