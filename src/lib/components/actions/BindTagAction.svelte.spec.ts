import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

/**
 * One prop turns this from "bind a tag" into "rebind a tag": the trigger, the
 * modal title and the panel above the field all flip on `currentTag`. The flip
 * matters because a rebind is a *different* claim — the unit keeps its id, its
 * loans and its repairs, and only the sticker changes — and the dialog is the
 * only place that is said.
 *
 * What a scan *means* is `parseScan`, covered by `src/lib/utils/scan.spec.ts`.
 */

vi.mock('$lib/remote/inventory.remote', () => ({
	bindTag: {
		enhance: () => ({ method: 'POST', action: '?/bindTag' }),
		fields: {
			assetId: {
				as: (type: string, value?: unknown) => ({ type, name: 'assetId', value }),
				issues: () => null
			},
			assetTag: {
				as: (type: string, value?: unknown) => ({ type, name: 'assetTag', value }),
				issues: () => null
			},
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

const BindTagAction = (await import('./BindTagAction.svelte')).default;

const open = async (props: Record<string, unknown> = {}) => {
	await render(BindTagAction, { assetId: 'asset-3', ...props });
	await page
		.getByRole('button', { name: props.currentTag ? 'Rebind tag' : 'Bind tag' })
		.first()
		.click();
	return page.getByRole('dialog');
};

const tagField = () =>
	document.querySelector('[role="dialog"] input[name="assetTag"]') as HTMLInputElement;

describe('BindTagAction', () => {
	it('offers to bind when the unit wears no tag', async () => {
		await expect.element(await open()).toBeVisible();

		await expect
			.element(page.getByText('Scan or type the tag printed on the sticker.'))
			.toBeVisible();
		expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain('currently wears');
	});

	// A staffer rebinding needs to know which sticker they are replacing —
	// the unit in their hands may be one of several on the bench.
	it('names the tag being replaced when there is one', async () => {
		await expect.element(await open({ currentTag: 'CMC-000110' })).toBeVisible();

		await expect.element(page.getByText('CMC-000110')).toBeVisible();
	});

	// The reassurance is the whole reason a rebind is offered rather than a
	// delete-and-recreate: identity is the record, not the label stuck to it.
	it('says a rebind keeps the history attached to the unit', async () => {
		await expect.element(await open({ currentTag: 'CMC-000110' })).toBeVisible();

		await expect
			.element(page.getByText('keeps every loan and repair already recorded', { exact: false }))
			.toBeVisible();
	});

	/**
	 * The field starts empty even on a rebind. Pre-filling it would look helpful
	 * and would submit the tag already bound — a rebind onto itself, which reads
	 * as a save that did nothing. The tag being replaced is stated above instead.
	 */
	it('opens the field empty rather than pre-filled with the tag being replaced', async () => {
		await expect.element(await open({ currentTag: 'CMC-000110' })).toBeVisible();

		expect(tagField().value).toBe('');
	});

	it('carries the unit into the form', async () => {
		await expect.element(await open()).toBeVisible();

		const hidden = document.querySelector(
			'[role="dialog"] input[name="assetId"]'
		) as HTMLInputElement;
		expect(hidden.type).toBe('hidden');
		expect(hidden.value).toBe('asset-3');
	});
});
