import type { SeedEvent } from './types';

/** `YYYY-MM` of a date in Pacific time, the club's calendar. */
function clubMonth(d: Date): string {
	return d.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }).slice(0, 7);
}

/**
 * Which upcoming shows carry which seeded sponsorship. The month poster credits
 * next month's sponsors, so the running terms also take the first show of the
 * next month. Near a month end that show is already among the first few, and
 * `(sponsorship, event)` is unique, so each list drops repeats.
 */
export function sponsorPlacements(events: SeedEvent[], now: Date) {
	const upcoming = events
		.filter((e) => e.status === 'published' && e.startsAt > now)
		.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
	const nextMonth = upcoming.find((e) => clubMonth(e.startsAt) !== clubMonth(now));
	const place = (sponsorshipId: string, list: SeedEvent[], inCampaign = true) =>
		[...new Map(list.map((e) => [e.id, e])).values()].map((e) => ({
			sponsorshipId,
			eventId: e.id,
			onEventPage: true,
			inCampaign
		}));
	return [
		...place('seed-sponsorship-troubadour-season', [
			...upcoming.slice(0, 2),
			...(nextMonth ? [nextMonth] : [])
		]),
		...place('seed-sponsorship-credit-union-pitch', upcoming.slice(2, 3), false),
		...place('seed-sponsorship-brewery-series', [
			...upcoming.slice(3, 4),
			...(nextMonth ? [nextMonth] : [])
		])
	];
}
