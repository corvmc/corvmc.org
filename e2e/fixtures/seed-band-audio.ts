/**
 * Releases, tracks, and the audio objects behind them, for `band-music.e2e.ts`.
 *
 * The objects are the point. A track row whose R2 object does not exist renders
 * as a playable row that 404s on click, so a fixture that seeded rows alone
 * would let the streaming assertions pass against nothing. `withPlatformEnv`
 * hands over the same `R2_PRIVATE` binding the Worker gets, so the bytes go in
 * beside the rows.
 *
 * Three releases, because three tests mutate and **a retry cannot rescue a
 * mutating test** — one that fails after its write has already spent the row it
 * needed. Giving publish and delete a release each keeps a failure in one from
 * reddening the other, and keeps both away from the release the read-only
 * assertions run against.
 */
import { eq, inArray } from 'drizzle-orm';
import { audioRelease, audioTrack } from '../../src/lib/server/db/schema/audio';
import { synthesizeTrack } from '../../scripts/seed/audio-fixtures';
import { withPlatformEnv } from './platform-db';
import { SEED_PUBLIC_BAND_ID } from './seed-band-onboarding';

/** Read-only: the panel list, the tracklist, and the stream endpoint. */
export const SEED_AUDIO_RELEASE_ID = 'e2e-release-published';
export const SEED_AUDIO_RELEASE_TITLE = 'E2E Published Record';
export const SEED_AUDIO_RELEASE_SLUG = 'e2e-published-record';
export const SEED_AUDIO_TRACK_ID = 'e2e-track-published-1';
export const SEED_AUDIO_TRACK_TITLE = 'E2E Opening Track';
export const SEED_AUDIO_TRACK_SECONDS = 32;

/** Owned by the publish test. */
export const SEED_AUDIO_DRAFT_ID = 'e2e-release-draft';
export const SEED_AUDIO_DRAFT_TITLE = 'E2E Draft Record';
export const SEED_AUDIO_DRAFT_TRACK_ID = 'e2e-track-draft-1';

/** Owned by the delete test. */
export const SEED_AUDIO_DELETABLE_ID = 'e2e-release-deletable';
export const SEED_AUDIO_DELETABLE_TITLE = 'E2E Deletable Record';
export const SEED_AUDIO_DELETABLE_TRACK_ID = 'e2e-track-deletable-1';

/**
 * A draft's track, used to assert the stream endpoint refuses it. Publication is
 * the only paywall on streaming, so this is the case that proves it exists.
 */
export const SEED_AUDIO_UNPUBLISHED_TRACK_ID = SEED_AUDIO_DRAFT_TRACK_ID;

const RELEASE_IDS = [SEED_AUDIO_RELEASE_ID, SEED_AUDIO_DRAFT_ID, SEED_AUDIO_DELETABLE_ID];

const keyFor = (trackId: string) => `bands/audio/${trackId}.wav`;

export async function seedBandAudio(): Promise<void> {
	await withPlatformEnv(async ({ db, env }) => {
		// Clean slate, children first: local D1 may have foreign keys off, so the
		// cascade cannot be relied on here.
		await db.delete(audioTrack).where(inArray(audioTrack.releaseId, RELEASE_IDS));
		for (const id of RELEASE_IDS) {
			await db.delete(audioRelease).where(eq(audioRelease.id, id));
		}

		const now = new Date();
		await db.insert(audioRelease).values([
			{
				id: SEED_AUDIO_RELEASE_ID,
				groupId: SEED_PUBLIC_BAND_ID,
				title: SEED_AUDIO_RELEASE_TITLE,
				slug: SEED_AUDIO_RELEASE_SLUG,
				kind: 'album',
				status: 'published',
				priceMinCents: 1000,
				allowPayMore: true,
				radioOptIn: true,
				publishedAt: now,
				releasedAt: now,
				createdAt: now,
				updatedAt: now
			},
			{
				id: SEED_AUDIO_DRAFT_ID,
				groupId: SEED_PUBLIC_BAND_ID,
				title: SEED_AUDIO_DRAFT_TITLE,
				slug: 'e2e-draft-record',
				kind: 'ep',
				status: 'draft',
				createdAt: now,
				updatedAt: now
			},
			{
				id: SEED_AUDIO_DELETABLE_ID,
				groupId: SEED_PUBLIC_BAND_ID,
				title: SEED_AUDIO_DELETABLE_TITLE,
				slug: 'e2e-deletable-record',
				kind: 'demo',
				status: 'draft',
				createdAt: now,
				updatedAt: now
			}
		]);

		const tracks = [
			{ id: SEED_AUDIO_TRACK_ID, releaseId: SEED_AUDIO_RELEASE_ID, title: SEED_AUDIO_TRACK_TITLE },
			{ id: SEED_AUDIO_DRAFT_TRACK_ID, releaseId: SEED_AUDIO_DRAFT_ID, title: 'E2E Draft Track' },
			{
				id: SEED_AUDIO_DELETABLE_TRACK_ID,
				releaseId: SEED_AUDIO_DELETABLE_ID,
				title: 'E2E Deletable Track'
			}
		];

		const bucket = (env as { R2_PRIVATE?: R2Bucket }).R2_PRIVATE;

		for (const [index, track] of tracks.entries()) {
			const bytes = synthesizeTrack(index, SEED_AUDIO_TRACK_SECONDS);
			const key = keyFor(track.id);

			await db.insert(audioTrack).values({
				id: track.id,
				releaseId: track.releaseId,
				title: track.title,
				trackNumber: 1,
				durationMs: SEED_AUDIO_TRACK_SECONDS * 1000,
				objectKey: key,
				contentType: 'audio/wav',
				byteSize: bytes.byteLength,
				originalFilename: `${track.title}.wav`,
				createdAt: now,
				updatedAt: now
			});

			// Sequential, and only after the row: this is the local miniflare
			// bucket, and a dozen concurrent multi-megabyte puts is how it starts
			// returning I/O errors that read as schema problems.
			await bucket?.put(key, bytes, { httpMetadata: { contentType: 'audio/wav' } });
		}
	});
}

/** The exact byte length of a seeded track, for the Range assertions. */
export function seededTrackBytes(index = 0): number {
	return synthesizeTrack(index, SEED_AUDIO_TRACK_SECONDS).byteLength;
}
