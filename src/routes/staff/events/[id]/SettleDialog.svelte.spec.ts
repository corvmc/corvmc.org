import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import '#lib/test/locators.js';

/**
 * The settle dialog (#3273): what it totals as amounts change, and which
 * controls a read-only settlement and a caller without `finance.refund` get.
 */

// A form whose every field, however deep (`payouts[0].amountCents`), is a stand-in.
const remote = vi.hoisted(() => {
	const field = (): unknown =>
		new Proxy(() => undefined, {
			get: (_t, key: string) =>
				key === 'as'
					? (type: string, v?: unknown) => ({ type, value: v })
					: key === 'issues'
						? () => null
						: key === 'value'
							? () => undefined
							: field(),
			apply: () => undefined
		});
	const fn = Object.assign(() => undefined, {
		enhance: () => ({ method: 'POST' }),
		fields: field(),
		result: undefined,
		pending: 0
	});
	return Object.assign(fn, { for: () => fn });
});

vi.mock('#lib/remote/productions.remote.js', () => ({
	recordPayouts: remote,
	recordStaffCount: remote,
	undoActPayout: remote
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn(), refreshAll: vi.fn(), beforeNavigate: vi.fn() }));

const SettleDialog = (await import('./SettleDialog.svelte')).default;

const act = (slotId: string, over: Record<string, unknown> = {}) => ({
	slotId,
	actName: slotId,
	designatedCents: 0,
	guaranteeCents: null,
	percentageBps: null,
	versus: false,
	againstNet: false,
	contributed: false,
	suggestedPayoutCents: 20_000,
	topUpCents: 0,
	paidCents: null,
	paidAt: null,
	...over
});

function settlement(over: Record<string, unknown> = {}) {
	const acts = (over.acts as ReturnType<typeof act>[]) ?? [act('a'), act('b')];
	return {
		productionId: 'prod-1',
		eventId: 'evt-1',
		status: 'completed',
		collectiveRevenueCents: 100_000,
		actsPoolCents: 40_000,
		door: null,
		doorCounts: null,
		doorTakings: {
			checkedIn: 0,
			card: { tickets: 0 },
			cash: { tickets: 0 },
			free: { tickets: 0 },
			donations: { count: 0, grossCents: 0 }
		},
		expensesCents: 10_000,
		deductibleExpensesCents: 10_000,
		expenses: [],
		suggestedPayoutTotalCents: 40_000,
		paidTotalCents: 0,
		unpaidActCount: acts.filter((a) => a.paidCents === null).length,
		netCents: 90_000,
		settled: false,
		...over,
		acts
	};
}

const props = (s: unknown, over: Record<string, unknown> = {}) => ({
	open: true,
	eventId: 'evt-1',
	settlement: s as never,
	canCount: true,
	canPayout: true,
	...over
});

describe('SettleDialog', () => {
	it('totals the suggested payouts and drops a donated set to zero', async () => {
		render(SettleDialog, props(settlement()));
		await expect.element(page.getByTestId('settle-total')).toHaveAttribute('data-cents', '40000');
		await expect.element(page.getByTestId('settle-net')).toHaveAttribute('data-cents', '90000');

		await page.getByRole('checkbox').first().click();
		await expect.element(page.getByTestId('settle-total')).toHaveAttribute('data-cents', '20000');
		// The net moves with what is actually paid out: 1000 - 100 - (200 - 400).
		await expect.element(page.getByTestId('settle-net')).toHaveAttribute('data-cents', '110000');
	});

	const paidShow = () =>
		settlement({
			acts: [act('a', { paidCents: 20_000 }), act('b', { paidCents: 0 })],
			settled: true,
			paidTotalCents: 20_000
		});

	it('offers no payout form once every act is paid, and undo to finance.refund', async () => {
		render(SettleDialog, props(paidShow()));
		await expect.element(page.getByTestId('settle-net')).toBeInTheDocument();
		expect(document.querySelectorAll('[data-testid=settle-total]')).toHaveLength(0);
		expect(document.querySelectorAll('button[type=submit]')).toHaveLength(0);
		// Close, and one undo per paid act.
		expect(document.querySelectorAll('button')).toHaveLength(3);
	});

	it('shows no undo to a caller without finance.refund', async () => {
		render(SettleDialog, props(paidShow(), { canPayout: false, canCount: false }));
		await expect.element(page.getByTestId('settle-net')).toBeInTheDocument();
		// Only the dialog's close button is left.
		expect(document.querySelectorAll('button')).toHaveLength(1);
	});

	// Warn, never refuse: the typed count is read against the check-ins (#2801)
	// and the counted cash against the cash sales the door recorded (#2800).
	describe('door warnings', () => {
		const night = (count: number | null, checkedIn: number, gapCents: number) =>
			settlement({
				door: {
					cashCents: 100_000,
					recordedCents: 100_000 - gapCents,
					gapCents,
					unrecordedCents: 0,
					count,
					actsPercent: 70,
					actsCents: 70_000,
					collectiveCents: 30_000
				},
				doorCounts: { check: 'single', oneCounter: false, handoffs: [], staff: null },
				doorTakings: {
					checkedIn,
					card: { tickets: 0 },
					cash: { tickets: 0 },
					free: { tickets: 0 },
					donations: { count: 0, grossCents: 0 }
				}
			});
		const shown = (id: string) => document.querySelectorAll(`[data-testid=${id}]`).length;

		it('warns when the headcount differs from check-ins, and only then', async () => {
			const { unmount } = await render(SettleDialog, props(night(5, 3, 0)));
			await expect.element(page.getByTestId('door-count-gap')).toBeVisible();
			unmount();

			await render(SettleDialog, props(night(3, 3, 0)));
			await expect.element(page.getByTestId('settle-net')).toBeInTheDocument();
			expect(shown('door-count-gap')).toBe(0);
		});

		it('warns when the cash counted differs from cash sales recorded, and only then', async () => {
			const { unmount } = await render(SettleDialog, props(night(3, 3, 10_000)));
			await expect.element(page.getByTestId('door-cash-gap')).toBeVisible();
			unmount();

			await render(SettleDialog, props(night(3, 3, 0)));
			await expect.element(page.getByTestId('settle-net')).toBeInTheDocument();
			expect(shown('door-cash-gap')).toBe(0);
		});
	});

	it('is read-only for a closed show with an unpaid act', async () => {
		render(SettleDialog, props(settlement({ status: 'closed' })));
		await expect.element(page.getByTestId('settle-net')).toBeInTheDocument();
		expect(document.querySelectorAll('button[type=submit]')).toHaveLength(0);
		expect(document.querySelectorAll('input[type=checkbox]')).toHaveLength(0);
	});
});
