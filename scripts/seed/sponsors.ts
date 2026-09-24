import {
	sponsor,
	sponsorship,
	sponsorPlacement,
	type NewSponsor,
	type NewSponsorship
} from '../../src/lib/server/db/schema/sponsor';
import type { SeedEvent } from './types';
import { batchInsert } from './db';
import { ptDate } from './util';

/** `YYYY-MM-DD` for a day relative to today, in Pacific time. */
function day(offset: number): string {
	return ptDate(offset, 12).toISOString().slice(0, 10);
}

/**
 * Four sponsors: one running, one whose term has lapsed unrenewed, one being
 * pitched, and one whose only term ended. Dated relative to today. The running
 * term is placed on the next two published shows; the pitch on one more, where
 * it stays invisible until it is active.
 */
export async function seedSponsors(events: SeedEvent[]) {
	console.log('Seeding sponsors...');

	const sponsors: NewSponsor[] = [
		{
			id: 'seed-sponsor-troubadour',
			name: 'Troubadour Music',
			website: 'https://example.com/troubadour',
			contactName: 'Store manager',
			contactEmail: 'sponsor@example.com'
		},
		{ id: 'seed-sponsor-brewery', name: 'Block 15 Brewing' },
		{ id: 'seed-sponsor-credit-union', name: 'Corvallis Community Credit Union' },
		{
			id: 'seed-sponsor-print',
			name: 'Valley Print Shop',
			notes: 'Printed posters at cost.',
			// Archived: off the list until "Show archived", its ended term kept.
			deletedAt: new Date()
		}
	];

	const ships: NewSponsorship[] = [
		{
			id: 'seed-sponsorship-troubadour-season',
			sponsorId: 'seed-sponsor-troubadour',
			title: 'Season sponsor',
			tier: 'Gold',
			status: 'active',
			amountCents: 150_000,
			startsOn: day(-90),
			endsOn: day(40)
		},
		{
			sponsorId: 'seed-sponsor-troubadour',
			title: 'Last season',
			tier: 'Silver',
			status: 'ended',
			amountCents: 100_000,
			startsOn: day(-455),
			endsOn: day(-91)
		},
		{
			sponsorId: 'seed-sponsor-brewery',
			title: 'Summer concert series',
			tier: 'Silver',
			status: 'active',
			amountCents: 50_000,
			startsOn: day(-120),
			endsOn: day(-6)
		},
		{
			id: 'seed-sponsorship-credit-union-pitch',
			sponsorId: 'seed-sponsor-credit-union',
			title: 'All-ages shows',
			status: 'prospect',
			amountCents: 250_000
		},
		{
			sponsorId: 'seed-sponsor-print',
			title: 'Poster printing',
			tier: 'In kind',
			status: 'ended',
			startsOn: day(-400),
			endsOn: day(-200)
		}
	];

	await batchInsert(sponsor, sponsors);
	await batchInsert(sponsorship, ships);

	const now = new Date();
	const upcoming = events
		.filter((e) => e.status === 'published' && e.startsAt > now)
		.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
	const placements = [
		...upcoming.slice(0, 2).map((e) => ({
			sponsorshipId: 'seed-sponsorship-troubadour-season',
			eventId: e.id,
			onEventPage: true,
			inCampaign: true
		})),
		...upcoming.slice(2, 3).map((e) => ({
			sponsorshipId: 'seed-sponsorship-credit-union-pitch',
			eventId: e.id,
			onEventPage: true,
			inCampaign: false
		}))
	];
	if (placements.length > 0) await batchInsert(sponsorPlacement, placements);
	return { sponsors: sponsors.length, placements: placements.length };
}
