import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';

/**
 * JAVASCRIPT-SVELTEKIT-2C: `/contact` threw `TypeError: Cannot redefine property: value`
 * on every server render, for 10 users over two days, after #207 added
 * `bind:value` next to an existing `{...fields.subject.as('select')}` spread.
 *
 * The collision is server-only. SvelteKit's `.as('select')` defines `value` via
 * `Object.defineProperties` without `configurable`, so it is a NON-CONFIGURABLE
 * accessor; Svelte's *server* `spread_props` copies descriptors with
 * `Object.defineProperty`, so a second `value` source on the same component
 * throws. The *client* `spread_props` is a Proxy that forces
 * `configurable: true`, which is why the page worked in dev and in every
 * client-side test while failing in production.
 *
 * The mock below therefore reproduces the non-configurable accessor exactly —
 * a plain `{ value }` data property would not catch a regression.
 */

/** Mirrors @sveltejs/kit's `form-utils.js` field descriptors. */
function makeField(name: string) {
	return {
		as: (type: string) => {
			const base: Record<string, unknown> = { name, type };
			if (type === 'select') {
				return Object.defineProperties(base, {
					multiple: { value: false, enumerable: true },
					// No `configurable: true` — matches Kit, and is the whole point.
					value: { enumerable: true, get: () => '' }
				});
			}
			return Object.defineProperties(base, {
				value: { enumerable: true, get: () => '' }
			});
		},
		issues: () => null
	};
}

const fields = new Proxy({ allIssues: () => null } as Record<string, unknown>, {
	get(target, prop: string) {
		if (prop in target) return target[prop];
		return (target[prop] ??= makeField(prop));
	}
});

vi.mock('#lib/remote/inbox.remote.js', () => ({
	submitContactForm: {
		fields,
		result: undefined,
		enhance: () => ({ method: 'POST', action: '?/submitContactForm' })
	}
}));

vi.mock('#lib/remote/settings.remote.js', () => ({
	getContactDetails: () =>
		Promise.resolve({
			address: { street: '123 Main St', city: 'Corvallis', state: 'OR', zip: '97333' },
			email: 'desk@example.org'
		})
}));

vi.mock('$app/paths', () => ({
	resolve: (p: string) => (p.startsWith('/') ? p : `/${p}`)
}));
vi.mock('svelte-turnstile', () => ({ Turnstile: () => {} }));

// Hoisted: an in-test `await import()` pays the module-graph cost inside the
// 5s test timeout and fails on a cold Vite cache.
const Page = (await import('./+page.svelte')).default;

describe('/contact server rendering', () => {
	it('renders without throwing on the subject select', async () => {
		const { body } = await render(Page);

		expect(body).toMatch(/<h1[\s>]/);
	});

	it('server-renders the subject options', async () => {
		const { body } = await render(Page);

		expect(body).toContain('General Inquiry');
		expect(body).toContain('Practice Space');
	});

	it('server-renders the contact email from the setting', async () => {
		const { body } = await render(Page);

		expect(body).toContain('href="mailto:desk@example.org"');
	});
});
