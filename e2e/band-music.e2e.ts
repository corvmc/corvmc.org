import { expect, test, type Page } from './fixtures/test';
import { signInAs } from './fixtures/auth';
import {
	SEED_OWNER_EMAIL,
	SEED_OWNER_PASSWORD,
	SEED_PUBLIC_BAND_SLUG
} from './fixtures/seed-band-onboarding';
import {
	SEED_AUDIO_RELEASE_ID,
	SEED_AUDIO_RELEASE_TITLE,
	SEED_AUDIO_TRACK_TITLE,
	SEED_AUDIO_DRAFT_ID,
	SEED_AUDIO_DRAFT_TITLE,
	SEED_AUDIO_DELETABLE_ID,
	SEED_AUDIO_DELETABLE_TRACK_ID,
	SEED_AUDIO_UNPUBLISHED_TRACK_ID,
	SEED_AUDIO_TRACK_SECONDS
} from './fixtures/seed-band-audio';
import { readLocalDb } from './fixtures/platform-db';
import { audioRelease, audioTrack } from '../src/lib/server/db/schema/audio';
import { eq } from 'drizzle-orm';

/**
 * The band music panel and the stream endpoint behind it.
 *
 * The streaming assertions are the ones that cannot be made anywhere else. Range
 * handling is the difference between a track that plays and one that Safari
 * silently refuses — Safari opens every media request with `Range: bytes=0-1`
 * and will not play a file that answers it with a 200. A unit test can pin the
 * arithmetic (`audio-storage.spec.ts` does) but only a real request through
 * workerd and R2 proves the endpoint wires it up.
 */

const band = `/band/${SEED_PUBLIC_BAND_SLUG}`;
// Check quickly once, then back off hard. `readLocalDb` opens the same file the
// preview server is writing through workerd, and Playwright's default poll
// intervals — a dozen reads per 15s window — were enough to push the *next*
// suite's server into SQLITE_BUSY on CI.
const DB_POLL = { timeout: 15000, intervals: [250, 500, 1000, 2000, 3000] };

async function login(page: Page) {
	await signInAs(page, { email: SEED_OWNER_EMAIL, password: SEED_OWNER_PASSWORD });
}

function streamUrl(trackId: string) {
	return `/api/audio/track/${trackId}/stream`;
}

test.describe('band music panel', () => {
	test('lists the band’s releases with their track counts', async ({ page }) => {
		await login(page);
		await page.goto(`${band}/music`);

		await expect(page.getByText(SEED_AUDIO_RELEASE_TITLE)).toBeVisible({ timeout: 15000 });
		await expect(page.getByText(SEED_AUDIO_DRAFT_TITLE)).toBeVisible();
		// A draft has to be visibly a draft, or a band cannot tell what is public.
		// The draft badge is the card's only ghost one.
		await expect(page.locator('.badge-ghost').first()).toBeVisible();
	});

	test('shows the tracklist and a play control on the release page', async ({ page }) => {
		await login(page);
		await page.goto(`${band}/music/${SEED_AUDIO_RELEASE_ID}`);

		await expect(page.getByText(SEED_AUDIO_TRACK_TITLE)).toBeVisible({ timeout: 15000 });
		await expect(
			page.getByRole('button', { name: `Play ${SEED_AUDIO_TRACK_TITLE}` })
		).toBeVisible();
		// 32 seconds, from the fixture's synthesized WAV.
		const m = Math.floor(SEED_AUDIO_TRACK_SECONDS / 60);
		const s = String(SEED_AUDIO_TRACK_SECONDS % 60).padStart(2, '0');
		await expect(page.getByText(`${m}:${s}`).first()).toBeVisible();
	});
});

test.describe('stream endpoint', () => {
	test('will not stream a track from an unpublished release, signed in or not', async ({
		request
	}) => {
		// Publication is the only paywall on streaming — full tracks are free by
		// design — so this is the one access rule the endpoint has, and it has to
		// hold for the band's own owner too. A draft has never been shown to
		// anybody.
		const response = await request.get(streamUrl(SEED_AUDIO_UNPUBLISHED_TRACK_ID));
		expect(response.status()).toBe(404);
	});
});

test.describe('publishing', () => {
	// Owns SEED_AUDIO_DRAFT_ID. A retry cannot rescue this test once it has
	// written, so nothing else asserts on that release's status.
	test('publishes a draft and the release becomes public', async ({ page }) => {
		await login(page);
		await page.goto(`${band}/music/${SEED_AUDIO_DRAFT_ID}`);

		await page.getByTestId('publish-release').click();
		await page.getByRole('dialog').locator('button[type="submit"]').click();

		await expect
			.poll(
				() =>
					readLocalDb((db) =>
						db
							.select({ status: audioRelease.status })
							.from(audioRelease)
							.where(eq(audioRelease.id, SEED_AUDIO_DRAFT_ID))
					).then(([row]) => row?.status),
				DB_POLL
			)
			.toBe('published');

		// Publishing is what puts the track on the air, so the stream must open.
		const response = await page.request.get(streamUrl(SEED_AUDIO_UNPUBLISHED_TRACK_ID));
		expect(response.status()).toBe(200);
	});
});

test.describe('deleting', () => {
	// Owns SEED_AUDIO_DELETABLE_ID.
	test('deletes an unsold release and its tracks', async ({ page }) => {
		await login(page);
		await page.goto(`${band}/music/${SEED_AUDIO_DELETABLE_ID}`);

		await page.getByTestId('delete-release').click();
		await page.getByRole('dialog').locator('button[type="submit"]').click();

		await expect
			.poll(
				() =>
					readLocalDb((db) =>
						db
							.select({ id: audioRelease.id })
							.from(audioRelease)
							.where(eq(audioRelease.id, SEED_AUDIO_DELETABLE_ID))
					).then((rows) => rows.length),
				DB_POLL
			)
			.toBe(0);

		// The tracks go with it. Nothing shares these objects the way media rows
		// share a poster, so there is no sweep to leave them to.
		// Safe as a one-shot read: the poll above has already seen this
		// transaction's write, so a fresh reader cannot still be behind it.
		const tracks = await readLocalDb((db) =>
			db
				.select({ id: audioTrack.id })
				.from(audioTrack)
				.where(eq(audioTrack.id, SEED_AUDIO_DELETABLE_TRACK_ID))
		);
		expect(tracks).toHaveLength(0);
	});
});
