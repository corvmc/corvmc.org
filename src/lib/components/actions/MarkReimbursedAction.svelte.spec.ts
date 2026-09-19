import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

/**
 * The dialog is one sentence, and the sentence is the whole component: who is
 * being recorded as paid back, how much, and — the part staff get wrong — that
 * pressing this moves no money. The amount arrives in cents and is read by a
 * person, so `formatCents` is the one piece of arithmetic here; printing 4500
 * instead of $45.00 is the failure it exists to prevent.
 */

vi.mock('$lib/remote/inventory.remote', () => ({
	markAcquisitionReimbursed: {
		enhance: () => ({ method: 'POST', action: '?/markAcquisitionReimbursed' }),
		fields: {
			id: {
				as: (type: string, value?: unknown) => ({ type, name: 'id', value }),
				issues: () => null
			},
			allIssues: () => null
		},
		result: undefined
	}
}));

// `FormGuard`, which `<Form>` always imports, reaches for `beforeNavigate`; a
// partial mock of this module is a missing-export error at import time rather
// than at the call.
vi.mock('$app/navigation', () => ({
	invalidateAll: vi.fn(),
	goto: vi.fn(),
	beforeNavigate: vi.fn()
}));

const MarkReimbursedAction = (await import('./MarkReimbursedAction.svelte')).default;

const open = async (props: Record<string, unknown> = {}) => {
	await render(MarkReimbursedAction, { acquisitionId: 'acq-2', ...props });
	await page.getByRole('button', { name: 'Mark reimbursed' }).first().click();
	return page.getByRole('dialog');
};

const sentence = () => document.querySelector('[role="dialog"]')?.textContent ?? '';

describe('MarkReimbursedAction', () => {
	it('reads the amount back in dollars, not in cents', async () => {
		await expect.element(await open({ paidByName: 'Jamie Fox', amountCents: 4500 })).toBeVisible();

		expect(sentence()).toContain('Jamie Fox has been paid back for $45.00');
	});

	// The whole point of the dialog. Nothing here reaches a bank, and a staffer
	// who thinks it does will not go and make the transfer.
	it('says out loud that pressing it sends no money', async () => {
		await expect.element(await open({ paidByName: 'Jamie Fox', amountCents: 4500 })).toBeVisible();

		expect(sentence()).toContain('does not send any money');
	});

	// An acquisition can be recorded without a price. Claiming an amount of
	// $0.00 would be a statement about the transfer that nobody made.
	it('claims no amount when none was recorded', async () => {
		await expect.element(await open({ paidByName: 'Jamie Fox' })).toBeVisible();

		expect(sentence()).toContain('Jamie Fox has been paid back.');
		expect(sentence()).not.toContain('$');
	});

	// Older rows predate the payer being captured; the sentence still has to
	// parse, because it is the only thing confirming what is about to be written.
	it('still reads as a sentence when nobody is named', async () => {
		await expect.element(await open({ amountCents: 1200 })).toBeVisible();

		expect(sentence()).toContain('whoever paid has been paid back for $12.00');
	});
});
