import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { sourceFiles } from './lib/source-files';

/**
 * Every read of published listings applies the visibility predicate (#2662).
 * A function that filters `event_listing` on a published status must call
 * `visibleTo`, or a guard built on it, unless it is named below with why it
 * is not a read anyone outside staff or the owner sees.
 * `src/lib/server/event/visibility.spec.ts` runs the reads on real SQLite.
 */
const notPublic: Record<string, string> = {
	'src/lib/server/db/schema/event.ts publicEventStatuses': 'the constant itself',
	'src/lib/server/user/staff-dashboard-service.ts listUpcomingShows': 'staff dashboard',
	'src/lib/server/volunteer/duty-list-service.ts loadClock': 'a duty list’s own show',
	'src/lib/server/ticket/door-sale.ts doorEvents': 'staff and door volunteers',
	'src/lib/server/market/market-service.ts getApplicationWindow':
		'market.remote applies requireListingVisible first',
	'src/lib/server/event/calendar-totals-service.ts staffCalendarRow': 'staff calendar',
	'src/lib/server/event/calendar-totals-service.ts onCalendar': 'staff calendar',
	'src/lib/server/event/community-event-service.ts countPublishedListingsBy': 'a count, for purges',
	'src/lib/server/event/partner-import-service.ts daysAlreadyListed': 'import dedupe',
	'src/lib/server/event/event-service.ts unannouncedShows': 'staff reminder',
	'src/lib/server/event/event-service.ts publish': 'a write',
	'src/lib/server/event/event-service.ts unpublish': 'a write',
	'src/lib/server/event/event-service.ts listEventsNear': 'staff duplicate check',
	'src/lib/server/event/event-report-service.ts countBySource': 'staff report',
	'src/lib/server/event/event-report-service.ts getEventTotals': 'staff report',
	'src/lib/remote/events.remote.ts searchEventRows': 'staff and sponsor pickers',
	'src/lib/server/event/rsvp-availability.ts rsvpClosedReason': 'a loaded row; callers guard',
	'src/lib/server/market/market-service.ts accepting': 'a loaded row; callers guard'
};

const READS_PUBLISHED =
	/(?:evt|event)\.status !== 'published'|eventListing\.status, (?:'published'|\[)|publicEventStatuses/;
const GUARDED = /visibleTo|requireListingVisible|canSeeListing|isPublicListing/;

const files = sourceFiles(
	['src/lib/server/**/*.ts', 'src/lib/remote/**/*.ts', 'src/routes/**/*.ts'],
	new Set()
).filter((f) => !f.endsWith('.spec.ts'));

/** Top-level functions and `export const` remotes, by name. */
function units(file: string): [name: string, body: string][] {
	return readFileSync(file, 'utf8')
		.split(/\n(?=export (?:async )?function |(?:async )?function |export const \w+ = )/)
		.flatMap((part) => {
			const m = /^(?:export )?(?:async )?(?:function|const) (\w+)/.exec(part);
			return m ? [[m[1], part] as [string, string]] : [];
		});
}

const unguarded = files.flatMap((f) =>
	units(f)
		.filter(([, body]) => READS_PUBLISHED.test(body) && !GUARDED.test(body))
		.map(([name]) => `${f} ${name}`)
);

/** A listing insert whose `kind` is not a literal non-meeting; its visibility can't be the default. */
function insertsMissingVisibility(file: string): string[] {
	const lines = readFileSync(file, 'utf8').split('\n');
	const hits: string[] = [];
	lines.forEach((line, i) => {
		if (!/insert\(eventListing\)/.test(line)) return;
		const end = lines.findIndex((l, j) => j > i && /^\s*\}\)/.test(l));
		const block = lines.slice(i, end < 0 ? i + 40 : end + 1).join('\n');
		const kind = /\bkind(?::\s*([^,\n]+))?[,\n]/.exec(block);
		if (!kind) return;
		const literal = kind[1]?.trim().match(/^'(\w+)'/)?.[1];
		if (literal && literal !== 'meeting') return;
		if (!/\bvisibility\b/.test(block)) hits.push(`${file}:${i + 1}`);
	});
	return hits;
}

describe('event visibility', () => {
	it('finds published reads to check', () => {
		expect(files.filter((f) => GUARDED.test(readFileSync(f, 'utf8'))).length).toBeGreaterThan(5);
	});

	it('applies the predicate on every read of published listings', () => {
		const missing = unguarded.filter((u) => !(u in notPublic));
		expect(missing, missing.join('\n')).toEqual([]);
	});

	it('keeps no stale exemption', () => {
		const stale = Object.keys(notPublic).filter((k) => !unguarded.includes(k));
		expect(stale, stale.join('\n')).toEqual([]);
	});

	it('names visibility on a listing insert whose kind is computed or a meeting', () => {
		const writers = sourceFiles(
			['src/**/*.ts', 'scripts/**/*.ts', 'e2e/**/*.ts'],
			new Set()
		).filter((f) => !f.endsWith('.spec.ts'));
		const hits = writers.flatMap(insertsMissingVisibility);
		expect(hits, hits.join('\n')).toEqual([]);
	});
});
