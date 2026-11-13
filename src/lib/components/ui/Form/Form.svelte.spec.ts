import { page, userEvent } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

/**
 * Every field is disabled while a form is pending, and disabling the focused
 * one drops focus to `<body>`: a keyboard user's next keystrokes went nowhere
 * (#2791). The form puts focus back, on whatever field it can see is invalid.
 */

const { guards } = vi.hoisted(() => ({
	guards: [] as ((navigation: { cancel: () => void; to: { url: URL } }) => void)[]
}));

vi.mock('$app/navigation', () => ({
	goto: vi.fn(),
	beforeNavigate: (guard: (typeof guards)[number]) => guards.push(guard)
}));
vi.mock('#lib/report-error.js', () => ({ reportError: vi.fn() }));

const FormFocus = (await import('./FormFocus.test.svelte')).default;
const FormReplaced = (await import('./FormReplaced.test.svelte')).default;
const FormGuardDefault = (await import('./FormGuardDefault.test.svelte')).default;

const submitFromFirstField = async (action: () => Promise<void>) => {
	await render(FormFocus, { action });
	const first = page.getByRole('textbox', { name: 'First' });
	await first.click();
	await userEvent.keyboard('{Enter}');
	return first;
};

describe('Form focus after submit', () => {
	it('moves focus to the invalid field when the submit fails', async () => {
		await submitFromFirstField(() => Promise.reject(new Error('no')));

		await expect.element(page.getByRole('textbox', { name: 'Second' })).toHaveFocus();
	});

	it('returns focus to where it was when the submit succeeds', async () => {
		const first = await submitFromFirstField(() => Promise.resolve());

		await expect.element(first).toHaveFocus();
	});

	it('moves focus to the message that replaced the form', async () => {
		await render(FormReplaced);
		await page.getByRole('textbox', { name: 'First' }).click();
		await userEvent.keyboard('{Enter}');

		await expect.element(page.getByRole('alert')).toHaveFocus();
	});
});

/**
 * Three pages lost typed input on a sidebar click because their form never
 * opted into the guard (#2775, #2785, #2812). The guard is the default, so a
 * form that says nothing about it is guarded.
 */
describe('Form unsaved-changes guard', () => {
	it('stops a navigation away from typed input without being asked to', async () => {
		guards.length = 0;
		await render(FormGuardDefault);
		await page.getByRole('textbox', { name: 'Title' }).fill('Half a title');

		const cancel = vi.fn();
		for (const guard of guards)
			guard({ cancel, to: { url: new URL('http://localhost/elsewhere') } });

		expect(cancel).toHaveBeenCalled();
	});
});
