import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ThreadComposer from './ThreadComposer.svelte';

/**
 * Minimal stand-in for a SvelteKit RemoteForm instance: `<Form>` only needs
 * `enhance()`, the field `.as()` attributes, and the issue accessors.
 */
function fakeRemoteForm() {
	return {
		enhance: () => ({ method: 'POST', action: '?/noop' }),
		fields: {
			threadId: {
				as: (type: string, value?: unknown) => ({ type, name: 'threadId', value }),
				issues: () => null
			},
			body: {
				as: (type: string) => ({ type, name: 'body' }),
				issues: () => null
			},
			allIssues: () => null
		},
		result: undefined
	} as never;
}

describe('ThreadComposer', () => {
	// The whole point of merging the two boxes: deciding "actually, this is a
	// note" mid-sentence must not cost you the sentence.
	it('keeps the draft when switching from reply to internal note', async () => {
		render(ThreadComposer, {
			threadId: 'thread-1',
			replyForm: fakeRemoteForm(),
			noteForm: fakeRemoteForm()
		});

		const textarea = page.getByRole('textbox');
		await textarea.fill('Following up on the PA question');

		await page.getByRole('tab', { name: 'Internal note' }).click();

		await expect.element(textarea).toHaveValue('Following up on the PA question');
		await expect.element(page.getByRole('button', { name: 'Add Note' })).toBeVisible();
	});

	it('sends replies by default', async () => {
		render(ThreadComposer, {
			threadId: 'thread-1',
			replyForm: fakeRemoteForm(),
			noteForm: fakeRemoteForm()
		});

		await expect.element(page.getByRole('button', { name: 'Send Reply' })).toBeVisible();
	});

	// A thread with no contact email has nowhere to send a reply, so the composer
	// must not offer one — the old page hid the form and left no way to type.
	it('falls back to note mode when replying is blocked', async () => {
		render(ThreadComposer, {
			threadId: 'thread-1',
			replyForm: fakeRemoteForm(),
			noteForm: fakeRemoteForm(),
			replyBlockedReason: 'No contact email on this conversation.'
		});

		await expect.element(page.getByRole('button', { name: 'Add Note' })).toBeVisible();
		await expect.element(page.getByText('No contact email on this conversation.')).toBeVisible();
	});

	it('ignores a click on the reply tab while replying is blocked', async () => {
		render(ThreadComposer, {
			threadId: 'thread-1',
			replyForm: fakeRemoteForm(),
			noteForm: fakeRemoteForm(),
			replyBlockedReason: 'No contact email on this conversation.'
		});

		await page.getByRole('tab', { name: 'Reply' }).click();

		await expect.element(page.getByRole('button', { name: 'Add Note' })).toBeVisible();
	});
});
