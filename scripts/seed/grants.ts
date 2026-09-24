import {
	funder,
	grantApplication,
	grantReport,
	type NewFunder,
	type NewGrantApplication,
	type NewGrantReport
} from '../../src/lib/server/db/schema/grant';
import { batchInsert } from './db';
import { ptDate } from './util';

/** `YYYY-MM-DD` for a day relative to today, in Pacific time. */
function day(offset: number): string {
	return ptDate(offset, 12).toISOString().slice(0, 10);
}

/**
 * Every status, and an award with an overdue interim report beside a final one
 * still ahead. Dated relative to today so the ordering stays true.
 */
export async function seedGrants() {
	console.log('Seeding grants...');

	const funders: NewFunder[] = [
		{
			id: 'seed-funder-oac',
			name: 'Oregon Arts Commission',
			contactName: 'Program officer',
			contactEmail: 'grants@example.org'
		},
		{ id: 'seed-funder-community-fund', name: 'Benton County Community Fund' },
		{ id: 'seed-funder-cultural-trust', name: 'Oregon Cultural Trust' },
		{ id: 'seed-funder-collins', name: 'Collins Foundation' }
	];

	const apps: NewGrantApplication[] = [
		{
			id: 'seed-grant-oac',
			funderId: 'seed-funder-oac',
			title: '2027 operating support',
			status: 'prospect',
			amountRequestedCents: 500_000,
			applyBy: day(18)
		},
		{
			id: 'seed-grant-workshops',
			funderId: 'seed-funder-community-fund',
			title: 'Youth songwriting workshops',
			status: 'applied',
			amountRequestedCents: 250_000,
			applyBy: day(-12)
		},
		{
			id: 'seed-grant-soundproofing',
			funderId: 'seed-funder-cultural-trust',
			title: 'Practice room soundproofing',
			status: 'awarded',
			amountRequestedCents: 1_000_000,
			amountAwardedCents: 800_000,
			startsOn: day(-200),
			endsOn: day(165),
			notes: 'Second disbursement waits on the interim report.'
		},
		{
			id: 'seed-grant-equipment',
			funderId: 'seed-funder-collins',
			title: 'Capital equipment',
			status: 'declined',
			amountRequestedCents: 1_200_000,
			applyBy: day(-60)
		}
	];

	const reports: NewGrantReport[] = [
		{
			grantApplicationId: 'seed-grant-soundproofing',
			title: 'Interim report',
			dueOn: day(-3)
		},
		{
			grantApplicationId: 'seed-grant-soundproofing',
			title: 'Final report',
			dueOn: day(195)
		}
	];

	await batchInsert(funder, funders);
	await batchInsert(grantApplication, apps);
	await batchInsert(grantReport, reports);
	return { funders: funders.length, applications: apps.length };
}
