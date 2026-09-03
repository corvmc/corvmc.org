/**
 * CMC Radio: one station, one timetable, everybody hearing the same thing.
 *
 * The schedule is **materialized** into `radio_play` ahead of wall clock rather
 * than derived on demand from a seeded shuffle. A shuffle needs no writes and is
 * the obvious implementation, but the eligible pool changes underneath it — a
 * band opting out at 4pm would silently re-deal every listener's evening, and
 * two people comparing notes would find they had never been hearing the same
 * song. Rows already handed out do not move.
 *
 * There is no streaming server anywhere in this. The client asks what is on,
 * gets a track plus the wall-clock window it occupies, and seeks into it. That
 * is the whole mechanism.
 */
import { db } from '$lib/server/db';
import { audioRelease, audioTrack, radioPlay } from '$lib/server/db/schema/audio';
import { group } from '$lib/server/db/schema/group';
import { media, mediaAttachment } from '$lib/server/db/schema/media';
import { and, asc, desc, eq, gt, isNull, lt, lte, sql } from 'drizzle-orm';
import { resolveImageUrl } from '$lib/server/storage';
import { RADIO_MIN_TRACK_MS, RADIO_MAX_TRACK_MS } from '$lib/config';
import { buildSchedule, type EligibleTrack } from './radio-rotation';

// Re-exported so callers have one import for the station. The rules themselves
// live in `radio-rotation.ts`, which imports nothing — see its header.
export { pickNextTrack, type EligibleTrack } from './radio-rotation';

/** How far ahead the schedule is kept. Comfortably over the 15-minute cron. */
export const RADIO_HORIZON_MS = 45 * 60 * 1000;

/**
 * How much history survives. Long enough for a "recently played" list and for
 * the scheduler's own anti-repetition read, short enough that the table does not
 * become a permanent log of every song ever played.
 */
export const RADIO_HISTORY_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Every track the station may play, with when it last did.
 *
 * The duration bounds are the load-bearing filter. Without the ceiling a
 * forty-minute live set holds the stream for forty minutes and the rotation
 * reads as broken rather than as long.
 */
export async function listEligibleTracks(): Promise<EligibleTrack[]> {
	const rows = await db
		.select({
			trackId: audioTrack.id,
			durationMs: audioTrack.durationMs,
			groupId: audioRelease.groupId,
			lastPlayedAt: sql<number | null>`(
				SELECT MAX(${radioPlay.startsAt}) FROM ${radioPlay}
				WHERE ${radioPlay.trackId} = ${audioTrack.id}
			)`
		})
		.from(audioTrack)
		.innerJoin(audioRelease, eq(audioRelease.id, audioTrack.releaseId))
		.innerJoin(group, eq(group.id, audioRelease.groupId))
		.where(
			and(
				eq(audioRelease.status, 'published'),
				eq(audioRelease.radioOptIn, true),
				isNull(audioRelease.radioExcludedAt),
				isNull(audioRelease.deletedAt),
				isNull(audioTrack.radioExcludedAt),
				isNull(group.deletedAt),
				sql`${audioTrack.durationMs} >= ${RADIO_MIN_TRACK_MS}`,
				sql`${audioTrack.durationMs} <= ${RADIO_MAX_TRACK_MS}`
			)
		);

	return rows.map((r) => ({
		trackId: r.trackId,
		durationMs: r.durationMs,
		groupId: r.groupId,
		// SQLite hands back the raw unixepoch the column stores.
		lastPlayedAt: r.lastPlayedAt == null ? null : new Date(Number(r.lastPlayedAt) * 1000)
	}));
}

export type ScheduleResult = {
	/** Entries appended by this run. */
	scheduled: number;
	/** Expired entries removed. */
	pruned: number;
	/** True when nothing is eligible — the station is silent, not broken. */
	poolEmpty: boolean;
};

/**
 * Top the timetable up to the horizon, and drop what has aged out.
 *
 * Idempotent in the way a cron job has to be: it appends only as far as the
 * horizon, so running it twice a minute apart adds almost nothing the second
 * time. Nothing here updates a row.
 */
export async function scheduleRadio(
	options: { now?: Date; horizonMs?: number; random?: () => number } = {}
): Promise<ScheduleResult> {
	const now = options.now ?? new Date();
	const horizon = new Date(now.getTime() + (options.horizonMs ?? RADIO_HORIZON_MS));

	const pruned = await db
		.delete(radioPlay)
		.where(lt(radioPlay.endsAt, new Date(now.getTime() - RADIO_HISTORY_MS)))
		.returning({ id: radioPlay.id });

	const eligible = await listEligibleTracks();
	if (eligible.length === 0) {
		// An empty pool is the expected state before launch, and the reason the
		// station has a staff toggle at all. Scheduling nothing is correct.
		return { scheduled: 0, pruned: pruned.length, poolEmpty: true };
	}

	// Where the timetable currently ends. A gap — the station having been idle —
	// starts it again from now rather than backfilling silence nobody heard.
	const [last] = await db
		.select({ endsAt: radioPlay.endsAt, trackId: radioPlay.trackId })
		.from(radioPlay)
		.orderBy(desc(radioPlay.endsAt))
		.limit(1);

	const cursor = last && last.endsAt > now ? last.endsAt : now;
	const previousGroupId =
		last && last.endsAt > now
			? (eligible.find((t: EligibleTrack) => t.trackId === last.trackId)?.groupId ?? null)
			: null;

	const rows = buildSchedule(eligible, cursor, horizon, previousGroupId, options.random);

	if (rows.length > 0) {
		// 4 columns; chunked well under D1's 100 bound parameters per statement.
		for (let i = 0; i < rows.length; i += 20) {
			await db.insert(radioPlay).values(rows.slice(i, i + 20));
		}
	}

	return { scheduled: rows.length, pruned: pruned.length, poolEmpty: false };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export type RadioEntry = {
	playId: string;
	trackId: string;
	trackTitle: string;
	releaseId: string;
	releaseTitle: string;
	bandName: string;
	bandSlug: string;
	coverUrl: string | null;
	startsAt: Date;
	endsAt: Date;
	durationMs: number;
};

/** One join, reused by now/next/recent — they differ only in their window. */
function entryQuery() {
	return db
		.select({
			playId: radioPlay.id,
			trackId: audioTrack.id,
			trackTitle: audioTrack.title,
			durationMs: audioTrack.durationMs,
			releaseId: audioRelease.id,
			releaseTitle: audioRelease.title,
			bandName: group.name,
			bandSlug: group.slug,
			coverKey: media.key,
			startsAt: radioPlay.startsAt,
			endsAt: radioPlay.endsAt
		})
		.from(radioPlay)
		.innerJoin(audioTrack, eq(audioTrack.id, radioPlay.trackId))
		.innerJoin(audioRelease, eq(audioRelease.id, audioTrack.releaseId))
		.innerJoin(group, eq(group.id, audioRelease.groupId))
		.leftJoin(
			mediaAttachment,
			and(
				eq(mediaAttachment.attachableType, 'audio_release'),
				eq(mediaAttachment.attachableId, audioRelease.id),
				eq(mediaAttachment.slot, 'cover')
			)
		)
		.leftJoin(media, eq(media.id, mediaAttachment.mediaId));
}

// The builder is thenable, so awaiting it gives the row array directly — no
// second `ReturnType`, which would try to call the builder.
type EntryRow = Awaited<ReturnType<typeof entryQuery>>[number];

function toEntry(row: EntryRow): RadioEntry {
	return {
		playId: row.playId,
		trackId: row.trackId,
		trackTitle: row.trackTitle,
		releaseId: row.releaseId,
		releaseTitle: row.releaseTitle,
		bandName: row.bandName,
		bandSlug: row.bandSlug,
		coverUrl: resolveImageUrl(row.coverKey),
		startsAt: row.startsAt,
		endsAt: row.endsAt,
		durationMs: row.durationMs
	};
}

export type RadioNow = {
	/**
	 * The server's clock at the moment of the read.
	 *
	 * The client seeks to `now - startsAt`, and a listener whose machine is a
	 * minute out would otherwise start every track a minute into it — or past its
	 * end. Sending the server's own time lets the client measure its offset once
	 * and correct for it, which is what makes "everyone hears the same thing"
	 * true rather than approximately true.
	 */
	serverNow: Date;
	current: RadioEntry | null;
	upNext: RadioEntry[];
};

export async function getRadioNow(now: Date = new Date()): Promise<RadioNow> {
	const [current] = await entryQuery()
		.where(and(lte(radioPlay.startsAt, now), gt(radioPlay.endsAt, now)))
		.limit(1);

	const upNext = await entryQuery()
		.where(gt(radioPlay.startsAt, now))
		.orderBy(asc(radioPlay.startsAt))
		.limit(3);

	return {
		serverNow: now,
		current: current ? toEntry(current) : null,
		upNext: upNext.map(toEntry)
	};
}

export async function getRecentlyPlayed(limit = 10, now: Date = new Date()): Promise<RadioEntry[]> {
	const rows = await entryQuery()
		.where(lte(radioPlay.endsAt, now))
		.orderBy(desc(radioPlay.startsAt))
		.limit(limit);
	return rows.map(toEntry);
}

/** Distinct bands currently in rotation, for the station page's credits. */
export async function listStationBands(): Promise<{ name: string; slug: string }[]> {
	const rows = await db
		.selectDistinct({ name: group.name, slug: group.slug })
		.from(audioRelease)
		.innerJoin(group, eq(group.id, audioRelease.groupId))
		.where(
			and(
				eq(audioRelease.status, 'published'),
				eq(audioRelease.radioOptIn, true),
				isNull(audioRelease.radioExcludedAt),
				isNull(audioRelease.deletedAt),
				isNull(group.deletedAt)
			)
		)
		.orderBy(asc(group.name));
	return rows;
}
