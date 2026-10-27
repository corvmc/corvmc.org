import { page } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

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

vi.mock('$lib/remote/maintenance-schedules.remote', () => ({
	createCommitteeRecurringWork: {
		enhance: () => ({ method: 'POST', action: '?/createCommitteeRecurringWork' }),
		fields,
		result: undefined
	},
	retireCommitteeRecurringWork: {
		enhance: () => ({ method: 'POST', action: '?/retireCommitteeRecurringWork' }),
		fields,
		result: undefined
	}
}));

vi.mock('$app/navigation', () => ({
	invalidateAll: vi.fn(),
	goto: vi.fn(),
	beforeNavigate: vi.fn()
}));

const CommitteeRecurringWork = (await import('./CommitteeRecurringWork.svelte')).default;

describe('CommitteeRecurringWork', () => {
	afterEach(() => vi.useRealTimers());

	// #1984: 6pm PDT on Oct 26 is already Oct 27 in UTC, so a week out is Nov 2.
	it('defaults the first due date to a week from the club day', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-10-27T01:00:00Z'));
		await render(CommitteeRecurringWork, {
			groupId: 'group-1',
			schedules: [],
			roles: [{ value: 'role-1', label: 'Booking Lead' }],
			canEdit: true
		});
		await page.getByRole('button', { name: 'Add' }).click();

		await expect.element(page.getByLabelText('First one due')).toHaveValue('2026-11-02');
	});
});
