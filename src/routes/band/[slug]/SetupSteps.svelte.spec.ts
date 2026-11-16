import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import SetupSteps from './SetupSteps.svelte';
import type { BandSetupStep } from '#lib/types/band-dashboard.js';

// A new band's first steps (#3134): each open one links to its page, a done one does not.

const step = (key: BandSetupStep['key'], done: boolean): BandSetupStep => ({
	key,
	done,
	href: `/band/porchlights/${key}` as BandSetupStep['href']
});

const hrefs = (container: HTMLElement) =>
	[...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));

describe('SetupSteps', () => {
	it('links every step a band with only a name has left', async () => {
		const { container } = await render(SetupSteps, {
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
});
