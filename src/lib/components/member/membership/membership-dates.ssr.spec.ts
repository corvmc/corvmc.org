// A zone far from club time, set before anything formats a date: the old
// viewer-zone formatting rendered Mar 1 here for an instant that is Feb 28 at
// the club, so the assertions below cannot pass by the zones agreeing.
process.env.TZ = 'Pacific/Kiritimati';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import CreditBalanceCard from './CreditBalanceCard.svelte';
import InvoiceHistoryCard from './InvoiceHistoryCard.svelte';
import { formatMonthDay, formatMonthDayYear } from '$lib/utils/format';

// 7pm on Feb 28 in club time; Mar 1 in UTC and in Kiritimati.
const periodEnd = new Date('2026-03-01T03:00:00Z');
const viewerDay = periodEnd.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2026-02-20T20:00:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('membership dates render in club time', () => {
	it('dates the credit refresh by the club calendar', async () => {
		const { body } = await render(CreditBalanceCard, {
			props: {
				credits: { free_hours: 4 },
				subscription: {
					id: 'sub_1',
					status: 'active',
					quantity: 4,
					coveringFees: false,
					currentPeriodEnd: periodEnd,
					cancelAtPeriodEnd: false
				},
				allocatedThisMonth: 8,
				usedThisMonth: 0
			}
		});

		expect(formatMonthDay(periodEnd)).not.toBe(viewerDay);
		expect(body).toContain(formatMonthDay(periodEnd));
		expect(body).not.toContain(viewerDay);
	});

	it('dates an invoice by the club calendar', async () => {
		const { body } = await render(InvoiceHistoryCard, {
			props: {
				available: true,
				invoices: [
					{
						id: 'in_1',
						created: periodEnd,
						amountPaidCents: 1000,
						currency: 'usd',
						status: 'paid',
						hostedUrl: null,
						pdfUrl: null
					}
				]
			}
		});

		expect(body).toContain(formatMonthDayYear(periodEnd));
		expect(body).not.toContain(viewerDay);
	});
});
