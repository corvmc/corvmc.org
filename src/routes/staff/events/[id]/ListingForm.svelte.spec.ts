import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

vi.mock('#lib/remote/events.remote.js', () => {
	const field = (name: string) => ({
		as: (type: string, value?: unknown) => ({ type, name, value }),
		issues: () => null
	});
	const fields = new Proxy({ allIssues: () => null } as Record<string, unknown>, {
		get: (target, key: string) => target[key] ?? field(key)
	});
	return {
		updateEvent: {
			enhance: () => ({ method: 'POST', action: '?/updateEvent' }),
			fields,
			result: undefined
		},
		checkRebook: vi.fn(async () => ({ needed: false })),
		checkConflicts: vi.fn(async () => ({ conflicts: [] }))
	};
});

vi.mock('#lib/remote/external-acts.remote.js', () => ({ searchBillActs: vi.fn(async () => []) }));

// `FormGuard`, which `<Form>` always imports, reaches for `beforeNavigate`; the
// anchors' focus handler for `afterNavigate`.
vi.mock('$app/navigation', () => ({
	refreshAll: vi.fn(),
	goto: vi.fn(),
	beforeNavigate: vi.fn(),
	afterNavigate: vi.fn()
}));

const ListingForm = (await import('./ListingForm.svelte')).default;

function listing(source: string, ticketingEnabled: boolean) {
	return {
		id: 'evt-1',
		title: 'A show',
		description: null,
		tags: null,
		kind: 'show',
		source,
		location: null,
		address: null,
		venueId: null,
		externalTicketUrl: null,
		startsAt: new Date('2026-11-14T03:00:00Z'),
		endsAt: new Date('2026-11-14T06:00:00Z'),
		doorsAt: null,
		ticketingEnabled,
		ticketPrice: 1500,
		ticketPriceFloorCents: 0,
		ticketQuantity: 80
	};
}

const props = (source: string, ticketingEnabled: boolean) => ({
	event: listing(source, ticketingEnabled),
	lineup: [{ id: 'act-1', name: 'The Openers', bandId: null, actId: null }],
	linkedReservation: null,
	venues: [],
	onsaved: () => {}
});

const posted = (container: Element, name: string) =>
	container.querySelector<HTMLInputElement>(`input:is([name="${name}"], [name^="${name}/"])`);
const choice = (container: Element, value: string) =>
	container.querySelector<HTMLInputElement>(`input[type="radio"][value="${value}"]`);

describe('ListingForm ticketing', () => {
	// A premium band sells its own gig through the collective (#1556). A staff
	// edit that posted `ticketingEnabled=false` closed that sale and dropped its
	// capacity, so the flag is not posted at all for a listing CMC doesn't sell.
	it("leaves a band's own sale alone", async () => {
		const { container, locator } = await render(ListingForm, props('band', true));

		await expect.element(locator.getByRole('textbox').first()).toBeVisible();
		expect(posted(container, 'ticketingEnabled')).toBeNull();
		expect(posted(container, 'ticketQuantity')).toBeNull();
		expect(choice(container, 'cmc')).toBeNull();
		expect(choice(container, 'link')).toBeNull();
	});

	it('offers a CMC listing the sale, and posts it', async () => {
		const { container, locator } = await render(ListingForm, props('cmc', true));

		await expect.element(locator.getByRole('textbox').first()).toBeVisible();
		expect(choice(container, 'cmc')?.checked).toBe(true);
		expect(posted(container, 'ticketingEnabled')).not.toBeNull();
		expect(container.querySelector<HTMLInputElement>('#ticketQuantity')?.value).toBe('80');
	});

	it('offers a community listing no sale of ours', async () => {
		const { container, locator } = await render(ListingForm, props('community', false));

		await expect.element(locator.getByRole('textbox').first()).toBeVisible();
		expect(choice(container, 'link')).not.toBeNull();
		expect(choice(container, 'cmc')).toBeNull();
	});
});

// #2126: the record is editable once cancelled; the sale and the room are not.
describe('ListingForm on a cancelled listing', () => {
	it('offers no ticket terms and no space hold', async () => {
		const { container, locator } = await render(ListingForm, {
			...props('cmc', true),
			cancelled: true
		});

		await expect.element(locator.getByRole('textbox').first()).toBeVisible();
		expect(container.querySelector('#ticketPrice')).toBeNull();
		expect(posted(container, 'ticketQuantity')).toBeNull();
		expect(posted(container, 'ticketingEnabled')).toBeNull();
		expect(choice(container, 'cmc')).toBeNull();
		expect(container.querySelector('[data-testid="reserve-space"]')).toBeNull();
	});

	it('is read-only without the right to correct it', async () => {
		const { container, locator } = await render(ListingForm, {
			...props('cmc', true),
			cancelled: true,
			readOnly: true
		});

		await expect.element(locator.getByRole('textbox').first()).toBeVisible();
		expect(container.querySelector('fieldset[disabled]')).not.toBeNull();
		expect(container.querySelector('button[type="submit"]')).toBeNull();
	});
});

// #2133: venue name and street address are two inputs, each seeded from its own column.
describe('ListingForm place fields', () => {
	it('posts the venue as location and the street address as address', async () => {
		const base = props('band', false);
		const { container, locator } = await render(ListingForm, {
			...base,
			event: { ...base.event, location: 'Bombs Away Cafe', address: '2527 NW Monroe Ave' }
		});

		await expect.element(locator.getByRole('textbox').first()).toBeVisible();
		expect(choice(container, 'other')?.checked).toBe(true);
		expect(posted(container, 'location')?.value).toBe('Bombs Away Cafe');
		expect(posted(container, 'address')?.value).toBe('2527 NW Monroe Ave');
	});
});

// #3355's Publish warning links to these, and focus-hash focuses the field inside.
describe('ListingForm anchors', () => {
	it('names the title, date and description', async () => {
		const { container, locator } = await render(ListingForm, props('cmc', false));

		await expect.element(locator.getByRole('textbox').first()).toBeVisible();
		for (const anchor of ['listing-title', 'listing-date', 'listing-description']) {
			expect(container.querySelector(`#${anchor} :is(input, textarea)`)).not.toBeNull();
		}
	});
});

describe('ListingForm performers', () => {
	it("leaves a CMC show's bill to Production", async () => {
		const { container, locator } = await render(ListingForm, props('cmc', false));

		await expect.element(locator.getByRole('textbox').first()).toBeVisible();
		expect(posted(container, 'lineup')).toBeNull();
		expect(container.querySelector('a[href*="tab=production"]')).not.toBeNull();
	});

	it("edits a community listing's bill in the same form", async () => {
		const { container, locator } = await render(ListingForm, props('community', false));

		await expect.element(locator.getByRole('textbox').first()).toBeVisible();
		expect(posted(container, 'lineup')).not.toBeNull();
		expect(container.querySelector('a[href*="tab=production"]')).toBeNull();
	});
});
