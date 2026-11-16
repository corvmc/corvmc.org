import { page, userEvent, type Locator } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { TICKET_COLLECTIVE_SHARE_BPS } from '#lib/config.js';
import '#lib/test/locators.js';

/**
 * What a buyer reads on the sliding scale before they commit. The server
 * re-derives the charge with the same `ticket-split` module (its spec pins the
 * arithmetic); this pins that the page previews it: the opening amounts, the
 * split bar's bounds, the fee offer, and which amounts the page refuses.
 */

// `FormGuard`, which `<Form>` always imports, reaches for `beforeNavigate`.
vi.mock('$app/navigation', () => ({
	refreshAll: vi.fn(),
	goto: vi.fn(),
	beforeNavigate: vi.fn()
}));

const Harness = (await import('./TicketPurchaseFields.test.svelte')).default;

const field = (name: string) => ({
	as: (type: string, value?: unknown) => ({ type, name, value }),
	issues: () => null
});
const remote = {
	enhance: () => ({ method: 'POST', action: '?/purchase' }),
	fields: new Proxy({ allIssues: () => null } as Record<string, unknown>, {
		get: (target, key: string) => target[key] ?? field(key)
	}),
	result: undefined
};

/** $20, the scale running to free: the public page's common case. */
const SUGGESTED = 2000;

async function mount(props: { floorCents?: number; suggestedUnitCents?: number } = {}) {
	return render(Harness, {
		remote: remote as never,
		suggestedUnitCents: props.suggestedUnitCents ?? SUGGESTED,
		floorCents: props.floorCents ?? 0,
		quantity: 1,
		acts: ['The Openers', 'The Headliners'],
		collectiveShareBps: TICKET_COLLECTIVE_SHARE_BPS
	});
}

const amount = () => page.getByCss('#ticketAmount');
const slider = () => page.getByRole('slider');
const submit = () => page.getByCss('button[type="submit"]');
const total = () => page.getByTestId('purchase-total');
/** The collective's share the form posts: the money value the buyer chose. */
const postedCollective = () =>
	document.querySelector<HTMLInputElement>('input[name="collectiveCents"]')!;
/** An amount as the page prints it: 91 → "$0.91". Amounts are state, not copy. */
const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** Matchers here compare a string attribute or text exactly; these wait for a part of it. */
const valueText = (pattern: RegExp) =>
	vi.waitFor(() => expect(slider().element().getAttribute('aria-valuetext')).toMatch(pattern));
const contains = (locator: Locator, text: string) =>
	vi.waitFor(() => expect(locator.element().textContent).toContain(text));

async function pay(dollars: string) {
	await userEvent.fill(amount(), dollars);
}

describe('TicketPurchaseFields', () => {
	it('opens at the suggested price', async () => {
		await mount();

		await expect.element(amount()).toHaveValue(SUGGESTED / 100);
		await contains(total(), usd(SUGGESTED));
	});

	it('opens the split bar with the acts paid off the gross, not the divisible amount', async () => {
		// $20 less 88¢ of card processing leaves $19.12. The acts take 70% of the
		// $20 base, $14.00, and the collective absorbs the fee with $5.12 (#827).
		// 70% of the divisible amount would read $13.38.
		await mount();

		await expect.element(slider()).toHaveAttribute('aria-valuenow', '512');
		await valueText(/\$5\.12.*\$14\.00/);
		expect(postedCollective().value).toBe('512');
	});

	it('posts what the bar is moved to', async () => {
		// At exactly the suggested price the acts' guarantee and their opening
		// take are both $14.00, so the bar can only move left, in 25¢ steps.
		await mount();

		(slider().element() as HTMLElement).focus();
		await userEvent.keyboard('{ArrowLeft}{ArrowLeft}');

		await expect.element(slider()).toHaveAttribute('aria-valuenow', '462');
		await vi.waitFor(() => expect(postedCollective().value).toBe('462'));
	});

	it("leaves the surplus over the suggestion the buyer's to direct", async () => {
		// The acts are guaranteed 70% of the suggested $20, not of what was paid.
		// At $45: $1.61 of processing leaves $43.39, less the acts' $14.00, so the
		// collective can go to $29.39. It opens at 70% of the gross to the acts.
		await mount();
		await pay('45');

		await expect.element(slider()).toHaveAttribute('aria-valuenow', '1189');
		await expect.element(slider()).toHaveAttribute('aria-valuemax', '2939');

		(slider().element() as HTMLElement).focus();
		await userEvent.keyboard('{ArrowRight}');
		await expect.element(slider()).toHaveAttribute('aria-valuenow', '1214');
		await vi.waitFor(() => expect(postedCollective().value).toBe('1214'));

		await userEvent.keyboard('{End}');
		await valueText(/\$29\.39.*\$14\.00/);
	});

	it('prices the fee-coverage offer on the whole charge', async () => {
		// Stripe takes its cut of the whole charge: $20 grosses up to a 91¢ fee,
		// $45 to $1.66.
		await mount();
		const offer = page.getByCss('input[name="coverFees"]').element().closest('label')!;

		expect(offer.textContent).toContain(usd(91));
		await pay('45');
		await vi.waitFor(() => expect(offer.textContent).toContain(usd(166)));
	});

	it('shows paying above the suggestion as a contribution', async () => {
		await mount();
		await expect.element(page.getByTestId('contribution-line')).not.toBeInTheDocument();

		await pay('30');

		await expect.element(page.getByTestId('contribution-line')).toBeVisible();
		await contains(total(), usd(3000));
	});

	it('offers a free ticket, not a $0 charge, when the scale runs to free', async () => {
		await mount();
		await pay('0');

		await expect.element(slider()).not.toBeInTheDocument();
		await expect.element(submit()).toBeEnabled();
		expect(submit().element().textContent).not.toContain('$');
		expect(postedCollective().value).toBe('0');
	});

	it('refuses an amount below the charge minimum on the page', async () => {
		await mount();
		await pay('0.50');

		await expect
			.element(page.getByTestId('amount-refused'))
			.toHaveAttribute('data-reason', 'dead-zone');
		await expect.element(submit()).toBeDisabled();
	});

	it('names the floor of a show that has one, and refuses less', async () => {
		await mount({ floorCents: 1000 });

		await contains(page.getByCss('form'), usd(1000));
		await expect.element(page.getByTestId('amount-refused')).not.toBeInTheDocument();
		await expect.element(submit()).toBeEnabled();

		await pay('2');

		await expect
			.element(page.getByTestId('amount-refused'))
			.toHaveAttribute('data-reason', 'below-floor');
		await expect.element(submit()).toBeDisabled();
	});
});
