import { page } from 'vitest/browser';
import { describe, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { addCalendarDays, forEachClockEdge } from '$lib/test/clock-edges';

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
	// #1984: 6pm PDT on Oct 26 was already Oct 27 in UTC, so a week out read Nov 3.
	forEachClockEdge(
		'defaults the first due date to a week from the club day',
		async ({ clubDate }) => {
			await render(CommitteeRecurringWork, {
				groupId: 'group-1',
				schedules: [],
				roles: [{ value: 'role-1', label: 'Booking Lead' }],
				canEdit: true
			});
			await page.getByRole('button').click();

			await expect
				.element(page.getByLabelText('First one due'))
				.toHaveValue(addCalendarDays(clubDate, 7));
		},
		{ fakeTimers: true }
	);
});
