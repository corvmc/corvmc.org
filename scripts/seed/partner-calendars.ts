import { calendarSource } from '../../src/lib/server/db/schema/calendar-source';
import { eventListing } from '../../src/lib/server/db/schema/event';
import { batchInsert } from './db';
import { type SeedUser } from './types';
import { ptDate } from './util';

/**
 * Partner calendar feeds (#1459) and what one already imported, as if the
 * daily job had run. One feed is healthy; one is paused with a failed fetch,
 * so both states on the venue page render without a network. The URLs are
 * `.invalid`: "Fetch now" on either records an error rather than importing.
 */
export async function seedPartnerCalendars(staffUser: SeedUser) {
	console.log('Seeding partner calendar feeds...');
	const lastRun = ptDate(0, 8);

	await batchInsert(calendarSource, [
		{
			id: 'seed-feed-whiteside',
			venueId: 'seed-venue-hall',
			url: 'https://whiteside.invalid/calendar.ics',
			lastFetchedAt: lastRun,
			lastImportedCount: 3,
			createdByUserId: staffUser.id
		},
		{
			id: 'seed-feed-park',
			venueId: 'seed-venue-park',
			url: 'https://central-park-stage.invalid/events.ics',
			paused: true,
			lastFetchedAt: lastRun,
			lastError: 'HTTP 404',
			createdByUserId: staffUser.id
		}
	]);

	const imported = (n: number, title: string, days: number, status: 'published' | 'cancelled') => ({
		id: `seed-imported-${n}`,
		title,
		description: '<p>Imported from the Whiteside Theatre calendar.</p>',
		startsAt: ptDate(days, 19, 30),
		endsAt: ptDate(days, 22, 30),
		status,
		publishedAt: lastRun,
		source: 'community' as const,
		kind: 'show' as const,
		location: 'Whiteside Theatre',
		venueId: 'seed-venue-hall',
		externalTicketUrl: `https://whiteside.invalid/shows/${n}`,
		createdByUserId: staffUser.id,
		importSourceId: 'seed-feed-whiteside',
		importUid: `seed-${n}@whiteside.invalid`
	});

	await batchInsert(eventListing, [
		imported(1, 'Silent film night with live score', 9, 'published'),
		imported(2, 'Valley Jazz Orchestra', 16, 'published'),
		imported(3, 'Touring folk double bill', 23, 'cancelled')
	]);

	return { feeds: 2, imported: 3 };
}
