import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ThreadComposer from './ThreadComposer.test.svelte';

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

/**
 * Mode by structure (#2189): only a note posts `assignToUserId`, and only a
 * staff reply offers `disposition` submits — `wait` is the default one. The
 * tabs are Reply then Internal note.
 */
const isNote = () => document.querySelector('input[name="assignToUserId"]') !== null;
// Scoped to the composer's form: FormGuard's dialog carries a submit of its own.
const composer = () => document.querySelector('textarea[name="body"]')?.closest('form');
const submits = () => [
	...(composer()?.querySelectorAll<HTMLButtonElement>('button[type="submit"]') ?? [])
];
const dispositions = () => submits().filter((b) => b.name === 'disposition');
const tab = (i: number) => page.getByRole('tab').nth(i);
const BLOCKED = 'No contact email on this conversation.';

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

		expect(isNote()).toBe(false);
		await tab(1).click();

		await vi.waitFor(() => expect(isNote()).toBe(true));
		await expect.element(textarea).toHaveValue('Following up on the PA question');
	});

	// A thread change is a param change, so the component stays mounted. Without
	// a reset the draft rode along into the next conversation and sat above a
	// Send button addressed to somebody else (#978).
	it('drops the draft when the conversation changes', async () => {
		const { rerender } = await render(ThreadComposer, {
			threadId: 'thread-1',
			replyForm: fakeRemoteForm(),
			noteForm: fakeRemoteForm()
		});

		const textarea = page.getByRole('textbox');
		await textarea.fill('DRAFT FOR THREAD ONE');
		await expect.element(textarea).toHaveValue('DRAFT FOR THREAD ONE');

		await rerender({ threadId: 'thread-2' });

		await expect.element(page.getByRole('textbox')).toHaveValue('');
	});

	it('sends replies by default', async () => {
		await render(ThreadComposer, {
			threadId: 'thread-1',
			replyForm: fakeRemoteForm(),
			noteForm: fakeRemoteForm()
		});

		await vi.waitFor(() => expect(dispositions().map((b) => b.value)).toContain('wait'));
		expect(isNote()).toBe(false);
	});

	// A thread with no contact email has nowhere to send a reply, so the composer
	// must not offer one — the old page hid the form and left no way to type.
	it('falls back to note mode when replying is blocked', async () => {
		await render(ThreadComposer, {
			threadId: 'thread-1',
			replyForm: fakeRemoteForm(),
			noteForm: fakeRemoteForm(),
			replyBlockedReason: BLOCKED
		});

		await expect.element(page.getByText(BLOCKED)).toBeVisible();
		expect(isNote()).toBe(true);
	});

	it('ignores a click on the reply tab while replying is blocked', async () => {
		await render(ThreadComposer, {
			threadId: 'thread-1',
			replyForm: fakeRemoteForm(),
			noteForm: fakeRemoteForm(),
			replyBlockedReason: BLOCKED
		});

		await tab(0).click();

		await expect.element(page.getByRole('textbox')).toBeVisible();
		expect(isNote()).toBe(true);
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

		await expect.element(page.getByRole('textbox')).toBeVisible();
		expect(submits()).toHaveLength(1);
		expect(dispositions()).toHaveLength(0);
	});
});
