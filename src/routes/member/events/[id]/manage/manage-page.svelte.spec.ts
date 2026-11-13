import { page, userEvent } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

const fixture = vi.hoisted(() => ({ listing: null as unknown }));

// One stand-in for every remote: callable as a query, shaped as a form.
const remote = vi.hoisted(() => (value: () => unknown = () => undefined) => {
	const fields = new Proxy({ allIssues: () => null } as Record<string, unknown>, {
		get: (target, key: string) =>
			target[key] ?? {
				as: (type: string, v?: unknown) => ({ type, name: key, value: v }),
				issues: () => null,
				value: () => undefined
			}
	});
	const fn = Object.assign(
		() => Object.assign(Promise.resolve(value()), { refresh: () => Promise.resolve() }),
		{ enhance: () => ({ method: 'POST' }), fields, result: undefined, pending: 0 }
	);
	return Object.assign(fn, { for: () => fn });
});

vi.mock('#lib/remote/community-events.remote.js', () => ({
	getMyListingPage: remote(() => ({ listing: fixture.listing, duplicate: null })),
	searchBandsForListing: remote(() => []),
	updateListing: remote(),
	publishListing: remote(),
	unpublishListing: remote(),
	withdrawListing: remote(),
	deleteListing: remote()
}));
vi.mock('$app/navigation', () => ({
	goto: vi.fn(),
	refreshAll: vi.fn(),
	beforeNavigate: vi.fn()
}));
vi.mock('$app/state', async (original) => ({
	...(await original<Record<string, unknown>>()),
	page: {
		params: { id: 'evt-1' },
		url: new URL('http://localhost/member/events/evt-1/manage')
	}
}));

const ManagePage = (await import('./+page.svelte')).default;

function listing(status: string) {
	return {
		id: 'evt-1',
		title: 'Fixture Night',
		description: null,
		status,
		reviewNotes: null,
		standing: { status: 'none', reason: null },
		lineup: [],
		startsAt: new Date('2031-05-10T03:00:00Z'),
		endsAt: null,
		doorsAt: null,
		location: 'Fixture Hall',
		address: null,
		tags: null,
		posterUrl: null,
		externalTicketUrl: null,
		ticketPrice: null
	};
}

async function edit() {
	const title = page.getByRole('textbox').first();
	await userEvent.type(title, ' II');
}

describe('member event form', () => {
	beforeEach(() => {
		fixture.listing = listing('draft');
	});

	it('offers Publish on a draft with nothing to save', async () => {
		await render(ManagePage);
		await expect.element(page.getByTestId('publish-listing')).toBeVisible();
		await expect.element(page.getByTestId('save-listing')).not.toBeInTheDocument();
		await expect.element(page.getByTestId('unsaved-changes')).not.toBeInTheDocument();
	});

	it('puts Save in Publish’s place once the draft is edited', async () => {
		await render(ManagePage);
		await expect.element(page.getByTestId('publish-listing')).toBeVisible();
		await edit();

		await expect.element(page.getByTestId('save-listing')).toBeVisible();
		await expect.element(page.getByTestId('unsaved-changes')).toBeVisible();
		await expect.element(page.getByTestId('publish-listing')).not.toBeInTheDocument();
		// Outside the form in the header, it still submits the form being edited.
		const save = page.getByTestId('save-listing').element() as HTMLButtonElement;
		expect(save.form?.contains(page.getByRole('textbox').first().element())).toBe(true);
	});

	it('shows Save on a published event only while there are changes', async () => {
		fixture.listing = listing('published');
		await render(ManagePage);
		await expect.element(page.getByTestId('save-listing')).not.toBeInTheDocument();
		await edit();
		await expect.element(page.getByTestId('save-listing')).toBeVisible();
	});
});
