import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import '#lib/test/locators.js';

/**
 * The For choice decides which create remote the form submits (#3132): Me is a
 * community listing, a band is that band's event through its own guard.
 */

const fakeRemote = (action: string) => {
	const field = (name: string) => ({
		as: (type: string, value?: unknown) => ({ type, name, value }),
		issues: () => null,
		value: () => undefined
	});
	return {
		enhance: () => ({ method: 'POST', action }),
		fields: new Proxy({ allIssues: () => null, set: () => {} } as Record<string, unknown>, {
			get: (target, key: string) => target[key] ?? field(key)
		}),
		result: undefined
	};
};

vi.mock('#lib/remote/community-events.remote.js', () => ({
	createListing: fakeRemote('?/listing')
}));
vi.mock('#lib/remote/band-events.remote.js', () => ({
	createBandEventForm: fakeRemote('?/band')
}));
// `FormGuard`, which `<Form>` always imports, reaches for `beforeNavigate`.
vi.mock('$app/navigation', () => ({
	refreshAll: vi.fn(),
	goto: vi.fn(),
	beforeNavigate: vi.fn()
}));

const { default: CreateMemberEventAction, eventHosts } =
	await import('./CreateMemberEventAction.svelte');

const hosts = eventHosts([
	{ slug: 'duo', name: 'Duo', role: 'owner' },
	{ slug: 'trio', name: 'Trio', role: 'admin' },
	{ slug: 'quartet', name: 'Quartet', role: 'member' }
]);

async function open(props: Record<string, unknown>) {
	await render(CreateMemberEventAction, { 'data-testid': 'create-event', ...props } as never);
	await page.getByTestId('create-event').click();
}

const forSelect = () => page.getByCss('#event-for');
const form = () => page.getByCss('[role="dialog"] form');
const submitsTo = () => form().element().getAttribute('action');
const bandSlug = () => form().element().querySelector('input[name="slug"]')?.getAttribute('value');

describe('CreateMemberEventAction', () => {
	it('offers only the bands the member owns or administers', () => {
		expect(hosts.map((h) => h.slug)).toEqual(['duo', 'trio']);
	});

	it('asks nothing when the member creates only for themselves', async () => {
		await open({ hosts: [] });

		await expect.element(form()).toBeInTheDocument();
		expect(forSelect().query()).toBeNull();
		expect(submitsTo()).toBe('?/listing');
	});

	it('starts on Me in the member panel, with each band offered', async () => {
		await open({ hosts });

		await expect.element(forSelect()).toHaveValue('');
		const offered = [...forSelect().element().querySelectorAll('option')].map((o) => o.value);
		expect(offered).toEqual(['', 'duo', 'trio']);
		expect(submitsTo()).toBe('?/listing');
	});

	it("opens on the band whose page it is on, and creates through the band's remote", async () => {
		await open({ hosts, initial: 'trio' });

		await expect.element(forSelect()).toHaveValue('trio');
		expect(submitsTo()).toBe('?/band');
		expect(bandSlug()).toBe('trio');
	});

	it('asks the same fields whoever the event is for', async () => {
		await open({ hosts, initial: 'duo' });
		const names = () =>
			[...form().element().querySelectorAll('input:not([type="hidden"])')].map((i) =>
				i.getAttribute('name')
			);
		const forBand = names();

		await forSelect().selectOptions('');
		await expect.poll(submitsTo).toBe('?/listing');
		expect(names()).toEqual(forBand);
	});
});
