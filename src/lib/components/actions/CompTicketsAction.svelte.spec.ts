import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

/**
 * Comping tickets is the one path that issues tickets without a payment, and
 * the handler rejects a quantity outside 1–50 with a field issue. A bare input
 * rendered that issue as `aria-invalid` alone, so an over-count read as a
 * submit that did nothing.
 */
const issues: Record<string, { path: string[]; message: string }[] | null> = {};

vi.mock('$lib/remote/events.remote', () => {
	const field = (name: string) => ({
		as: (type: string, value?: unknown) => ({ type, name, value }),
		issues: () => issues[name] ?? null
	});
	return {
		compTickets: {
			enhance: () => ({ method: 'POST', action: '?/compTickets' }),
			fields: {
				eventId: field('eventId'),
				attendeeName: field('attendeeName'),
				attendeeEmail: field('attendeeEmail'),
				quantity: field('quantity'),
				allIssues: () => null
			},
			result: undefined
		}
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

const field = (name: string) =>
	document.querySelector(`[role="dialog"] [name="${name}"]`) as unknown as HTMLInputElement;

const open = async () => {
	await render(CompTicketsAction, { eventId: 'event-7' });
	await page.getByRole('button', { name: 'Comp Tickets' }).click();
	return page.getByRole('dialog');
};

describe('CompTicketsAction', () => {
	it('carries the event id into the form', async () => {
		await open();

		expect(field('eventId').value).toBe('event-7');
	});

	/**
	 * The schema reads quantity as `z.string().transform(Number)`, so the field
	 * stays registered `as('text')` — registering it `as('number')` posts an `n:`
	 * field the schema rejects outright. `type="number"` is the spinner alone,
	 * and it has to survive the wrapper or the count is typed as free text.
	 */
	it('takes the quantity on a number input that still posts as text', async () => {
		await open();

		const quantity = field('quantity');
		expect(quantity.type).toBe('number');
		expect(quantity.name).toBe('quantity');
		expect(quantity.value).toBe('1');
		expect(quantity.min).toBe('1');
		expect(quantity.max).toBe('50');
	});

	it('renders the quantity rejection as a message', async () => {
		issues.quantity = [{ path: ['quantity'], message: 'Quantity must be between 1 and 50' }];
		try {
			await open();

			await expect.element(page.getByText('Quantity must be between 1 and 50')).toBeVisible();
		} finally {
			issues.quantity = null;
		}
	});

	it('associates every caption with the control it names', async () => {
		await open();

		await expect.element(page.getByLabelText('Attendee name')).toBeVisible();
		await expect.element(page.getByLabelText('Email')).toBeVisible();
		await expect.element(page.getByLabelText('Quantity')).toBeVisible();
	});
});
