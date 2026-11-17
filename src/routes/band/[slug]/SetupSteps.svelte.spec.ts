import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { BandSetupStep } from '#lib/types/band-dashboard.js';

// A new band's first steps (#3134): each open one links to its page, a done one
// does not, and only a step marked dismissible offers Dismiss (#3127).

const field = (name: string) => ({
	as: (type: string, value?: unknown) => ({ type, name, value }),
	issues: () => null,
	value: () => undefined,
	set: vi.fn()
});
const remote = {
	enhance: () => ({ method: 'POST', action: '?/dismiss' }),
	fields: new Proxy({ allIssues: () => null } as Record<string, unknown>, {
		get: (target, key: string) => target[key] ?? field(key)
	}),
	result: undefined
};
vi.mock('#lib/remote/band-dashboard.remote.js', () => ({ dismissInviteStep: remote }));
// `FormGuard`, which `<Form>` always imports, reaches for `beforeNavigate`.
vi.mock('$app/navigation', () => ({
	refreshAll: vi.fn(),
	goto: vi.fn(),
	beforeNavigate: vi.fn()
}));

const SetupSteps = (await import('./SetupSteps.svelte')).default;

const step = (key: BandSetupStep['key'], done: boolean, dismissible = false): BandSetupStep => ({
	key,
	done,
	href: `/band/porchlights/${key}` as BandSetupStep['href'],
	dismissible
});

const hrefs = (container: HTMLElement) =>
	[...container.querySelectorAll('li a')].map((a) => a.getAttribute('href'));
const dismissButtons = (container: HTMLElement) =>
	container.querySelectorAll('form button[type="submit"]');

describe('SetupSteps', () => {
	it('links every step a band with only a name has left', async () => {
		const { container } = await render(SetupSteps, {
			slug: 'porchlights',
			steps: [
				step('invite', false),
				step('reserve', false),
				step('profile', false),
				step('event', false)
			]
		});

		expect(hrefs(container)).toEqual([
			'/band/porchlights/invite',
			'/band/porchlights/reserve',
			'/band/porchlights/profile',
			'/band/porchlights/event'
		]);
	});

	it('ticks a done step and drops its link', async () => {
		const { container } = await render(SetupSteps, {
			slug: 'porchlights',
			steps: [
				step('invite', true),
				step('reserve', false),
				step('profile', true),
				step('event', false)
			]
		});

		expect(hrefs(container)).toEqual(['/band/porchlights/reserve', '/band/porchlights/event']);
		expect(container.querySelectorAll('[data-done]')).toHaveLength(2);
	});

	it('offers Dismiss only on a dismissible step', async () => {
		const offered = await render(SetupSteps, {
			slug: 'porchlights',
			steps: [step('invite', false, true), step('reserve', false)]
		});
		expect(dismissButtons(offered.container)).toHaveLength(1);

		const none = await render(SetupSteps, {
			slug: 'porchlights',
			steps: [step('invite', false), step('reserve', false)]
		});
		expect(dismissButtons(none.container)).toHaveLength(0);
	});
});
