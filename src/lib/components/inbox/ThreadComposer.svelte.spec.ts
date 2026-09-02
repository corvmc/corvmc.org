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
			// The note form's handover field. Present on both fakes because the
			// component picks one form at a time and only reads this on the note.
			assignToUserId: {
				as: (type: string, value?: unknown) => ({ type, name: 'assignToUserId', value }),
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
		await render(ThreadComposer, {
			threadId: 'thread-1',
			replyForm: fakeRemoteForm(),
			noteForm: fakeRemoteForm()
		});

		const textarea = page.getByRole('textbox');
		await textarea.fill('Following up on the PA question');

		await page.getByRole('tab', { name: 'Internal note' }).click();

		await expect.element(textarea).toHaveValue('Following up on the PA question');
		await expect.element(page.getByRole('button', { name: 'Add note' })).toBeVisible();
	});

	it('sends replies by default', async () => {
		await render(ThreadComposer, {
			threadId: 'thread-1',
			replyForm: fakeRemoteForm(),
			noteForm: fakeRemoteForm()
		});

		await expect.element(page.getByRole('button', { name: 'Send + wait for reply' })).toBeVisible();
	});

	// A thread with no contact email has nowhere to send a reply, so the composer
	// must not offer one — the old page hid the form and left no way to type.
	it('falls back to note mode when replying is blocked', async () => {
		await render(ThreadComposer, {
			threadId: 'thread-1',
			replyForm: fakeRemoteForm(),
			noteForm: fakeRemoteForm(),
			replyBlockedReason: 'No contact email on this conversation.'
		});

		await expect.element(page.getByRole('button', { name: 'Add note' })).toBeVisible();
		await expect.element(page.getByText('No contact email on this conversation.')).toBeVisible();
	});

	it('ignores a click on the reply tab while replying is blocked', async () => {
		await render(ThreadComposer, {
			threadId: 'thread-1',
			replyForm: fakeRemoteForm(),
			noteForm: fakeRemoteForm(),
			replyBlockedReason: 'No contact email on this conversation.'
		});

		await page.getByRole('tab', { name: 'Reply' }).click();

		await expect.element(page.getByRole('button', { name: 'Add note' })).toBeVisible();
	});

	// The member portal uses this same component with no note form. It must not
	// offer to dispose of the thread: a member has no queue to move it out of,
	// and "Send + resolve" there would let them close a conversation staff still
	// owe an answer on.
	it('offers a plain send, and no dispositions, with no note form', async () => {
		await render(ThreadComposer, {
			threadId: 'thread-1',
			replyForm: fakeRemoteForm()
		});

		await expect.element(page.getByRole('button', { name: 'Send Reply' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Send + resolve' }).elements()).toHaveLength(0);
		await expect(page.getByRole('button', { name: 'Send + keep open' }).elements()).toHaveLength(0);
	});
});
