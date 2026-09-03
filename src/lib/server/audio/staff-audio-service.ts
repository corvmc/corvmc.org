/**
 * What staff can see and do about music, across every band.
 *
 * Two jobs that share a table. **Moderation**: withhold a release, pull a record
 * or a single track off the air. And **the launch question** — is there enough
 * music for the station to sound like one — which is the whole reason `cmcRadio`
 * has a toggle, and which cannot be answered from behind that toggle.
 */
import { db } from '$lib/server/db';
import { audioRelease, audioTrack, releasePurchase } from '$lib/server/db/schema/audio';
import { group } from '$lib/server/db/schema/group';
import { and, count, desc, eq, isNull, sql } from 'drizzle-orm';
import { DomainError } from '$lib/server/domain-error';
import { RADIO_MIN_TRACK_MS, RADIO_MAX_TRACK_MS } from '$lib/config';
import { releaseAggregates } from './audio-service';

export class StaffReleaseNotFoundError extends DomainError {
	readonly httpStatus = 404;
	constructor() {
		super('Release not found');
	}
}

export type StaffReleaseRow = {
	id: string;
	title: string;
	slug: string;
	status: string;
	bandName: string;
	bandSlug: string;
	priceMinCents: number;
	radioOptIn: boolean;
	radioExcluded: boolean;
	radioExcludedReason: string | null;
	trackCount: number;
	salesCount: number;
	publishedAt: Date | null;
};

/** Every release, newest first. Drafts included — staff see the whole table. */
export async function listAllReleases(): Promise<StaffReleaseRow[]> {
	const rows = await db
		.select({
			id: audioRelease.id,
			title: audioRelease.title,
			slug: audioRelease.slug,
			status: audioRelease.status,
			bandName: group.name,
			bandSlug: group.slug,
			priceMinCents: audioRelease.priceMinCents,
			radioOptIn: audioRelease.radioOptIn,
			radioExcludedAt: audioRelease.radioExcludedAt,
			radioExcludedReason: audioRelease.radioExcludedReason,
			publishedAt: audioRelease.publishedAt,
			// Correlated rather than joined: tracks and purchases fan out
			// independently, and joining both multiplies each by the other.
			// The shared, table-qualified fragments. This list happens to join
			// `group`, so the interpolated form worked here and nowhere else —
			// which is exactly why it is not worth relying on.
			trackCount: releaseAggregates.TRACK_COUNT,
			salesCount: releaseAggregates.PAID_SALES
		})
		.from(audioRelease)
		.innerJoin(group, eq(group.id, audioRelease.groupId))
		.where(isNull(audioRelease.deletedAt))
		.orderBy(desc(audioRelease.createdAt));

	return rows.map((r) => ({
		id: r.id,
		title: r.title,
		slug: r.slug,
		status: r.status,
		bandName: r.bandName,
		bandSlug: r.bandSlug,
		priceMinCents: r.priceMinCents,
		radioOptIn: r.radioOptIn,
		radioExcluded: r.radioExcludedAt !== null,
		radioExcludedReason: r.radioExcludedReason,
		trackCount: Number(r.trackCount),
		salesCount: Number(r.salesCount),
		publishedAt: r.publishedAt
	}));
}

/**
 * How much music the station actually has.
 *
 * Deliberately reported as the same three numbers the scheduler's own filter
 * produces, because "37 releases" is not the answer — a release nobody opted in,
 * or whose tracks are all forty minutes long, contributes nothing. The eligible
 * *track* count and the number of distinct bands behind it are what tell you
 * whether a rotation will sound like a station or like one band on repeat.
 */
export async function radioPoolStats(): Promise<{
	eligibleTracks: number;
	bands: number;
	optedInReleases: number;
	excludedByLength: number;
}> {
	const eligible = and(
		eq(audioRelease.status, 'published'),
		eq(audioRelease.radioOptIn, true),
		isNull(audioRelease.radioExcludedAt),
		isNull(audioRelease.deletedAt),
		isNull(audioTrack.radioExcludedAt),
		isNull(group.deletedAt)
	);

	const [pool] = await db
		.select({
			tracks: sql<number>`COUNT(CASE WHEN ${audioTrack.durationMs} BETWEEN ${RADIO_MIN_TRACK_MS} AND ${RADIO_MAX_TRACK_MS} THEN 1 END)`,
			bands: sql<number>`COUNT(DISTINCT CASE WHEN ${audioTrack.durationMs} BETWEEN ${RADIO_MIN_TRACK_MS} AND ${RADIO_MAX_TRACK_MS} THEN ${audioRelease.groupId} END)`,
			// The number worth surfacing separately: a band whose whole record is
			// out of range has opted in and will still never be heard, and would
			// otherwise have no way to find that out.
			outOfRange: sql<number>`COUNT(CASE WHEN ${audioTrack.durationMs} NOT BETWEEN ${RADIO_MIN_TRACK_MS} AND ${RADIO_MAX_TRACK_MS} THEN 1 END)`
		})
		.from(audioTrack)
		.innerJoin(audioRelease, eq(audioRelease.id, audioTrack.releaseId))
		.innerJoin(group, eq(group.id, audioRelease.groupId))
		.where(eligible);

	const [releases] = await db
		.select({ value: count() })
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
		);

	return {
		eligibleTracks: Number(pool?.tracks ?? 0),
		bands: Number(pool?.bands ?? 0),
		optedInReleases: Number(releases?.value ?? 0),
		excludedByLength: Number(pool?.outOfRange ?? 0)
	};
}

/** Sales across every band, for the collective's own reporting. */
export async function salesTotals() {
	const [row] = await db
		.select({
			sales: count(),
			gross: sql<number>`COALESCE(SUM(${releasePurchase.amountPaidCents}), 0)`,
			toBands: sql<number>`COALESCE(SUM(${releasePurchase.bandNetCents}), 0)`,
			toCollective: sql<number>`COALESCE(SUM(${releasePurchase.platformFeeCents}), 0)`,
			free: sql<number>`COUNT(CASE WHEN ${releasePurchase.amountPaidCents} = 0 THEN 1 END)`
		})
		.from(releasePurchase)
		.where(eq(releasePurchase.status, 'paid'));

	const grossCents = Number(row?.gross ?? 0);
	const toCollectiveCents = Number(row?.toCollective ?? 0);

	return {
		sales: Number(row?.sales ?? 0),
		freeSales: Number(row?.free ?? 0),
		grossCents,
		toBandsCents: Number(row?.toBands ?? 0),
		toCollectiveCents,
		/**
		 * What the collective actually kept, as a share of what buyers paid.
		 *
		 * The number the refusable-cut decision has to be judged on. It will not be
		 * 10%: buyers who take it to zero pull it down and buyers who give more push
		 * it up, and which way it lands is the whole open question. Reported so the
		 * suggested default can be moved on evidence rather than on nerves.
		 */
		realisedTakeBps: grossCents > 0 ? Math.round((toCollectiveCents / grossCents) * 10000) : 0
	};
}

// ---------------------------------------------------------------------------
// Moderation
// ---------------------------------------------------------------------------

/**
 * Take a release down.
 *
 * `withheld` rather than `draft`, so the band cannot simply press Publish again —
 * unpublishing your own work and having it unpublished for you are different
 * facts, and `publishRelease` refuses to move a withheld row.
 */
export async function withholdRelease(releaseId: string, reason: string) {
	const [row] = await db
		.update(audioRelease)
		.set({
			status: 'withheld',
			radioExcludedAt: new Date(),
			radioExcludedReason: reason,
			updatedAt: new Date()
		})
		.where(eq(audioRelease.id, releaseId))
		.returning();
	if (!row) throw new StaffReleaseNotFoundError();
	return row;
}

/** Put a withheld release back where the band left it: as a draft, theirs to publish. */
export async function restoreRelease(releaseId: string) {
	const [row] = await db
		.update(audioRelease)
		.set({
			status: 'draft',
			radioExcludedAt: null,
			radioExcludedReason: null,
			updatedAt: new Date()
		})
		.where(eq(audioRelease.id, releaseId))
		.returning();
	if (!row) throw new StaffReleaseNotFoundError();
	return row;
}

/**
 * Pull a release off the air without taking it down.
 *
 * Separate from `radioOptIn`, which is the band's consent: staff clearing a veto
 * must not re-broadcast something the band itself opted out of in the meantime,
 * and a band re-opting in must not silently undo a staff decision.
 */
export async function setRadioExclusion(releaseId: string, excluded: boolean, reason?: string) {
	const [row] = await db
		.update(audioRelease)
		.set({
			radioExcludedAt: excluded ? new Date() : null,
			radioExcludedReason: excluded ? (reason ?? null) : null,
			updatedAt: new Date()
		})
		.where(eq(audioRelease.id, releaseId))
		.returning();
	if (!row) throw new StaffReleaseNotFoundError();
	return row;
}

/** The same, for one recording rather than a whole record. */
export async function setTrackRadioExclusion(trackId: string, excluded: boolean) {
	const [row] = await db
		.update(audioTrack)
		.set({ radioExcludedAt: excluded ? new Date() : null, updatedAt: new Date() })
		.where(eq(audioTrack.id, trackId))
		.returning();
	if (!row) throw new StaffReleaseNotFoundError();
	return row;
}
