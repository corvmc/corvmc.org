import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { createAttachmentKey } from 'svelte/attachments';

vi.mock('$env/dynamic/public', () => ({ env: {} }));

vi.mock('$app/navigation', () => ({
	invalidateAll: vi.fn(),
	goto: vi.fn(),
	beforeNavigate: vi.fn()
}));

// The real widget injects Cloudflare's challenge script and renders its own
// hidden input. Neither is what is under test; the hidden input is, because it
// is the reason `turnstileToken` has no FormField to render an issue in.
vi.mock('svelte-turnstile', async () => ({
	Turnstile: (await import('./Turnstile.test.svelte')).default
}));

/**
 * A RemoteForm that fails validation with one issue, on the field the Turnstile
 * widget owns. Faithful in the respects `<Form>` reads: an attachment that
 * intercepts the submit, `enhance`, and `fields.allIssues()`.
 */
function failingRemoteForm() {
	let callback: ((instance: { submit: () => Promise<boolean> }) => unknown) | null = null;
	const instance: Record<string | symbol, unknown> = { method: 'POST', action: '?/report' };

	instance[createAttachmentKey()] = (form: HTMLFormElement) => {
		const onsubmit = (event: SubmitEvent) => {
			event.preventDefault();
			void callback?.({ submit: async () => false });
		};
		form.addEventListener('submit', onsubmit);
		return () => form.removeEventListener('submit', onsubmit);
	};

	const issues = [{ message: 'Verification failed.', path: ['turnstileToken'] }];
	const field = (name: string) => ({
		as: () => ({ name, value: '' }),
		issues: () => (name === 'turnstileToken' ? issues : null)
	});

	Object.defineProperties(instance, {
		fields: {
			value: new Proxy(
				{},
				{
					get: (_, prop) => (prop === 'allIssues' ? () => issues : field(String(prop)))
				}
			)
		},
		result: { value: undefined, writable: true },
		enhance: {
			value: (cb: (instance: { submit: () => Promise<boolean> }) => unknown) => {
				callback = cb;
				return instance;
			}
		}
	});

	return instance as never;
}

vi.mock('$lib/remote/flags.remote', () => ({ submitEventReport: failingRemoteForm() }));

const ReportEventAction = (await import('./ReportEventAction.svelte')).default;

/**
 * The gig guide is public, so a reporter whose Turnstile token expired while
 * they typed gets the rejection. The widget owns its own hidden input, so
 * `turnstileToken` has no FormField to render its issue in — and the component
 * passes `onfailure`, which suppresses Form's fallback toast. Submit did
 * nothing at all, with no reason given. #803.
 */
describe('ReportEventAction', () => {
	it('tells the reporter when the bot check rejected the submission', async () => {
		await render(ReportEventAction, { eventId: 'event-1', eventTitle: 'Night Two' });

		await page.getByRole('button', { name: 'Report' }).click();
		await page.getByRole('textbox', { name: 'Reason' }).fill('Spam');
		await page.getByRole('dialog').getByRole('button', { name: 'Submit report' }).click();

		await expect.element(page.getByRole('alert')).toBeVisible();
	});
});
