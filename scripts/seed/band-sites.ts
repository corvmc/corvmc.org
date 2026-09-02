import { bandSite } from '../../src/lib/server/db/schema/band-site';
import { media, mediaAttachment } from '../../src/lib/server/db/schema/media';
import { batchInsert, db } from './db';
import { pendingSites } from './pending';
import {
	ACHIEVEMENTS_POOL,
	BACKLINE_ITEMS,
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
			backline: pickN(BACKLINE_ITEMS, randomInt(3, 5)),
			technicalRiderKey: 'bands/rider-placeholder.pdf',
			stagePlotKey: 'bands/stage-plot-placeholder.png'
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
