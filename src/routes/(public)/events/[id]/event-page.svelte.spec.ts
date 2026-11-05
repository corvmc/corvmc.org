import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

const fixture = vi.hoisted(() => ({
	detail: null as unknown,
	rsvp: null as unknown
}));

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

vi.mock('$env/dynamic/public', () => ({ env: {} }));
vi.mock('#lib/remote/events.remote.js', () => ({
	getPublicEventDetail: remote(() => fixture.detail)
}));
vi.mock('#lib/remote/event-rsvp.remote.js', () => ({
	getRsvpStatus: remote(() => fixture.rsvp),
	confirmRsvp: remote(),
	withdrawRsvp: remote()
}));
vi.mock('#lib/remote/flags.remote.js', () => ({ submitEventReport: remote() }));
vi.mock('#lib/remote/event-photos.remote.js', () => ({ uploadEventPhotos: remote() }));
vi.mock('#lib/remote/market.remote.js', () => ({ getPublicMarket: remote() }));
vi.mock('$app/state', async (original) => ({
	...(await original<Record<string, unknown>>()),
	page: { params: { id: 'evt-1' }, url: new URL('http://localhost/events/evt-1') }
}));

const EventPage = (await import('./+page.svelte')).default;

const MEMBER = 'Fixture Member';

function detail(overrides: Record<string, unknown> = {}) {
	return {
		event: {
			id: 'evt-1',
			title: 'Fixture Night',
			description: null,
			kind: 'show',
			source: 'cmc',
			status: 'published',
			tags: 'workshop, all ages',
			startsAt: new Date('2031-05-10T03:00:00Z'),
			endsAt: null,
			doorsAt: null,
			location: null,
			address: null,
			posterUrl: null,
			ticketingEnabled: false,
			ticketPrice: null,
			ticketQuantity: null,
			externalTicketUrl: null,
			bandName: null,
			bandSlug: null,
			lineup: [],
			setTimes: [],
			...overrides
		},
		remaining: null,
		sold: null,
		isPast: false,
		canReport: false,
		rsvpCount: 0,
		sponsors: [],
		photos: [],
		recapHtml: null,
		recapUpload: null,
		upcoming: []
	};
}

const stickers = () => [...document.querySelectorAll('.edet__tags .sticker')];
const tape = () => document.querySelector('.polaroid__tape');

beforeEach(() => {
	fixture.detail = detail();
	fixture.rsvp = { state: 'signed-out', reason: null, attendee: null };
});

// The poster's tape carries the first tag, so the sticker row carries the rest.
describe('event page tags', () => {
	it('does not repeat the tape tag as a sticker, and keeps the others', async () => {
		await render(EventPage);
		await expect.element(page.getByRole('heading', { level: 1 })).toBeVisible();

		expect(tape()?.textContent?.trim()).toBe('workshop');
		expect(stickers().map((s) => s.textContent?.trim())).toEqual(['all ages']);
	});

	it('renders no sticker row when the tape holds the only tag', async () => {
		fixture.detail = detail({ tags: 'workshop' });
		await render(EventPage);
		await expect.element(page.getByRole('heading', { level: 1 })).toBeVisible();

		expect(tape()?.textContent?.trim()).toBe('workshop');
		expect(document.querySelector('.edet__tags')).toBeNull();
	});
});

// Neither test names the words around the name, only that it moved into the button.
describe('event page RSVP button', () => {
	const ctas = () => document.querySelector('.edet__ctas')!;
	const textOutsideButtons = () => {
		const clone = ctas().cloneNode(true) as HTMLElement;
		clone.querySelectorAll('button, a').forEach((b) => b.remove());
		return clone.textContent ?? '';
	};

	it.each([
		['a member', false],
		['a member, tickets sold off-site', true]
	])('carries the name inside the button for %s', async (_case, external) => {
		fixture.detail = detail(external ? { externalTicketUrl: 'https://tickets.example/x' } : {});
		fixture.rsvp = {
			state: 'open',
			reason: null,
			attendee: { name: MEMBER, email: 'member@example.test' }
		};
		await render(EventPage);
		const submit = page.getByRole('button').and(page.getByText(MEMBER));
		await expect.element(submit).toBeVisible();

		expect(submit.element().getAttribute('type')).toBe('submit');
		expect(textOutsideButtons()).not.toContain(MEMBER);
	});

	it('names nobody when signed out', async () => {
		await render(EventPage);
		await expect.element(page.getByRole('heading', { level: 1 })).toBeVisible();
		await vi.waitFor(() =>
			expect(ctas().querySelector('a[href^="/login?"], button')).not.toBeNull()
		);

		expect(ctas().textContent).not.toContain(MEMBER);
	});

	it('leaves the name off once the member is going', async () => {
		fixture.rsvp = {
			state: 'going',
			reason: null,
			attendee: { name: MEMBER, email: 'member@example.test' }
		};
		await render(EventPage);
		await expect.element(page.getByTestId('rsvp-going')).toBeVisible();

		expect(ctas().textContent).not.toContain(MEMBER);
	});
});
