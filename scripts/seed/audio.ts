/**
 * Band releases, their tracks, and the sales behind them.
 *
 * Writes real audio into the local private bucket, not just rows. A track whose
 * object does not exist is a track you cannot press play on, and every surface
 * downstream of this — the release page, the band's music panel, the radio
 * widget — is a player. `getPlatformProxy()` hands the seeder the same
 * `R2_PRIVATE` binding the Worker gets, so this costs one `put` per track.
 *
 * `radio_play` is deliberately NOT seeded here. The scheduler owns that table
 * and materializes it from wall clock; seeding it would mean writing a second,
 * worse copy of the selection rules that then drifts. Phase 3 calls the real
 * scheduler from this seeder instead.
 */
import { randomUUID } from 'crypto';
import {
	audioRelease,
	audioTrack,
	bandStripeAccount,
	releasePurchase
} from '../../src/lib/server/db/schema/audio';
import { media, mediaAttachment } from '../../src/lib/server/db/schema/media';
import { calculateProcessingFee, calculateTotalWithFeeCoverage } from '../../src/lib/finance/fees';
import { AUDIO_PLATFORM_FEE_BPS } from '../../src/lib/config';
import { batchInsert, env } from './db';
import { synthesizeTrack } from './audio-fixtures';
import { pick, randomInt } from './util';

// ---------------------------------------------------------------------------
// Pools
// ---------------------------------------------------------------------------

const RELEASE_TITLES = [
	'Marys Peak',
	'Second Story Window',
	'Willamette Fog',
	'Basement Tapes Vol. 2',
	'Nothing Is Open',
	'Alsea',
	'Handshake Deal',
	'Late Bus Home',
	'Corvallis After Dark',
	'Ten Minutes of Rain'
];

const TRACK_TITLES = [
	'Opening Statement',
	'Ferris Wheel',
	'Cold Garage',
	'Thirty-Seven',
	'Blue Line',
	'Every Other Tuesday',
	'Paper Streets',
	'Understory',
	'Hollow Bones',
	'Long Way Round',
	'Radio Silence',
	'Backfill',
	'Kept the Receipt',
	'Two Weeks Notice',
	'Closing Time'
];

/**
 * The mix is the point. Each shape below exists because some surface is only
 * reachable when a row looks like this — a free record for the no-Stripe path,
 * a draft for the unpublished state, a vetoed one for the staff rotation
 * screen, and a paid one nobody has bought yet for the empty sales report.
 */
const RELEASE_SHAPES = [
	{ kind: 'album', status: 'published', priceMinCents: 1000, radioOptIn: true, trackCount: 4 },
	{ kind: 'ep', status: 'published', priceMinCents: 0, radioOptIn: true, trackCount: 3 },
	{ kind: 'single', status: 'published', priceMinCents: 200, radioOptIn: true, trackCount: 1 },
	{ kind: 'demo', status: 'draft', priceMinCents: 0, radioOptIn: false, trackCount: 2 },
	{ kind: 'live', status: 'published', priceMinCents: 700, radioOptIn: true, trackCount: 3 },
	{ kind: 'ep', status: 'published', priceMinCents: 500, radioOptIn: false, trackCount: 2 }
] as const;

function slugify(title: string): string {
	return title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
}

/**
 * The same arithmetic `audio-split.ts` will own in phase 4, inlined here so the
 * seeded rows are internally consistent — a band reconciling demo data should
 * find it adds up. Deliberately not exported: when the real module lands, this
 * goes and the seeder imports that instead.
 */
function split(baseCents: number, cmcBps: number, coverFees: boolean) {
	const charge = coverFees ? calculateTotalWithFeeCoverage(baseCents).totalCents : baseCents;
	const stripeFee = calculateProcessingFee(charge);
	const platformFeeCents = Math.round((baseCents * cmcBps) / 10000);
	return {
		amountPaidCents: charge,
		platformFeeCents,
		bandNetCents: charge - platformFeeCents - stripeFee,
		feeCoveredCents: charge - baseCents
	};
}

// ---------------------------------------------------------------------------

export async function seedAudio(bands: any[], users: any[]) {
	console.log('Seeding band audio (releases, tracks, sales)...');

	const live = bands.filter((b: any) => !b.deletedAt).slice(0, 6);
	if (live.length === 0) return { releases: 0, tracks: 0, purchases: 0, bytes: 0, accounts: 0 };

	const releaseRows: any[] = [];
	const trackRows: any[] = [];
	const mediaRows: any[] = [];
	const attachmentRows: any[] = [];
	const objects: { key: string; bytes: Uint8Array }[] = [];

	let titleCursor = 0;
	let trackCursor = 0;
	let synthSeed = 0;

	for (let i = 0; i < live.length; i++) {
		const band = live[i];
		const shape = RELEASE_SHAPES[i % RELEASE_SHAPES.length];
		const title = RELEASE_TITLES[titleCursor++ % RELEASE_TITLES.length];
		const releaseId = randomUUID();
		const published = shape.status === 'published';

		// One record is pulled by staff, so the rotation screen and the "why is my
		// record not on the air" path both have something to show.
		const vetoed = i === 2;

		releaseRows.push({
			id: releaseId,
			groupId: band.id,
			title,
			slug: slugify(title),
			kind: shape.kind,
			description: `${title} — recorded at the Corvallis Music Collective.`,
			releasedAt: new Date(Date.now() - randomInt(30, 900) * 24 * 60 * 60 * 1000),
			status: shape.status,
			priceMinCents: shape.priceMinCents,
			allowPayMore: shape.priceMinCents > 0,
			radioOptIn: shape.radioOptIn,
			radioExcludedAt: vetoed ? new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) : null,
			radioExcludedReason: vetoed ? 'Uncleared sample in track 2 — band notified.' : null,
			publishedAt: published ? new Date(Date.now() - randomInt(1, 60) * 86400000) : null,
			createdAt: new Date(),
			updatedAt: new Date(),
			deletedAt: null
		});

		// Cover art rides `media` like every other image. The key points at a
		// placeholder rather than a real object, matching `seedBandSites`.
		const mediaId = randomUUID();
		mediaRows.push({
			id: mediaId,
			key: `audio/covers/${releaseId}-seed.jpg`,
			contentType: 'image/jpeg',
			byteSize: randomInt(80_000, 400_000),
			filename: `${slugify(title)}-cover.jpg`,
			altText: `Cover art for ${title} by ${band.name}`,
			caption: null,
			uploadedByUserId: null,
			createdAt: new Date()
		});
		attachmentRows.push({
			id: randomUUID(),
			mediaId,
			attachableType: 'audio_release',
			attachableId: releaseId,
			slot: 'cover',
			sortOrder: 0,
			createdAt: new Date()
		});

		for (let n = 1; n <= shape.trackCount; n++) {
			const trackId = randomUUID();
			// Just over the station's 30s floor, so a demo rotation turns over in
			// under a minute instead of holding one track for the whole session.
			const seconds = 32 + (synthSeed % 7);
			const bytes = synthesizeTrack(synthSeed++, seconds);
			const key = `bands/audio/${trackId}-${randomUUID().slice(0, 8)}.wav`;
			objects.push({ key, bytes });

			const trackTitle = TRACK_TITLES[trackCursor++ % TRACK_TITLES.length];
			trackRows.push({
				id: trackId,
				releaseId,
				title: trackTitle,
				trackNumber: n,
				durationMs: seconds * 1000,
				objectKey: key,
				contentType: 'audio/wav',
				byteSize: bytes.byteLength,
				originalFilename: `${String(n).padStart(2, '0')} ${trackTitle}.wav`,
				isrc: null,
				// One track pulled without pulling the record it belongs to.
				radioExcludedAt: i === 4 && n === 2 ? new Date() : null,
				createdAt: new Date(),
				updatedAt: new Date()
			});
		}
	}

	// 17 columns × 5 = 85, under D1's 100 bound parameters.
	await batchInsert(audioRelease, releaseRows, 5);
	// 13 × 7 = 91.
	await batchInsert(audioTrack, trackRows, 7);
	// 9 × 11 = 99.
	await batchInsert(media, mediaRows, 11);
	// 7 × 14 = 98.
	await batchInsert(mediaAttachment, attachmentRows, 14);

	// -------------------------------------------------------------------------
	// Connect accounts
	// -------------------------------------------------------------------------
	// Three states, because the band panel renders three different things: ready
	// to sell, halfway through Stripe's form, and never started (the absent row).

	const accountRows = [
		{
			groupId: live[0].id,
			stripeAccountId: `acct_seed${randomUUID().slice(0, 12)}`,
			chargesEnabled: true,
			payoutsEnabled: true,
			detailsSubmitted: true,
			requirementsJson: { currently_due: [], past_due: [] },
			createdAt: new Date(),
			updatedAt: new Date()
		},
		...(live[1]
			? [
					{
						groupId: live[1].id,
						stripeAccountId: `acct_seed${randomUUID().slice(0, 12)}`,
						chargesEnabled: false,
						payoutsEnabled: false,
						detailsSubmitted: false,
						requirementsJson: {
							currently_due: ['individual.id_number', 'external_account'],
							past_due: []
						},
						createdAt: new Date(),
						updatedAt: new Date()
					}
				]
			: [])
	];
	// 8 × 12 = 96.
	await batchInsert(bandStripeAccount, accountRows, 12);

	// -------------------------------------------------------------------------
	// Purchases
	// -------------------------------------------------------------------------

	const sellable = releaseRows.filter((r) => r.status === 'published');
	const purchaseRows: any[] = [];

	for (const release of sellable) {
		for (let n = 0; n < randomInt(0, 5); n++) {
			const buyer = pick(users);
			const free = release.priceMinCents === 0;

			// The split bar's whole range, sampled: most buyers leave the suggested
			// share, some zero it out, and some hand over more than was asked.
			const cmcBps = pick([
				AUDIO_PLATFORM_FEE_BPS,
				AUDIO_PLATFORM_FEE_BPS,
				AUDIO_PLATFORM_FEE_BPS,
				0,
				2500
			]);
			const coverFees = !free && Math.random() < 0.45;
			const paidCents = free ? 0 : release.priceMinCents + pick([0, 0, 300, 500, 1500]);
			const amounts = free
				? { amountPaidCents: 0, platformFeeCents: 0, bandNetCents: 0, feeCoveredCents: 0 }
				: split(paidCents, cmcBps, coverFees);

			// One in eight is abandoned at Stripe — what the stale sweep exists for.
			const abandoned = !free && Math.random() < 0.125;

			purchaseRows.push({
				id: randomUUID(),
				releaseId: release.id,
				// A third of buyers never logged in. The email is the entitlement.
				userId: Math.random() < 0.66 ? buyer.id : null,
				buyerEmail: buyer.email,
				purchaseId: randomUUID(),
				...amounts,
				stripePaymentIntentId: abandoned || free ? null : `pi_seed${randomUUID().slice(0, 14)}`,
				stripePaymentRecordId: abandoned || free ? null : `payrec_seed${randomUUID().slice(0, 12)}`,
				status: abandoned ? 'pending' : 'paid',
				downloadToken: randomUUID().replace(/-/g, ''),
				downloadCount: abandoned ? 0 : randomInt(0, 4),
				createdAt: new Date(Date.now() - randomInt(1, 120) * 86400000),
				paidAt: abandoned ? null : new Date(Date.now() - randomInt(1, 120) * 86400000)
			});
		}
	}
	// 16 × 6 = 96.
	if (purchaseRows.length) await batchInsert(releasePurchase, purchaseRows, 6);

	// -------------------------------------------------------------------------
	// The objects themselves
	// -------------------------------------------------------------------------
	// Sequential rather than Promise.all: this is the local miniflare bucket and
	// a dozen concurrent multi-megabyte puts is how it starts returning I/O
	// errors halfway through a seed that then looks like a schema problem.

	let bytesWritten = 0;
	const bucket = (env as any).R2_PRIVATE as R2Bucket | undefined;
	if (bucket) {
		for (const object of objects) {
			await bucket.put(object.key, object.bytes, {
				httpMetadata: { contentType: 'audio/wav' }
			});
			bytesWritten += object.bytes.byteLength;
		}
	} else {
		console.warn('  R2_PRIVATE binding unavailable — rows seeded, audio objects skipped.');
	}

	return {
		releases: releaseRows.length,
		tracks: trackRows.length,
		purchases: purchaseRows.length,
		accounts: accountRows.length,
		bytes: bytesWritten
	};
}
