import { bandSite } from '../../src/lib/server/db/schema/band-site';
import { media, mediaAttachment } from '../../src/lib/server/db/schema/media';
import { batchInsert, db } from './db';
import { pendingSites } from './pending';
import {
	ACHIEVEMENTS_POOL,
	BAND_EVENT_LOCATIONS,
	FIRST_NAMES,
	LAST_NAMES,
	PRESS_QUOTES
} from './pools';
import { pick, pickN, randomInt } from './util';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';

/**
 * One `band_site` per band, mirroring `scripts/db/backfill/band-site.sql`.
 *
 * Every band gets one regardless of tier: the row is what `tier` lives on, and
 * it is never deleted while the band lives: the microsite's blocks, theme, CSS
 * and EPK are columns on it as of phase 3c, so deleting the row on a cancelled
 * subscription would take the band's whole site with it.
 */
export async function seedBandSites(bands: any[]) {
	console.log('Seeding band sites...');
	// The premium half comes from `pendingSites`, not off the band row: those
	// columns are gone from `group`.
	const rows = bands.map((b: any) => ({
		id: randomUUID(),
		groupId: b.id,
		tier: 'free' as const,
		subscription: null,
		createdAt: b.createdAt ?? new Date(),
		updatedAt: b.updatedAt ?? new Date(),
		...(pendingSites.get(b.id) ?? {})
	}));
	// 11 columns at their widest × 9 = 99, under D1's 100 bound parameters.
	await batchInsert(bandSite, rows, 9);
	return new Map(rows.map((r) => [r.groupId, r.id]));
}

export async function seedBandPageConfigs(bands: any[]) {
	console.log('Seeding band page configs (premium bands)...');
	const configs = [];
	const themes = ['punk', 'jazz', 'electronic', 'metal', 'indie', 'folk'] as const;

	// Only premium bands get page configs. Tier lives on the site row now, so the
	// filter reads what was collected for it rather than the band row.
	const premiumBands = bands.filter(
		(b) => pendingSites.get(b.id)?.tier === 'premium' && !b.deletedAt
	);

	for (let i = 0; i < premiumBands.length; i++) {
		const b = premiumBands[i];
		const theme = themes[i % themes.length];

		const blocks = [
			{
				id: randomUUID(),
				type: 'hero',
				imageKey: 'bands/hero-placeholder.jpg',
				headline: b.name,
				subtitle: b.tagline || 'Live music from Corvallis, OR'
			},
			{
				id: randomUUID(),
				type: 'bio',
				content:
					b.bio || `${b.name} brings their unique sound to venues across the Pacific Northwest.`
			},
			{
				id: randomUUID(),
				type: 'embed',
				platform: 'spotify',
				url: 'https://open.spotify.com/artist/4Z8W4fKeB5YxbusRsdQVPb'
			},
			{ id: randomUUID(), type: 'events', limit: 5 },
			{ id: randomUUID(), type: 'members', showPositions: true },
			{ id: randomUUID(), type: 'links', style: 'buttons' },
			{ id: randomUUID(), type: 'press' },
			{ id: randomUUID(), type: 'achievements' },
			{
				id: randomUUID(),
				type: 'gallery',
				imageKeys: ['bands/gallery-1.jpg', 'bands/gallery-2.jpg', 'bands/gallery-3.jpg'],
				downloadable: true
			},
			{ id: randomUUID(), type: 'contact', showForm: true },
			{
				id: randomUUID(),
				type: 'custom_html',
				content: `<div style="text-align:center"><em>${b.name} is booking now for summer shows.</em></div>`
			},
			{ id: randomUUID(), type: 'tech_rider' },
			{ id: randomUUID(), type: 'spacer', height: 'md' }
		];

		const epk = {
			bookingContact: {
				name: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
				email: `booking@${b.slug}.band`,
				phone: `541-555-${randomInt(1000, 9999)}`
			},
			managementContact: {
				name: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
				email: `mgmt@${b.slug}.band`
			},
			prContact:
				Math.random() > 0.5
					? {
							name: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
							email: `press@${b.slug}.band`
						}
					: undefined,
			pressQuotes: pickN(PRESS_QUOTES, randomInt(2, 4)),
			achievements: pickN(ACHIEVEMENTS_POOL, randomInt(3, 5)),
			// The premium half of the press kit. Without a seeded row `VideoBox`
			// never rendered anywhere, so the section a band site is now partly
			// sold on could not be seen in dev at all. Real YouTube ids, because
			// the component drops anything `detectPlatform` cannot embed — a
			// placeholder URL would silently render nothing and look like a bug in
			// the component rather than in the fixture.
			videos: [
				{ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', label: 'Live at the Majestic' },
				{ url: 'https://www.youtube.com/watch?v=9bZkp7q19f0', label: 'Session, take one' }
			]
		};

		const customCss =
			theme === 'punk'
				? `.band-site-hero { text-transform: uppercase; letter-spacing: 0.1em; }\n.band-site-block { border-bottom: 2px solid var(--bs-accent); }`
				: theme === 'electronic'
					? `.band-site-hero h1 { text-shadow: 0 0 20px var(--bs-accent); }\n.band-site-block { transition: opacity 0.3s; }`
					: null;

		// The config IS the site row since phase 3c, and that row already exists —
		// so this updates rather than inserts.
		const [config] = await db
			.update(bandSite)
			.set({ theme, customCss, blocks, epk, updatedAt: new Date() })
			.where(eq(bandSite.groupId, b.id))
			.returning();
		configs.push(config);

		// Band media, in the media tables the microsite reads and the upload
		// endpoint writes. `band_media` is gone as of phase 6 — nothing had read it
		// since the cut-over, and production held no rows in it at all.
		const mediaSlots = [
			['gallery', 'image'],
			['gallery', 'image'],
			['gallery', 'image'],
			['hero', 'hero'],
			['stage_plot', 'stage_plot'],
			['rider', 'rider']
		] as const;
		for (let m = 0; m < mediaSlots.length; m++) {
			const [slot, legacyType] = mediaSlots[m];
			const key = `bands/${b.slug}/${legacyType}-${m}.jpg`;
			const caption =
				slot === 'gallery' ? `${b.name} live at ${pick(BAND_EVENT_LOCATIONS).split(',')[0]}` : null;

			// Sizes are fabricated: these keys name no real object, which is exactly
			// why `backfill-media.ts` refuses to invent them and the seed may.
			const [mediaRow] = await db
				.insert(media)
				.values({
					key,
					contentType: 'image/jpeg',
					byteSize: 200_000 + m * 1000,
					caption
				})
				.returning();

			await db.insert(mediaAttachment).values({
				mediaId: mediaRow.id,
				attachableType: 'group',
				attachableId: b.id,
				slot,
				sortOrder: m
			});
		}
	}

	return configs;
}

/**
 * Press kits for the acts that never bought anything.
 *
 * The press kit stopped being premium, so seeding it only for premium bands
 * left every free surface it feeds rendering empty in dev — the public profile's
 * press section, the ladder card, the downloadable package. Worse, it left the
 * *interesting* states unreachable: the ladder is a progression, and you cannot
 * see whether "3 of 12" reads right without a band sitting at 3.
 *
 * So free bands are dealt round-robin into three rungs. Deterministic by index
 * rather than random, because the point is that all three states exist on every
 * reset, not that they are plausibly distributed.
 */
/**
 * One fabricated media row, attached to a band.
 *
 * The keys name no real object — which is exactly why `backfill-media.ts`
 * refuses to invent them and the seed may.
 */
async function attachSeedImage(
	b: any,
	slot: 'gallery' | 'stage_plot' | 'rider' | 'hero',
	sortOrder: number,
	caption: string | null
) {
	const [mediaRow] = await db
		.insert(media)
		.values({
			key: `bands/${b.slug}/${slot}-${sortOrder}.jpg`,
			contentType: 'image/jpeg',
			byteSize: 200_000 + sortOrder * 1000,
			altText: slot === 'gallery' ? `${b.name} performing live` : null,
			caption
		})
		.returning();

	await db.insert(mediaAttachment).values({
		mediaId: mediaRow.id,
		attachableType: 'group',
		attachableId: b.id,
		slot,
		sortOrder
	});
}

export async function seedFreePressKits(bands: any[]) {
	console.log('Seeding free press kits...');

	const freeBands = bands.filter((b) => pendingSites.get(b.id)?.tier !== 'premium' && !b.deletedAt);

	let filled = 0;
	for (let i = 0; i < freeBands.length; i++) {
		const b = freeBands[i];
		// 0 = bare, 1 = part-way, 2 = a finished free kit.
		const rung = i % 3;
		if (rung === 0) continue;

		const epk: Record<string, unknown> = {
			pressQuotes: pickN(PRESS_QUOTES, rung === 1 ? 1 : 3),
			achievements: pickN(ACHIEVEMENTS_POOL, rung === 1 ? 1 : 3)
		};

		if (rung === 2) {
			// The finished kit: someone a venue can ring, and what the act needs on
			// Package-only, so this is also the fixture that proves a booking
			// contact never reaches the public page.
			epk.bookingContact = {
				name: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
				email: `booking@${b.slug}.band`,
				phone: `541-555-${randomInt(1000, 9999)}`
			};
			// Exactly one gallery photo — the free allowance, in full.
			//
			// Without this, three states were unreachable in dev and each was
			// indistinguishable from a surface that is merely quiet: `PressPhoto`
			// never rendered on a free act's public page, the "Press photo" rung
			// could never be ticked, and the editor's "1 of 1 · a band site lifts
			// the limit" state had no way to occur. So `FREE_PRESS_PHOTOS`, the one
			// new server rule this feature adds, had no fixture exercising it.
			await attachSeedImage(b, 'gallery', 0, `${b.name} — press photo`);
		}

		await db.update(bandSite).set({ epk, updatedAt: new Date() }).where(eq(bandSite.groupId, b.id));
		filled++;
	}

	console.log(`  ${filled} free press kits (of ${freeBands.length} free acts)`);
	return filled;
}
