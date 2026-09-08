import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

/**
 * The only action that decides whether it is an action at all. An event with
 * tickets cannot be deleted, and the button knows before it is pressed — a
 * live-looking control that fails after the click is the worse of the two, and
 * the impact list is the only place a staffer learns what else goes with it.
 */

const impact = {
	deletable: true,
	rsvpCount: 0,
	lineupCount: 0,
	hasReservation: false
};

vi.mock('$lib/remote/events.remote', () => {
	const field = (name: string) => ({
		as: (type: string, value?: unknown) => ({ type, name, value }),
		issues: () => null
	});
	return {
		deleteEvent: {
			enhance: () => ({ method: 'POST', action: '?/deleteEvent' }),
			fields: { id: field('id'), allIssues: () => null },
			result: undefined
		},
		getEventDeletionImpact: vi.fn(async () => impact)
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

const DeleteEventAction = (await import('./DeleteEventAction.svelte')).default;

const withImpact = (patch: Partial<typeof impact>) => Object.assign(impact, patch);

const reset = () =>
	withImpact({ deletable: true, rsvpCount: 0, lineupCount: 0, hasReservation: false });

const trigger = () => page.getByRole('button', { name: 'Delete' }).first();

const open = async () => {
	await render(DeleteEventAction, { eventId: 'event-7' });
	await trigger().click();
	return page.getByRole('dialog');
};

describe('DeleteEventAction', () => {
	// Without this the deletion names no event and the handler deletes nothing.
	it('carries the event id into the form', async () => {
		reset();
		await expect.element(await open()).toBeVisible();

		const hidden = document.querySelector(
			'[role="dialog"] input[name="id"]'
		) as unknown as HTMLInputElement;
		expect(hidden.type).toBe('hidden');
		expect(hidden.value).toBe('event-7');
	});

	/**
	 * Rendered as a disabled control rather than hidden, and the reason lives on
	 * it: "why can't I delete this?" is worth answering in place, and cancelling
	 * — which voids the tickets and tells the holders — is what should happen
	 * instead.
	 */
	it('refuses before the click when the event has tickets', async () => {
		reset();
		withImpact({ deletable: false });
		try {
			await render(DeleteEventAction, { eventId: 'event-7' });

			await expect.element(trigger()).toBeDisabled();
			// `toHaveAttribute` compares exactly, so the reason is read off the
			// element rather than matched — the sentence is long and its point is
			// the alternative it names, not its wording.
			expect(trigger().element().getAttribute('title')).toContain('cancel it instead');
		} finally {
			reset();
		}
	});

	it('says nothing about collateral when there is none', async () => {
		reset();
		await expect.element(await open()).toBeVisible();

		expect(document.body.textContent).not.toContain('Deleting also removes');
	});

	// A lineup credit is somebody else's record of having played. Deleting the
	// show takes it off their profile, which nothing else on this screen says.
	it('names what else the deletion takes with it', async () => {
		reset();
		withImpact({ rsvpCount: 3, lineupCount: 1, hasReservation: true });
		try {
			await expect.element(await open()).toBeVisible();

			await expect.element(page.getByText('3 RSVPs')).toBeVisible();
			await expect.element(page.getByText('1 lineup credit', { exact: false })).toBeVisible();
			await expect.element(page.getByText('the space booking is released')).toBeVisible();
		} finally {
			reset();
		}
	});

	// "1 RSVPs" in a warning about permanent deletion reads as a template that
	// nobody checked.
	it('counts a single RSVP in the singular', async () => {
		reset();
		withImpact({ rsvpCount: 1 });
		try {
			await expect.element(await open()).toBeVisible();

			await expect.element(page.getByText('1 RSVP', { exact: true })).toBeVisible();
		} finally {
			reset();
		}
	});
});
