import { afterEach, beforeEach, describe, expect, vi } from 'vitest';
import { render } from 'svelte/server';
import CreditBalanceCard from './CreditBalanceCard.svelte';
import InvoiceHistoryCard from './InvoiceHistoryCard.svelte';
import { forEachClockEdge, viewerTimeZones } from '$lib/test/clock-edges';

// The club's calendar day, spelled out with no zone involved.
function clubMonthDay(clubDate: string): string {
	return new Date(`${clubDate}T12:00:00Z`).toLocaleDateString('en-US', {
		timeZone: 'UTC',
		month: 'long',
		day: 'numeric'
	});
}

// The viewer-zone formatting the cards used to do (#2222).
function viewerMonthDay(at: Date): string {
	return at.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
}

function expectClubDay(body: string, at: Date, clubDate: string) {
	const club = clubMonthDay(clubDate);
	expect(body).toContain(club);
	if (viewerMonthDay(at) !== club) expect(body).not.toContain(viewerMonthDay(at));
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2026-02-20T20:00:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('membership dates render in club time', () => {
	forEachClockEdge(
		'dates the credit refresh by the club calendar',
		async ({ at, clubDate }) => {
			const { body } = await render(CreditBalanceCard, {
				props: {
					credits: { free_hours: 4 },
					subscription: {
						id: 'sub_1',
						status: 'active',
						quantity: 4,
						coveringFees: false,
						currentPeriodEnd: at,
						cancelAtPeriodEnd: false
					},
					allocatedThisMonth: 8,
					usedThisMonth: 0
				}
			});

			expectClubDay(body, at, clubDate);
		},
		{ zones: viewerTimeZones }
	);

	forEachClockEdge(
		'dates an invoice by the club calendar',
		async ({ at, clubDate }) => {
			const { body } = await render(InvoiceHistoryCard, {
				props: {
					available: true,
					invoices: [
						{
							id: 'in_1',
							created: at,
							amountPaidCents: 1000,
							currency: 'usd',
							status: 'paid',
							hostedUrl: null,
							pdfUrl: null
						}
					]
				}
			});

			expectClubDay(body, at, clubDate);
		},
		{ zones: viewerTimeZones }
	);
});
