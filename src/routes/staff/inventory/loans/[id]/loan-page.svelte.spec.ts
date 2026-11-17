import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { toast } from 'svelte-sonner';
import '#lib/test/locators.js';
import { fakeQuery, heldRemoteForm } from '#lib/test/fake-remote.svelte.js';

/** Marking a loan returned shows before the server answers; a refusal puts it back. */

const detail = fakeQuery({
	loan: {
		id: 'loan-1',
		status: 'checked_out' as string,
		member: { type: 'member' as const, id: 'u-1', title: 'Fixture Member' },
		equipmentName: 'Fixture amp',
		categoryName: null,
		itemId: 'item-1',
		itemKind: 'bulk',
		assetId: null,
		quantity: 1,
		missingClearanceName: null,
		requestedPickupDate: new Date('2031-05-01T19:00:00Z'),
		scheduledPickupDate: null,
		dueDate: new Date('2031-05-08T19:00:00Z'),
		isOverdue: false,
		checkedOutAt: new Date('2031-05-01T19:00:00Z'),
		returnedAt: null as Date | null,
		dailyRateCents: null,
		totalChargeCents: null,
		creditsCents: null,
		cashCents: null,
		memberNotes: null,
		staffNotes: null
	},
	availableItems: [],
	availableAssets: []
});
const returnLoan = heldRemoteForm();

vi.mock('$app/env/public', async () => (await import('#lib/testing/env-mock.js')).envMock({}));
vi.mock('svelte-sonner', () => ({
	toast: Object.assign(vi.fn(), { success: vi.fn(), info: vi.fn(), error: vi.fn() })
}));
vi.mock('#lib/report-error.js', () => ({ reportError: vi.fn() }));
vi.mock('$app/state', async (original) => ({
	...(await original<Record<string, unknown>>()),
	page: {
		params: { id: 'loan-1' },
		route: { id: '/staff/inventory/loans/[id]' },
		url: new URL('http://localhost/staff/inventory/loans/loan-1')
	}
}));
vi.mock('#lib/remote/inventory.remote.js', () => ({
	getStaffLoanDetail: detail,
	scheduleLoanForm: heldRemoteForm(),
	checkoutLoanForm: heldRemoteForm(),
	cancelLoan: heldRemoteForm(),
	returnLoan
}));

const LoanPage = (await import('./+page.svelte')).default;

const trigger = () => page.getByTestId('mark-returned');
const submit = () => page.getByRole('dialog').getByCss('button[type="submit"]');

beforeEach(async () => {
	await returnLoan.settleAll();
	vi.mocked(toast.error).mockClear();
});

describe('marking a loan returned', () => {
	it('shows the loan returned while the server is answering', async () => {
		await render(LoanPage);
		await trigger().click();
		await submit().click();

		await expect.element(trigger()).not.toBeInTheDocument();
		expect(returnLoan.held).toHaveLength(1);
	});

	it('puts the loan back to checked out and says why when the server refuses', async () => {
		await render(LoanPage);
		await trigger().click();
		await submit().click();
		await expect.element(trigger()).not.toBeInTheDocument();

		returnLoan.held[0].reject(Object.assign(new Error('refused'), { status: 409 }));

		await expect.element(trigger()).toBeVisible();
		await vi.waitFor(() => expect(toast.error).toHaveBeenCalled());
	});
});
