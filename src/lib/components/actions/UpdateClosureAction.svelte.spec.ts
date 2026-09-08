import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

/**
 * The whole payload is hidden. This action asks nothing and edits nothing — the
 * page above it holds the closure being edited and this only posts it — so all
 * four values reach the handler as hidden inputs or not at all. A missing one
 * is a save that reports success and blanks a field, or updates the wrong row.
 */

vi.mock('$lib/remote/closures.remote', () => {
	const field = (name: string) => ({
		as: (type: string, value?: unknown) => ({ type, name, value }),
		issues: () => null
	});
	return {
		updateClosure: {
			enhance: () => ({ method: 'POST', action: '?/updateClosure' }),
			fields: {
				id: field('id'),
				reason: field('reason'),
				startsAt: field('startsAt'),
				endsAt: field('endsAt'),
				allIssues: () => null
			},
			result: undefined
		}
	};
});

// `FormGuard`, which `<Form>` always imports, reaches for `beforeNavigate`; a
// partial mock of this module is a missing-export error at import time rather
// than at the call.
vi.mock('$app/navigation', () => ({
	invalidateAll: vi.fn(),
	goto: vi.fn(),
	beforeNavigate: vi.fn()
}));

const UpdateClosureAction = (await import('./UpdateClosureAction.svelte')).default;

const props = {
	closureId: 'closure-2',
	reason: 'Floor refinishing',
	startsAt: '2026-04-01T09:00',
	endsAt: '2026-04-03T17:00'
};

const open = async () => {
	await render(UpdateClosureAction, props);
	await page.getByRole('button', { name: 'Save' }).first().click();
	return page.getByRole('dialog');
};

describe('UpdateClosureAction', () => {
	for (const [name, value] of [
		['id', props.closureId],
		['reason', props.reason],
		['startsAt', props.startsAt],
		['endsAt', props.endsAt]
	] as const) {
		it(`carries ${name} into the form`, async () => {
			await expect.element(await open()).toBeVisible();

			const hidden = document.querySelector(
				`[role="dialog"] input[name="${name}"]`
			) as unknown as HTMLInputElement;
			expect(hidden).not.toBeNull();
			expect(hidden.type).toBe('hidden');
			expect(hidden.value).toBe(value);
		});
	}

	// Deliberately not an editor. The dialog is a confirmation for values the
	// page already holds, so a visible field appearing here would be a second,
	// competing copy of the same closure.
	it('offers nothing to edit', async () => {
		await expect.element(await open()).toBeVisible();

		const visible = Array.from(
			document.querySelectorAll('[role="dialog"] input, [role="dialog"] textarea')
		).filter((el) => (el as HTMLInputElement).type !== 'hidden');
		expect(visible).toEqual([]);
	});
});
