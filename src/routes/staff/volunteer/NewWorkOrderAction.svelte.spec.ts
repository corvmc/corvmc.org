import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

/**
 * One action for work with a time and work without (#1933). These pin that the
 * window is a checkbox that swaps Starts/Ends for a deadline, and that the role
 * defaults still prefill the capacity.
 */

let roles = [
	{ id: 'role-1', name: 'Booking Lead', isActive: true, defaultCapacity: 3 },
	{ id: 'role-2', name: 'Retired Role', isActive: false }
];

// Every field the form spreads: `as()` for the hidden inputs, `issues()` for the rest.
const fields = new Proxy(
	{ allIssues: () => null },
	{
		get: (target, name: string) =>
			name in target
				? target[name as keyof typeof target]
				: { as: (type: string, value = '') => ({ type, name, value }), issues: () => null }
	}
);

vi.mock('$lib/remote/volunteer.remote', () => ({
	getVolunteerRoles: async () => roles,
	createWorkOrder: {
		enhance: () => ({ method: 'POST', action: '?/createWorkOrder' }),
		fields,
		result: undefined
	}
}));
vi.mock('$lib/remote/events.remote', () => ({ searchEvents: async () => [] }));
vi.mock('$lib/remote/maintenance-schedules.remote', () => ({ searchWorkAssets: async () => [] }));

vi.mock('$app/navigation', () => ({
	invalidateAll: vi.fn(),
	goto: vi.fn(),
	beforeNavigate: vi.fn()
}));

const NewWorkOrderAction = (await import('./NewWorkOrderActionHarness.svelte')).default;

const field = (name: string) =>
	document.querySelector(`[role="dialog"] [name="${name}"]`) as HTMLInputElement | null;

describe('NewWorkOrderAction', () => {
	it('opens timed, with a live role and its default capacity', async () => {
		await render(NewWorkOrderAction, {});
		await page.getByRole('button', { name: 'New Work Order' }).click();
		await expect.element(page.getByLabelText('Role')).toBeVisible();

		expect(field('volunteerRoleId')?.value).toBe('role-1');
		expect(document.querySelector('[role="dialog"] option[value="role-2"]')).toBeNull();
		expect(field('b:timed')?.checked).toBe(true);
		expect(field('startsAt')?.type).toBe('datetime-local');
		expect(field('endsAt')).not.toBeNull();
		expect(field('dueAt')).toBeNull();
		expect(field('capacity')?.value).toBe('3');
		expect(field('notes')).not.toBeNull();
	});

	it('swaps the window for a deadline when it has no set time', async () => {
		await render(NewWorkOrderAction, {});
		await page.getByRole('button', { name: 'New Work Order' }).click();
		await page.getByLabelText('It has a set time').click();

		await expect.poll(() => field('dueAt')?.type).toBe('datetime-local');
		expect(field('startsAt')).toBeNull();
		expect(field('endsAt')).toBeNull();
	});

	it('renders nothing when there is no live role to pick', async () => {
		roles = [{ id: 'role-2', name: 'Retired Role', isActive: false }];
		const { container } = await render(NewWorkOrderAction, {});

		expect(container.querySelector('button')).toBeNull();
	});
});
