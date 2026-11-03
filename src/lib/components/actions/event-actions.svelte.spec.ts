import { page, type Locator } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import '$lib/test/locators';

// One file for the staff event actions: they mock the same two modules, and each
// export below is the stub its own component's spec used before the merge.
const issues: Record<string, { path: string[]; message: string }[] | null> = {};

const impact = {
	deletable: true,
	rsvpCount: 0,
	lineupCount: 0,
	hasReservation: false
};

let blockers: string[] = [];

/** Each action's trigger is its render container's only button; dialogs portal out. */
let screen: Locator;
const mount = async (...args: Parameters<typeof render>) => {
	screen = (await render(...args)).locator;
};
const trigger = () => screen.getByRole('button');
const items = () => page.getByRole('dialog').getByRole('listitem');

vi.mock('$lib/remote/events.remote', () => {
	const field = (name: string) => ({
		as: (type: string, value?: unknown) => ({ type, name, value }),
		issues: () => issues[name] ?? null
	});
	const form = (action: string, names: string[]) => ({
		enhance: () => ({ method: 'POST', action: `?/${action}` }),
		fields: {
			...Object.fromEntries(names.map((name) => [name, field(name)])),
			allIssues: () => null
		},
		result: undefined
	});
	return {
		compTickets: form('compTickets', ['eventId', 'attendeeName', 'attendeeEmail', 'quantity']),
		deleteEvent: form('deleteEvent', ['id']),
		getEventDeletionImpact: vi.fn(async () => impact),
		publishEvent: form('publishEvent', ['id', 'reason']),
		getEventPublishBlockers: vi.fn(async () => blockers)
	};
});

// `FormGuard`, which `<Form>` always imports, reaches for `beforeNavigate`; a
// partial mock of this module is a missing-export error at import time rather
// than at the call.
vi.mock('$app/navigation', () => ({
	invalidateAll: vi.fn(),
	goto: vi.fn(),
	beforeNavigate: vi.fn()
}));

const CompTicketsAction = (await import('./CompTicketsAction.svelte')).default;
const DeleteEventAction = (await import('./DeleteEventAction.svelte')).default;
const PublishEventAction = (await import('./PublishEventAction.svelte')).default;

/**
 * Comping tickets is the one path that issues tickets without a payment, and
 * the handler rejects a quantity outside 1–50 with a field issue. A bare input
 * rendered that issue as `aria-invalid` alone, so an over-count read as a
 * submit that did nothing.
 */
describe('CompTicketsAction', () => {
	it('renders the quantity rejection as a message', async () => {
		const message = 'Quantity must be between 1 and 50';
		issues.quantity = [{ path: ['quantity'], message }];
		try {
			await mount(CompTicketsAction, { eventId: 'event-7' });
			await trigger().click();

			await expect.element(page.getByRole('dialog').getByText(message)).toBeVisible();
		} finally {
			issues.quantity = null;
		}
	});
});

/**
 * The only action that decides whether it is an action at all. An event with
 * tickets cannot be deleted, and the button knows before it is pressed — a
 * live-looking control that fails after the click is the worse of the two, and
 * the impact list is the only place a staffer learns what else goes with it.
 */
describe('DeleteEventAction', () => {
	const withImpact = (patch: Partial<typeof impact>) => Object.assign(impact, patch);
	const reset = () =>
		withImpact({ deletable: true, rsvpCount: 0, lineupCount: 0, hasReservation: false });

	const open = async () => {
		await mount(DeleteEventAction, { eventId: 'event-7' });
		await trigger().click();
		return page.getByRole('dialog');
	};

	// Rendered as a disabled control rather than hidden, and the reason lives on
	// it: cancelling — which voids the tickets and tells the holders — is what
	// should happen instead.
	it('refuses before the click when the event has tickets', async () => {
		reset();
		withImpact({ deletable: false });
		try {
			await mount(DeleteEventAction, { eventId: 'event-7' });

			await expect.element(trigger()).toBeDisabled();
			expect(trigger().element().getAttribute('title')).toBeTruthy();
		} finally {
			reset();
		}
	});

	it('says nothing about collateral when there is none', async () => {
		reset();
		const dialog = await open();
		await expect.element(dialog).toBeVisible();

		expect(dialog.getByRole('alert').query()).toBeNull();
		expect(items().elements()).toHaveLength(0);
	});

	// A lineup credit is somebody else's record of having played. Deleting the
	// show takes it off their profile, which nothing else on this screen says.
	it('names what else the deletion takes with it', async () => {
		reset();
		withImpact({ rsvpCount: 3, lineupCount: 1, hasReservation: true });
		try {
			await expect.element(await open()).toBeVisible();

			// One item each: RSVPs, lineup credits, then the space booking.
			await expect.poll(() => items().elements().length).toBe(3);
			await expect.element(items().nth(0)).toMatchTextContent(String(impact.rsvpCount));
			await expect.element(items().nth(1)).toMatchTextContent(String(impact.lineupCount));
		} finally {
			reset();
		}
	});

	// "1 RSVPs" in a warning about permanent deletion reads as a template that
	// nobody checked.
	it('counts a single RSVP in the singular', async () => {
		reset();
		// The item with its count masked: the singular must not be the plural.
		const itemFor = async (rsvpCount: number) => {
			withImpact({ rsvpCount });
			const screen = await render(DeleteEventAction, { eventId: 'event-7' });
			await screen.locator.getByRole('button').click();
			await expect.element(items().first()).toBeVisible();
			const text = items().first().element().textContent?.trim() ?? '';
			await screen.unmount();
			await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
			return text.replace(String(rsvpCount), '#');
		};
		try {
			const one = await itemFor(1);
			const two = await itemFor(2);

			expect(one).not.toBe(two);
		} finally {
			reset();
		}
	});
});

/**
 * Readiness before the click. The blockers are fetched when the button
 * renders, not discovered by a publish that fails — and an event announced to
 * the public cannot be un-announced, so the modal has to say what is missing
 * instead of asking for a confirmation it would then refuse.
 */
describe('PublishEventAction', () => {
	const open = async (missing: string[]) => {
		blockers = missing;
		await mount(PublishEventAction, { eventId: 'event-3' });
		await trigger().click();
		return page.getByRole('dialog');
	};

	/** Action's own footer button. */
	const submit = () => page.getByRole('dialog').getByCss('button[type="submit"]');
	const reason = () => page.getByRole('dialog').getByCss('[name="reason"]');

	it('asks for a confirmation when nothing is missing', async () => {
		const dialog = await open([]);
		await expect.element(dialog).toBeVisible();

		await expect.element(submit()).toBeEnabled();
		expect(dialog.getByRole('alert').query()).toBeNull();
		expect(reason().query()).toBeNull();
	});

	// Every warning, not the first one: a staffer who fixes the poster and comes
	// back to find the venue still missing has been sent round twice. Warnings do
	// not refuse (#1787): a reason lets the publish through.
	it('lists what is missing and offers to publish anyway with a reason', async () => {
		const missing = ['No poster', 'No venue'];
		const dialog = await open(missing);
		await expect.element(dialog).toBeVisible();

		await expect.element(dialog.getByRole('alert')).toBeVisible();
		for (const blocker of missing) await expect.element(dialog.getByText(blocker)).toBeVisible();
		await expect.element(reason()).toBeVisible();
		await expect.element(submit()).toBeEnabled();
	});
});
