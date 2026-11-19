import { describe, it, expect, vi } from 'vitest';
import { Query } from 'kit-remote-query';
import { QUERY_REDIRECTED } from 'kit-remote-shared';

/**
 * Every remote query whose server answer is a `redirect()` (an access gate,
 * `requireUser`) gets no value: kit follows the redirect, and its fetchers
 * (`query()`, `query.batch`) resolve with `QUERY_REDIRECTED`. The cached query
 * must not then count as loaded, or the next page to await it reads `undefined`
 * without asking the server again (#3276).
 */
describe('a remote query answered with a redirect', () => {
	it('fetches again on the next await instead of resolving undefined', async () => {
		let calls = 0;
		const query: Query<{ owed: number }> = new Query<{ owed: number }>('getPage/', async () => {
			calls++;
			if (calls === 1) return QUERY_REDIRECTED;
			// A real value arrives through `set()`, from the response's `data.q`.
			query.set({ owed: 2 });
		});

		// The first visit: the server redirects.
		void query.then(() => {});
		await vi.waitFor(() => expect(calls).toBe(1));
		await vi.waitFor(() => expect(query.loading).toBe(false));

		// The member comes back to the page while the entry is still cached.
		await expect(Promise.resolve(query)).resolves.toEqual({ owed: 2 });
		expect(calls).toBe(2);
	});
});
