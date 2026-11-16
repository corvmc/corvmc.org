import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import '#lib/test/locators.js';

/**
 * The For choice decides which booking remote the dialog submits: Me books on
 * member terms, a band through its own guard, Teaching on instructor terms.
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

vi.mock('#lib/remote/reservations.remote.js', () => ({
	bookAndPayReservation: fakeRemote('?/user'),
	bookBandReservation: fakeRemote('?/group'),
	bookInstructorReservation: fakeRemote('?/instructor'),
	// Nothing bookable, so the date step renders its empty state and asks no more.
	getAvailableDates: vi.fn(() => Promise.resolve({ dates: [] })),
	getReservationStartTimes: vi.fn(),
	getReservationEndTimes: vi.fn(),
	getReservationPricing: vi.fn(),
	previewRecurringInstances: vi.fn()
}));
vi.mock('#lib/remote/inbox.remote.js', () => ({ startConversation: { for: () => ({}) } }));
// `FormGuard`, which `<Form>` always imports, reaches for `beforeNavigate`.
vi.mock('$app/navigation', () => ({
	refreshAll: vi.fn(),
	goto: vi.fn(),
	beforeNavigate: vi.fn()
}));

const { default: BookingDialog, bookersFor } = await import('./BookingDialog.svelte');

const bookers = bookersFor({
	isSustaining: false,
	bands: [
		{ slug: 'duo', name: 'Duo', hasSustainingMember: true },
		{ slug: 'trio', name: 'Trio', hasSustainingMember: false }
	],
	isInstructor: true
});

async function open(props: Record<string, unknown>) {
	await render(BookingDialog, { 'data-testid': 'book', ...props } as never);
	await page.getByTestId('book').click();
}

const forSelect = () => page.getByCss('#booking-for');
const submitsTo = () =>
	page.getByCss('dialog form, [role="dialog"] form').element().getAttribute('action');

describe('BookingDialog', () => {
	it('asks nothing when the member books only for themselves', async () => {
		await open({ bookers: bookersFor({ isSustaining: false, bands: [], isInstructor: false }) });

		await expect.element(page.getByCss('[role="dialog"] form')).toBeInTheDocument();
		expect(forSelect().query()).toBeNull();
		expect(submitsTo()).toBe('?/user');
	});

	it('offers Me, each band and Teaching, starting on Me', async () => {
		await open({ bookers });

		await expect.element(forSelect()).toHaveValue('user');
		const offered = [...(forSelect().element() as HTMLSelectElement).options].map((o) => o.value);
		expect(offered).toEqual(['user', 'group:duo', 'group:trio', 'instructor']);
		expect(submitsTo()).toBe('?/user');
	});

	it("opens on the band whose page it is on, and books through the band's remote", async () => {
		await open({ bookers, initial: 'trio' });

		await expect.element(forSelect()).toHaveValue('group:trio');
		expect(submitsTo()).toBe('?/group');
	});

	it('switches the remote when the member changes For', async () => {
		await open({ bookers, initial: 'duo' });

		await forSelect().selectOptions('instructor');
		await expect.poll(submitsTo).toBe('?/instructor');

		await forSelect().selectOptions('user');
		await expect.poll(submitsTo).toBe('?/user');
	});

	it('starts on Me when the page’s band is not one the member may book for', async () => {
		await open({ bookers, initial: 'someone-elses-band' });

		await expect.element(forSelect()).toHaveValue('user');
	});
});
