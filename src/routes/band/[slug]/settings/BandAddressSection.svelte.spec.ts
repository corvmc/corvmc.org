import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { createAttachmentKey } from 'svelte/attachments';
import { goto } from '$app/navigation';
import '#lib/test/locators.js';

/**
 * After a move every query on the page is keyed on a slug that no longer exists,
 * and `getBandLayout` answers one with a forward to the band's bare address. A
 * refresh that lands after the owner's own navigation strands them there.
 */

const { refreshedAll } = vi.hoisted(() => ({ refreshedAll: vi.fn() }));

vi.mock('$app/env/public', async () =>
	(await import('#lib/testing/env-mock.js')).envMock({ PUBLIC_SITE_URL: 'http://localhost' })
);
vi.mock('svelte-sonner', () => ({
	toast: Object.assign(vi.fn(), { success: vi.fn(), info: vi.fn(), error: vi.fn() })
}));
vi.mock('$app/navigation', () => ({
	invalidateAll: vi.fn(),
	goto: vi.fn(async () => undefined),
	beforeNavigate: vi.fn()
}));

/**
 * Kit's client in the one respect under test: a submit with no `.updates()` call
 * refreshes every query on the page, and `.updates()` must be called synchronously.
 */
vi.mock('#lib/remote/band-address.remote.js', () => {
	type Submit = () => Promise<boolean> & { updates: () => Promise<boolean> };
	let callback: ((instance: { submit: Submit }) => unknown) | null = null;
	const instance: Record<string | symbol, unknown> = { method: 'POST', action: '?/move' };

	const submit: Submit = () => {
		let tookControl = false;
		const done = Promise.resolve().then(() => {
			instance.result = { success: true, slug: 'new-name', changed: true };
			if (!tookControl) refreshedAll();
			return true;
		});
		return Object.assign(done, {
			updates: () => {
				tookControl = true;
				return done;
			}
		});
	};

	instance[createAttachmentKey()] = (form: HTMLFormElement) => {
		const onsubmit = (event: SubmitEvent) => {
			event.preventDefault();
			void callback?.({ submit });
		};
		form.addEventListener('submit', onsubmit);
		return () => form.removeEventListener('submit', onsubmit);
	};

	const field = (name: string) => ({
		as: () => ({ name, value: '' }),
		issues: () => null
	});
	Object.defineProperties(instance, {
		fields: {
			value: new Proxy(
				{},
				{ get: (_, prop) => (prop === 'allIssues' ? () => null : field(String(prop))) }
			)
		},
		enhance: {
			value: (cb: typeof callback) => {
				callback = cb;
				return instance;
			}
		}
	});
	return { changeBandAddress: instance };
});

const BandAddressSection = (await import('./BandAddressSection.svelte')).default;

beforeEach(() => {
	refreshedAll.mockClear();
	vi.mocked(goto).mockClear();
});

describe('moving a band to a new address', () => {
	it('goes to settings on the new address without refreshing the old-slug queries', async () => {
		await render(BandAddressSection, { slug: 'old-name' });

		await page.getByTestId('change-address').click();
		await page.getByRole('dialog').getByCss('input[name="newSlug"]').fill('new-name');
		await page.getByRole('dialog').getByCss('button[type="submit"]').click();

		await expect.poll(() => vi.mocked(goto).mock.calls.length).toBe(1);
		expect(String(vi.mocked(goto).mock.calls[0][0])).toMatch(/\/band\/new-name\/settings$/);
		expect(refreshedAll).not.toHaveBeenCalled();
	});
});
