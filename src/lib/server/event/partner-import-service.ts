import { and, eq, gte, inArray, isNull, lt, or } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { calendarSource } from '$lib/server/db/schema/calendar-source';
import { eventListing, publicEventStatuses } from '$lib/server/db/schema/event';
import { venue } from '$lib/server/db/schema/venue';
import { containsLiteral } from '$lib/server/db/like';
import { getPartsInTz } from '$lib/server/reservation/timezone';
import { DEFAULT_TIMEZONE } from '$lib/config';
import { escapeHtml } from '$lib/utils/html';
import { parseFeed, type FeedShow } from './partner-feed';

// ---------------------------------------------------------------------------
// Partner calendar import — the daily copy of partner venues' feeds onto the
// gig guide. docs/specs/shipped/partner-calendar-import-spec.md has the rules;
// the ones that are easy to break are named where they are enforced.
// ---------------------------------------------------------------------------

const FETCH_TIMEOUT_MS = 15_000;
const MAX_FEED_BYTES = 2 * 1024 * 1024;
const WINDOW_MS = 365 * 24 * 60 * 60 * 1000;
/** Statements per `db.batch`. Each is one row, so no statement nears D1's parameter cap. */
const BATCH_SIZE = 50;

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export interface SourceRunResult {
	sourceId: string;
	ok: boolean;
	inserted: number;
	updated: number;
	skipped: number;
	error?: string;
}

interface SourceRow {
	id: string;
	url: string;
	venueId: string;
	venueName: string;
	createdByUserId: string;
}

/** A partner writes plain text; ours is rich text. Text that is already HTML is sanitized on render. */
function toRichText(description: string | null): string | null {
	if (!description) return null;
	if (/<[a-z][^>]*>/i.test(description)) return description;
	return description
		.split(/\n{2,}/)
		.map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
		.join('');
}

const localDay = (d: Date) => {
	const p = getPartsInTz(d, DEFAULT_TIMEZONE);
	return `${p.year}-${p.month}-${p.day}`;
};

async function fetchFeed(url: string, fetcher: Fetcher): Promise<string> {
	const response = await fetcher(url.replace(/^webcal:/i, 'https:'), {
		headers: { accept: 'text/calendar, */*;q=0.5' },
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
	});
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
	const declared = Number(response.headers.get('content-length') ?? 0);
	if (declared > MAX_FEED_BYTES) throw new Error('Feed is larger than 2 MB');
	const body = await response.text();
	if (body.length > MAX_FEED_BYTES) throw new Error('Feed is larger than 2 MB');
	return body;
}

/**
 * Days at this venue that already carry a public listing nobody imported. A
 * band or member who listed the show first keeps it, and the feed's copy is
 * not added beside theirs. Matches on `venueId` or on the venue's name in
 * free-text `location`, since member listings rarely set the former.
 */
async function daysAlreadyListed(source: SourceRow, shows: FeedShow[]): Promise<Set<string>> {
	if (shows.length === 0) return new Set();
	const times = shows.map((s) => s.startsAt.getTime());
	const day = 24 * 60 * 60 * 1000;
	const rows = await db
		.select({ startsAt: eventListing.startsAt })
		.from(eventListing)
		.where(
			and(
				isNull(eventListing.importSourceId),
				inArray(eventListing.status, publicEventStatuses),
				gte(eventListing.startsAt, new Date(Math.min(...times) - day)),
				lt(eventListing.startsAt, new Date(Math.max(...times) + day)),
				or(
					eq(eventListing.venueId, source.venueId),
					containsLiteral(eventListing.location, source.venueName)
				)
			)
		);
	return new Set(rows.map((r) => localDay(r.startsAt)));
}

/** Copy one feed's upcoming shows onto the guide. Throws on a fetch or parse failure. */
export async function importSource(
	source: SourceRow,
	{ fetcher, now }: { fetcher: Fetcher; now: Date }
): Promise<Omit<SourceRunResult, 'sourceId' | 'ok'>> {
	const ics = await fetchFeed(source.url, fetcher);
	const parsed = parseFeed(ics, { from: now, until: new Date(now.getTime() + WINDOW_MS) });
	// A UID repeated within one feed is the feed's bug; the last copy wins
	// rather than the unique index failing the whole batch.
	const shows = [...new Map(parsed.map((s) => [s.uid, s])).values()];

	const existing = await db
		.select({ id: eventListing.id, uid: eventListing.importUid, status: eventListing.status })
		.from(eventListing)
		.where(eq(eventListing.importSourceId, source.id));
	const byUid = new Map(existing.map((r) => [r.uid, r]));
	const listedDays = await daysAlreadyListed(
		source,
		shows.filter((s) => !byUid.has(s.uid))
	);

	const writes = [];
	let inserted = 0;
	let updated = 0;
	let skipped = 0;
	for (const show of shows) {
		const fields = {
			title: show.title.slice(0, 200),
			description: toRichText(show.description),
			startsAt: show.startsAt,
			endsAt: show.endsAt,
			externalTicketUrl: show.url && /^https?:\/\//i.test(show.url) ? show.url : null,
			status: show.cancelled ? ('cancelled' as const) : ('published' as const),
			updatedAt: now
		};
		const row = byUid.get(show.uid);
		if (row) {
			// Only a listing still on the guide follows its feed. One staff pulled
			// (rejected, or anything else) must not be put back by a refresh.
			if (row.status !== 'published' && row.status !== 'cancelled') {
				skipped++;
				continue;
			}
			writes.push(db.update(eventListing).set(fields).where(eq(eventListing.id, row.id)));
			updated++;
		} else if (show.cancelled || listedDays.has(localDay(show.startsAt))) {
			skipped++;
		} else {
			writes.push(
				db.insert(eventListing).values({
					...fields,
					location: source.venueName,
					venueId: source.venueId,
					source: 'community',
					kind: 'show',
					publishedAt: now,
					createdByUserId: source.createdByUserId,
					importSourceId: source.id,
					importUid: show.uid
				})
			);
			inserted++;
		}
	}

	for (let i = 0; i < writes.length; i += BATCH_SIZE) {
		const chunk = writes.slice(i, i + BATCH_SIZE);
		await db.batch(chunk as [(typeof chunk)[number], ...typeof chunk]);
	}
	return { inserted, updated, skipped };
}

/**
 * Run every feed that is not paused. One feed failing is recorded on its row
 * and does not stop the others; the cron job fails only if this throws.
 */
export async function runPartnerImports(
	opts: { fetcher?: Fetcher; now?: Date } = {}
): Promise<SourceRunResult[]> {
	const fetcher = opts.fetcher ?? ((url, init) => fetch(url, init));
	const now = opts.now ?? new Date();

	const sources = await db
		.select({
			id: calendarSource.id,
			url: calendarSource.url,
			venueId: calendarSource.venueId,
			venueName: venue.name,
			createdByUserId: calendarSource.createdByUserId
		})
		.from(calendarSource)
		.innerJoin(venue, eq(venue.id, calendarSource.venueId))
		.where(and(eq(calendarSource.paused, false), isNull(venue.deletedAt)));

	const results: SourceRunResult[] = [];
	for (const source of sources) {
		let result: SourceRunResult;
		try {
			result = { sourceId: source.id, ok: true, ...(await importSource(source, { fetcher, now })) };
		} catch (err) {
			const error = (err instanceof Error ? err.message : String(err)).slice(0, 500);
			result = { sourceId: source.id, ok: false, inserted: 0, updated: 0, skipped: 0, error };
		}
		await db
			.update(calendarSource)
			.set({
				lastFetchedAt: now,
				lastError: result.error ?? null,
				// A failed run keeps the last good count beside its error.
				...(result.ok ? { lastImportedCount: result.inserted + result.updated } : {}),
				updatedAt: now
			})
			.where(eq(calendarSource.id, source.id));
		results.push(result);
	}
	return results;
}
