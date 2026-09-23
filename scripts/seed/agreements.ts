import { agreement, type NewAgreement } from '../../src/lib/server/db/schema/agreement';
import { batchInsert } from './db';
import { ptDate } from './util';

/** `YYYY-MM-DD` for a day relative to today, in Pacific time. */
function day(offset: number): string {
	return ptDate(offset, 12).toISOString().slice(0, 10);
}

/**
 * Every status and both kinds, dated relative to today so the list's ordering
 * and its overdue report stay true however old the seed is.
 */
export async function seedAgreements() {
	console.log('Seeding agreements...');

	const rows: NewAgreement[] = [
		{
			id: 'seed-agreement-oac',
			kind: 'grant',
			counterparty: 'Oregon Arts Commission',
			title: '2027 operating support',
			status: 'prospect',
			amountCents: 500_000,
			contactName: 'Program officer',
			contactEmail: 'grants@example.org',
			applyBy: day(18)
		},
		{
			id: 'seed-agreement-community-fund',
			kind: 'grant',
			counterparty: 'Benton County Community Fund',
			title: 'Youth songwriting workshops',
			status: 'applied',
			amountCents: 250_000,
			applyBy: day(-12)
		},
		{
			id: 'seed-agreement-cultural-trust',
			kind: 'grant',
			counterparty: 'Oregon Cultural Trust',
			title: 'Practice room soundproofing',
			status: 'active',
			amountCents: 800_000,
			startsOn: day(-200),
			endsOn: day(165),
			reportDueOn: day(-3),
			notes: 'Interim report was due before the second disbursement.'
		},
		{
			id: 'seed-agreement-troubadour',
			kind: 'sponsorship',
			counterparty: 'Troubadour Music',
			title: 'Season sponsor',
			status: 'active',
			amountCents: 150_000,
			tier: 'Gold',
			contactName: 'Store manager',
			contactEmail: 'sponsor@example.com',
			startsOn: day(-90),
			endsOn: day(40)
		},
		{
			id: 'seed-agreement-brewery',
			kind: 'sponsorship',
			counterparty: 'Block 15 Brewing',
			title: 'Summer concert series',
			status: 'ended',
			amountCents: 50_000,
			tier: 'Silver',
			startsOn: day(-400),
			endsOn: day(-280)
		},
		{
			id: 'seed-agreement-foundation',
			kind: 'grant',
			counterparty: 'Collins Foundation',
			title: 'Capital equipment',
			status: 'declined',
			amountCents: 1_200_000,
			applyBy: day(-60)
		}
	];

	await batchInsert(agreement, rows);
	return { agreements: rows.length };
}
