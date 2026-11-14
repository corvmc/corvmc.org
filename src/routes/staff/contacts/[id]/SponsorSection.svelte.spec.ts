import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

/** A sponsor's page calls out a term that has run out and not been ended or renewed. */

const ship = (id: string, overdue: boolean) => ({
	id,
	title: `Term ${id}`,
	status: 'active',
	tier: null,
	projectId: null,
	nextTask: null,
	startsOn: '2026-01-01',
	endsOn: '2026-06-30',
	amountCents: null,
	deadline: { kind: 'end', on: '2026-06-30', overdue }
});
let sponsorships = [ship('spring', false)];

const remoteForm = () => {
	const fields: unknown = new Proxy(
		{ allIssues: () => null },
		{
			get: (target, name: string) =>
				name in target
					? target[name as keyof typeof target]
					: { as: (type: string, value = '') => ({ type, name, value }), issues: () => null }
		}
	);
	const form = {
		enhance: () => ({ method: 'POST', action: '?/x' }),
		fields,
		result: undefined,
		for: () => form
	};
	return form;
};

vi.mock('#lib/remote/sponsors.remote.js', () => ({
	getSponsorDetail: async () => ({
		id: 'sp-1',
		name: 'Sponsor',
		logoUrl: null,
		projects: [],
		placements: [],
		sponsorships
	}),
	createSponsorship: remoteForm(),
	updateSponsorship: remoteForm(),
	deleteSponsorship: remoteForm(),
	placeSponsorship: remoteForm(),
	removePlacement: remoteForm(),
	setSponsorLogo: remoteForm(),
	removeSponsorLogo: remoteForm()
}));
vi.mock('$app/navigation', () => ({
	refreshAll: vi.fn(),
	goto: vi.fn(),
	beforeNavigate: vi.fn()
}));

const SponsorSection = (await import('./SponsorSectionHarness.svelte')).default;

const alerts = () => [...document.querySelectorAll('[role="alert"]')].map((a) => a.textContent);

describe('SponsorSection', () => {
	it('names a lapsed term in an alert', async () => {
		sponsorships = [ship('spring', false), ship('lapsed', true)];
		await render(SponsorSection, { id: 'sp-1' });

		await vi.waitFor(() => expect(document.querySelectorAll('tbody tr')).toHaveLength(2));
		expect(document.querySelector('[data-harness-failed]')).toBeNull();
		const shown = alerts();
		expect(shown).toHaveLength(1);
		expect(shown[0]).toContain('Term lapsed');
	});

	it('raises no alert while every term is current', async () => {
		document.body.innerHTML = '';
		sponsorships = [ship('spring', false)];
		await render(SponsorSection, { id: 'sp-1' });

		await vi.waitFor(() => expect(document.querySelectorAll('tbody tr')).toHaveLength(1));
		expect(alerts()).toEqual([]);
	});
});
