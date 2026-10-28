import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { toLocalDateTime } from '$lib/utils/format';

/**
 * The editor for a closure row on the reservations list (#1833). The closures
 * page edited in place and this only posted; now the modal is the editor, so it
 * has to arrive filled with the closure it edits, in club time.
 */

vi.mock('$lib/remote/closures.remote', () => {
	const field = (name: string) => ({
		as: (type: string, value?: unknown) => ({ type, name, value }),
		issues: () => null
	});
	const instance = {
		enhance: () => ({ method: 'POST', action: '?/updateClosure' }),
		fields: {
			id: field('id'),
			reason: field('reason'),
			startsAt: field('startsAt'),
			endsAt: field('endsAt'),
			allIssues: () => null
		},
		result: undefined
	};
	return { updateClosure: { ...instance, for: () => instance } };
});

// `FormGuard`, which `<Form>` always imports, reaches for `beforeNavigate`.
vi.mock('$app/navigation', () => ({
	invalidateAll: vi.fn(),
	goto: vi.fn(),
	beforeNavigate: vi.fn()
}));

const UpdateClosureAction = (await import('./UpdateClosureAction.svelte')).default;

const closure = {
	id: 'closure-2',
	reason: 'Floor refinishing',
	startsAt: new Date('2026-04-01T16:00:00Z'),
	endsAt: new Date('2026-04-03T00:00:00Z')
};

const named = (name: string) =>
	document.querySelector(`[role="dialog"] [name="${name}"]`) as HTMLInputElement | null;

const open = async () => {
	await render(UpdateClosureAction, { closure });
	await page.getByRole('button', { name: 'Edit closure' }).first().click();
	await expect.element(page.getByRole('dialog')).toBeVisible();
};

describe('UpdateClosureAction', () => {
	it('opens filled with the closure, times in club time', async () => {
		await open();
		expect(named('reason')?.value).toBe('Floor refinishing');
		expect(named('startsAt')?.value).toBe(toLocalDateTime(closure.startsAt));
		expect(named('endsAt')?.value).toBe(toLocalDateTime(closure.endsAt));
	});
});
