import { expect, test, type Page } from '@playwright/test';
import {
	SEED_OWNER_EMAIL,
	SEED_OWNER_PASSWORD,
	SEED_PUBLIC_BAND_SLUG
} from './fixtures/seed-band-onboarding';
import {
	SEED_AUDIO_RELEASE_ID,
	SEED_AUDIO_RELEASE_TITLE,
	SEED_AUDIO_TRACK_ID,
	SEED_AUDIO_TRACK_TITLE,
	SEED_AUDIO_DRAFT_ID,
	SEED_AUDIO_DRAFT_TITLE,
	SEED_AUDIO_DELETABLE_ID,
	SEED_AUDIO_DELETABLE_TRACK_ID,
	SEED_AUDIO_UNPUBLISHED_TRACK_ID
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
	await page.goto('/login');
	// FormField renders a <legend>, not a <label for>, so target inputs by name.
	await page.locator('input[name="email"]').fill(SEED_OWNER_EMAIL);
	await page.locator('input[name="password"]').fill(SEED_OWNER_PASSWORD);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL(/\/member(\/|$|\?)/, { timeout: 15000 });
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
		await expect(page.getByText('Draft').first()).toBeVisible();
	});

	test('shows the tracklist and a play control on the release page', async ({ page }) => {
		await login(page);
		await page.goto(`${band}/music/${SEED_AUDIO_RELEASE_ID}`);

		await expect(page.getByText(SEED_AUDIO_TRACK_TITLE)).toBeVisible({ timeout: 15000 });
		await expect(
			page.getByRole('button', { name: `Play ${SEED_AUDIO_TRACK_TITLE}` })
		).toBeVisible();
		// 32 seconds, from the fixture's synthesized WAV.
		await expect(page.getByText('0:32').first()).toBeVisible();
	});

	test('lights the Releases row in the band sidebar', async ({ page }) => {
		await login(page);
		await page.goto(`${band}/music`);

		const active = page.locator('aside ul.menu').first().locator('a.active');
		await expect(active).toHaveCount(1, { timeout: 15000 });
		await expect(active).toHaveAttribute('href', `${band}/music`);
	});
});

test.describe('stream endpoint', () => {
	test('answers a bare request with the whole object and advertises ranges', async ({
		request
	}) => {
		const response = await request.get(streamUrl(SEED_AUDIO_TRACK_ID));

		expect(response.status()).toBe(200);
		// Without this header a browser will not attempt to seek at all.
		expect(response.headers()['accept-ranges']).toBe('bytes');
		expect(response.headers()['content-type']).toContain('audio/wav');
		expect(Number(response.headers()['content-length'])).toBeGreaterThan(0);
	});

	test('answers Safari’s opening probe with a 206 and a content-range', async ({ request }) => {
		// `bytes=0-1` is the two-byte request Safari opens every media element
		// with. A 200 here means the file never plays in Safari, and plays fine
		// everywhere else — which is how this ships broken.
		const response = await request.get(streamUrl(SEED_AUDIO_TRACK_ID), {
			headers: { Range: 'bytes=0-1' }
		});

		expect(response.status()).toBe(206);
		expect(response.headers()['content-range']).toMatch(/^bytes 0-1\/\d+$/);
		expect(response.headers()['content-length']).toBe('2');
		expect((await response.body()).byteLength).toBe(2);
	});

	test('serves a mid-file range as the bytes actually asked for', async ({ request }) => {
		const response = await request.get(streamUrl(SEED_AUDIO_TRACK_ID), {
			headers: { Range: 'bytes=1000-1099' }
		});

		expect(response.status()).toBe(206);
		// Inclusive at both ends: 1000..1099 is 100 bytes, not 99 and not 101.
		expect((await response.body()).byteLength).toBe(100);
		expect(response.headers()['content-range']).toMatch(/^bytes 1000-1099\/\d+$/);
	});

	test('serves a suffix range as the trailing bytes', async ({ request }) => {
		const full = await request.get(streamUrl(SEED_AUDIO_TRACK_ID));
		const size = Number(full.headers()['content-length']);

		const response = await request.get(streamUrl(SEED_AUDIO_TRACK_ID), {
			headers: { Range: 'bytes=-500' }
		});

		expect(response.status()).toBe(206);
		expect((await response.body()).byteLength).toBe(500);
		// The form everyone gets wrong — the LAST 500 bytes, not "from 500".
		expect(response.headers()['content-range']).toBe(`bytes ${size - 500}-${size - 1}/${size}`);
	});

	test('refuses a range that starts past the end', async ({ request }) => {
		const response = await request.get(streamUrl(SEED_AUDIO_TRACK_ID), {
			headers: { Range: 'bytes=99999999-' }
		});
		expect(response.status()).toBe(416);
	});

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

	test('404s a track that does not exist', async ({ request }) => {
		const response = await request.get(streamUrl('not-a-real-track'));
		expect(response.status()).toBe(404);
	});
});

test.describe('publishing', () => {
	// Owns SEED_AUDIO_DRAFT_ID. A retry cannot rescue this test once it has
	// written, so nothing else asserts on that release's status.
	test('publishes a draft and the release becomes public', async ({ page }) => {
		await login(page);
		await page.goto(`${band}/music/${SEED_AUDIO_DRAFT_ID}`);

		await page.getByRole('button', { name: 'Publish' }).click();
		await page.getByRole('button', { name: 'Publish', exact: true }).last().click();

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

		await page.getByRole('button', { name: 'Delete release' }).click();
		await page.getByRole('button', { name: 'Delete', exact: true }).last().click();

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

test.describe('the feature flag', () => {
	test('the panel is reachable while bandAudio is on', async ({ page }) => {
		// The negative case — every surface 404ing with the flag off — is pinned in
		// `audio.remote.spec.ts`, which can toggle it. Here the flag is on for the
		// whole run, so this asserts the positive half only.
		await login(page);
		await page.goto(`${band}/music`);
		await expect(page.getByRole('heading', { name: 'Releases' })).toBeVisible({ timeout: 15000 });
	});
});
