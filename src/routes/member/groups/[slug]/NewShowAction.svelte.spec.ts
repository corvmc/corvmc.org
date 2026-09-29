import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

vi.mock('$lib/remote/productions.remote', () => {
	const field = (name: string) => ({
		as: (type: string, value?: unknown) => ({ type, name, value }),
		issues: () => null
	});
	const fields = new Proxy({ allIssues: () => null } as Record<string, unknown>, {
		get: (target, key: string) => target[key] ?? field(key)
	});
	return {
		createShow: {
			enhance: () => ({ method: 'POST', action: '?/createShow' }),
			fields,
			result: undefined
		}
	};
});

// `FormGuard`, which `<Form>` always imports, reaches for `beforeNavigate`.
vi.mock('$app/navigation', () => ({
	invalidateAll: vi.fn(),
	goto: vi.fn(),
	beforeNavigate: vi.fn()
}));

const NewShowAction = (await import('./NewShowAction.svelte')).default;

describe('NewShowAction', () => {
	it('asks for a name, a date and the two times createShow takes', async () => {
		await render(NewShowAction);
		await page.getByRole('button', { name: 'New show' }).click();

		const dialog = page.getByRole('dialog');
		await expect
			.element(dialog.getByRole('textbox', { name: 'Name' }))
			.toHaveAttribute('name', 'title');
		await expect.element(dialog.getByLabelText('Date')).toHaveAttribute('name', 'eventDate');
		await expect.element(dialog.getByLabelText('Starts')).toHaveAttribute('name', 'eventStartTime');
		await expect.element(dialog.getByLabelText('Ends')).toHaveAttribute('name', 'eventEndTime');
		await expect.element(dialog.getByRole('button', { name: 'Open' })).toBeVisible();
	});
});
