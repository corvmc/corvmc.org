import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import '#lib/test/locators.js';

/**
 * Each kind has its own create capability (#3098), so a kind the viewer picks
 * could be one they cannot create (#3115). The page fixes the kind instead, so
 * the form withholds the choice.
 */

const fields = new Proxy(
	{ allIssues: () => null },
	{
		get: (target, name: string) =>
			name in target
				? target[name as keyof typeof target]
				: { as: (type: string, value = '') => ({ type, name, value }), issues: () => null }
	}
);

vi.mock('#lib/remote/groups.remote.js', () => ({
	createStaffGroup: {
		enhance: () => ({ method: 'POST', action: '?/createStaffGroup' }),
		fields,
		result: undefined
	}
}));
vi.mock('#lib/remote/reservations.remote.js', () => ({ searchMembers: async () => [] }));
vi.mock('$app/navigation', () => ({
	refreshAll: vi.fn(),
	goto: vi.fn(),
	beforeNavigate: vi.fn()
}));

const CreateGroupAction = (await import('./CreateGroupAction.svelte')).default;

const dialogSelects = () => [
	...(document.querySelector('[role="dialog"]')?.querySelectorAll('select') ?? [])
];

describe('CreateGroupAction', () => {
	it.each(['club', 'committee'] as const)('offers no kind from the %s page', async (kind) => {
		const { locator } = await render(CreateGroupAction, { kind });
		await locator.getByRole('button').click();
		await expect.poll(() => dialogSelects().length).toBeGreaterThan(0);

		const offered = dialogSelects().flatMap((s) => [...s.options].map((o) => o.value));
		expect(offered).not.toContain('club');
		expect(offered).not.toContain('committee');
	});
});
