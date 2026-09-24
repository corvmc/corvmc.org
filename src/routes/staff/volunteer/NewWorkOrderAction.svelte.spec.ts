import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

/**
 * `createWorkOrder` existed with no page rendering it (#1426), so an
 * unscheduled work order could only be stamped out by a duty list or a seed.
 * These pin that the action posts every field the form accepts.
 */

let roles = [
	{ id: 'role-1', name: 'Booking Lead', isActive: true },
	{ id: 'role-2', name: 'Retired Role', isActive: false }
];

vi.mock('$lib/remote/volunteer.remote', () => ({
	getVolunteerRoles: async () => roles,
	createWorkOrder: {
		enhance: () => ({ method: 'POST', action: '?/createWorkOrder' }),
		fields: { allIssues: () => null },
		result: undefined
	}
}));

vi.mock('$app/navigation', () => ({
	invalidateAll: vi.fn(),
	goto: vi.fn(),
	beforeNavigate: vi.fn()
}));

const NewWorkOrderAction = (await import('./NewWorkOrderActionHarness.svelte')).default;

const field = (name: string) =>
	document.querySelector(`[role="dialog"] [name="${name}"]`) as HTMLInputElement | null;

describe('NewWorkOrderAction', () => {
	it('asks for a live role, a deadline, a capacity and notes', async () => {
		await render(NewWorkOrderAction, {});
		await page.getByRole('button', { name: 'New Work Order' }).click();
		await expect.element(page.getByLabelText('Role')).toBeVisible();

		expect(field('volunteerRoleId')?.value).toBe('role-1');
		expect(document.querySelector('[role="dialog"] option[value="role-2"]')).toBeNull();
		expect(field('dueAt')?.type).toBe('datetime-local');
		expect(field('capacity')?.value).toBe('1');
		expect(field('notes')).not.toBeNull();
	});

	it('renders nothing when there is no live role to pick', async () => {
		roles = [{ id: 'role-2', name: 'Retired Role', isActive: false }];
		const { container } = await render(NewWorkOrderAction, {});

		expect(container.querySelector('button')).toBeNull();
	});
});
