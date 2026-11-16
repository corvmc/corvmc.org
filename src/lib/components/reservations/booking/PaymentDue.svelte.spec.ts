import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import '#lib/test/locators.js';
import { formatMonthDayYear } from '#lib/utils/format.js';

/** The refused member's booking button (#2859): it explains, then opens the staff compose. */

const subjectSet = vi.fn();
const field = (name: string) => ({
	as: (type: string, value?: unknown) => ({ type, name, value }),
	issues: () => null,
	value: () => undefined,
	set: name === 'subject' ? subjectSet : vi.fn()
});
const remote = {
	enhance: () => ({ method: 'POST', action: '?/start' }),
	fields: new Proxy({ allIssues: () => null } as Record<string, unknown>, {
		get: (target, key: string) => target[key] ?? field(key)
	}),
	result: undefined
};

vi.mock('#lib/remote/inbox.remote.js', () => ({
	startConversation: { for: () => remote }
}));
// `FormGuard`, which `<Form>` always imports, reaches for `beforeNavigate`.
vi.mock('$app/navigation', () => ({
	refreshAll: vi.fn(),
	goto: vi.fn(),
	beforeNavigate: vi.fn()
}));

const PaymentDue = (await import('./PaymentDue.svelte')).default;

const gate = {
	state: 'refuse' as const,
	fees: [
		{
			id: 'res-1',
			startsAt: new Date('2026-11-03T02:00:00Z'),
			endsAt: new Date('2026-11-03T04:00:00Z'),
			amountCents: 3000
		}
	]
};

const date = formatMonthDayYear(gate.fees[0].startsAt);

describe('PaymentDue', () => {
	it('opens the staff compose with the owed reservation’s date in the subject', async () => {
		await render(PaymentDue, { gate, label: 'Reserve space', 'data-testid': 'book-space' });
		await page.getByTestId('book-space').click();
		await expect.element(page.getByTestId('payment-due')).toBeVisible();
		expect(page.getByTestId('payment-due').element().textContent).toContain(date);
		await page.getByTestId('payment-due').getByRole('button').click();
		expect(subjectSet).toHaveBeenCalledWith(expect.stringContaining(date));
	});
});
