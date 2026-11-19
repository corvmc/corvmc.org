import { describe, it, expect, vi } from 'vitest';

// Kit's client runtime pulls in the router; the Query only needs these two.
vi.mock('../node_modules/@sveltejs/kit/src/runtime/client/client.js', () => ({
	query_responses: {},
	handle_error: async (e: unknown) => ({ message: String(e) })
}));

import { Query } from '../node_modules/@sveltejs/kit/src/runtime/client/remote-functions/query/instance.svelte.js';

/**
 * Every remote query whose server answer is a `redirect()` (an access gate,
 * `requireUser`) gets no value: kit follows the redirect and the fetch resolves
 * empty. The cached query must not then count as loaded, or the next page to
 * await it reads `undefined` without asking the server again (#3276).
 */
describe('a remote query answered with a redirect', () => {
	it('fetches again on the next await instead of resolving undefined', async () => {
		let calls = 0;
		const query: Query<{ owed: number }> = new Query('page', async () => {
			calls++;
			// A real value arrives through `set()`, from the response's `data.q`.
			if (calls > 1) query.set({ owed: 2 });
		});

		// The first visit: the server redirects, so nothing is set.
		void query.then(() => {});
		await vi.waitFor(() => expect(query.loading).toBe(false));

		// The member comes back to the page while the entry is still cached.
		await expect(Promise.resolve(query)).resolves.toEqual({ owed: 2 });
		expect(calls).toBe(2);
	});
});
