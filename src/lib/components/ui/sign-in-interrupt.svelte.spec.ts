import { page } from 'vitest/browser';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { createAttachmentKey } from 'svelte/attachments';
import { goto } from '$app/navigation';
import ActionHarness from './Action.test.svelte';

/**
 * The sign-in interrupt (#1999) as the two shared controls carry it: a
 * remote's 401 sends `Form` to sign-in, returning here, and `requiresAuth`
 * turns a signed-out trigger into that link before anything is sent.
 */

vi.mock('svelte-sonner', () => ({
	toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() })
}));
vi.mock('$app/navigation', () => ({
	invalidateAll: vi.fn(),
	goto: vi.fn(async () => undefined),
	beforeNavigate: vi.fn()
}));
vi.mock('$app/state', async (importOriginal) => ({
	...(await importOriginal<typeof import('$app/state')>()),
	page: { url: new URL('http://localhost/events/e1?tab=info') }
}));

/** A RemoteForm whose submit rejects the way Kit's client does on a 401. */
function refusingRemoteForm(rejectWith: unknown) {
	let callback: ((i: { submit: () => Promise<boolean> }) => unknown) | null = null;
	const instance: Record<string | symbol, unknown> = { method: 'POST', action: '?/rsvp' };
	instance[createAttachmentKey()] = (form: HTMLFormElement) => {
		const onsubmit = (event: SubmitEvent) => {
			event.preventDefault();
			void callback?.({
				submit: async () => {
					throw rejectWith;
				}
			});
		};
		form.addEventListener('submit', onsubmit);
		return () => form.removeEventListener('submit', onsubmit);
	};
	Object.defineProperties(instance, {
		fields: { value: { allIssues: () => null } },
		result: { value: undefined, writable: true },
		enhance: {
			value: (cb: typeof callback) => {
				callback = cb;
				return instance;
			}
		}
	});
	return instance as never;
}

const RETURN = '/login?redirect=%2Fevents%2Fe1%3Ftab%3Dinfo';

beforeEach(() => vi.mocked(goto).mockClear());

describe('Form, on a 401 from its remote', () => {
	it('goes to sign-in with this page as the return, instead of erroring', async () => {
		await render(ActionHarness, {
			action: refusingRemoteForm({ status: 401, body: { message: 'Not authenticated' } }),
			label: 'RSVP',
			modalTitle: 'RSVP',
			fieldName: 'eventId'
		});

		await page.getByRole('button', { name: 'RSVP' }).click();
		await page.getByRole('dialog').getByRole('button', { name: 'RSVP' }).click();

		await vi.waitFor(() => expect(goto).toHaveBeenCalledWith(RETURN));
	});

	it('leaves a 403 an error, not an interrupt', async () => {
		await render(ActionHarness, {
			action: refusingRemoteForm({ status: 403, body: { message: 'Not permitted' } }),
			label: 'RSVP',
			modalTitle: 'RSVP',
			fieldName: 'eventId'
		});

		await page.getByRole('button', { name: 'RSVP' }).click();
		await page.getByRole('dialog').getByRole('button', { name: 'RSVP' }).click();

		await expect
			.element(page.getByRole('dialog').getByRole('button', { name: 'Error' }))
			.toBeVisible();
		expect(goto).not.toHaveBeenCalled();
	});
});

describe('Action, on a 401 from a direct callback', () => {
	it('goes to sign-in with this page as the return, instead of erroring', async () => {
		const run = vi.fn(async () => {
			throw { status: 401, body: { message: 'Not authenticated' } };
		});
		await render(ActionHarness, { action: run, label: 'Save' });

		await page.getByRole('button', { name: 'Save' }).click();

		await vi.waitFor(() => expect(goto).toHaveBeenCalledWith(RETURN));
		await expect.element(page.getByRole('button', { name: 'Error' })).not.toBeInTheDocument();
	});
});

describe('Action with requiresAuth', () => {
	it('is the sign-in link, with the intent, when signed out', async () => {
		const run = vi.fn(async () => undefined);
		await render(ActionHarness, {
			action: run,
			label: 'RSVP',
			requiresAuth: 'RSVP to Spring Workshop',
			signedIn: false
		});

		const link = page.getByRole('link', { name: 'RSVP' });
		await expect.element(link).toBeVisible();
		const href = new URL((link.element() as HTMLAnchorElement).href);
		expect(href.pathname).toBe('/login');
		expect(href.searchParams.get('redirect')).toBe('/events/e1?tab=info');
		expect(href.searchParams.get('intent')).toBe('RSVP to Spring Workshop');
		expect(run).not.toHaveBeenCalled();
	});

	it('is the ordinary action when signed in', async () => {
		const run = vi.fn(async () => undefined);
		await render(ActionHarness, {
			action: run,
			label: 'RSVP',
			requiresAuth: true,
			signedIn: true
		});

		await page.getByRole('button', { name: 'RSVP' }).click();
		await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
	});
});
