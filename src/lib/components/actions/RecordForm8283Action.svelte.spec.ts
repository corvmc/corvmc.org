import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

/**
 * Two decisions, both about an acknowledgment that is already on file. The
 * trigger flips between recording one and editing one, and the stored `Date` is
 * cut back to the `yyyy-mm-dd` a date input will accept — a `Date` handed
 * straight to the field renders blank, and an edit that opens blank and is saved
 * erases the signature date that decides whether a later disposal owes a
 * Form 8282.
 */

const field = (name: string) => ({
	as: (type: string, value?: unknown) => ({ type, name, value }),
	issues: () => null
});

vi.mock('$lib/remote/inventory.remote', () => ({
	recordForm8283: {
		enhance: () => ({ method: 'POST', action: '?/recordForm8283' }),
		fields: {
			id: field('id'),
			signedOn: field('signedOn'),
			appraisalRef: field('appraisalRef'),
			allIssues: () => null
		},
		result: undefined
	}
}));

// `FormGuard`, which `<Form>` always imports, reaches for `beforeNavigate`; a
// partial mock of this module is a missing-export error at import time rather
// than at the call.
vi.mock('$app/navigation', () => ({
	invalidateAll: vi.fn(),
	goto: vi.fn(),
	beforeNavigate: vi.fn()
}));

const RecordForm8283Action = (await import('./RecordForm8283Action.svelte')).default;

const open = async (props: Record<string, unknown> = {}) => {
	const label = props.signedOn ? 'Edit 8283' : 'Record 8283';
	await render(RecordForm8283Action, { acquisitionId: 'acq-4', ...props });
	await page.getByRole('button', { name: label }).first().click();
	return page.getByRole('dialog');
};

const input = (name: string) =>
	document.querySelector(`[role="dialog"] input[name="${name}"]`) as HTMLInputElement;

describe('RecordForm8283Action', () => {
	// The trigger sits in a row of acquisitions. Which of the two it says is the
	// only signal that this gift's acknowledgment is already on file.
	it('offers to record when nothing is on file', async () => {
		await render(RecordForm8283Action, { acquisitionId: 'acq-4' });

		await expect.element(page.getByRole('button', { name: 'Record 8283' })).toBeVisible();
	});

	it('offers to edit once something is', async () => {
		await render(RecordForm8283Action, {
			acquisitionId: 'acq-4',
			signedOn: new Date('2026-03-14T00:00:00Z')
		});

		await expect.element(page.getByRole('button', { name: 'Edit 8283' })).toBeVisible();
	});

	// A date input takes `yyyy-mm-dd` and nothing else; anything longer is
	// rejected silently and the field renders empty.
	it('pre-fills the date already signed', async () => {
		await expect.element(await open({ signedOn: new Date('2026-03-14T00:00:00Z') })).toBeVisible();

		expect(input('signedOn').type).toBe('date');
		expect(input('signedOn').value).toBe('2026-03-14');
	});

	it('leaves the date empty when none was recorded', async () => {
		await expect.element(await open()).toBeVisible();

		expect(input('signedOn').value).toBe('');
	});

	// `?? ''` rather than a bare forward: the column is nullable, and `null` in a
	// text input renders the word "null" for the staffer to delete by hand.
	it('renders a missing appraisal reference as an empty field', async () => {
		await expect.element(await open({ appraisalRef: null })).toBeVisible();

		expect(input('appraisalRef').value).toBe('');
	});

	it('pre-fills an appraisal reference that exists', async () => {
		await expect.element(await open({ appraisalRef: 'Cabinet 3, folder 11' })).toBeVisible();

		expect(input('appraisalRef').value).toBe('Cabinet 3, folder 11');
	});

	it('carries the acquisition into the form', async () => {
		await expect.element(await open()).toBeVisible();

		expect(input('id').type).toBe('hidden');
		expect(input('id').value).toBe('acq-4');
	});
});
