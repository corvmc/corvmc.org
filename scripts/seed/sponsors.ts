import {
	sponsorship,
	sponsorPlacement,
	type NewSponsorship
} from '../../src/lib/server/db/schema/sponsor';
import { seedOrganizations, type SeedOrganization } from './parties';
import { media, mediaAttachment } from '../../src/lib/server/db/schema/media';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { render } from '@cf-wasm/og/node';
import type { SeedEvent } from './types';
import { batchInsert, env } from './db';
import { ptDate } from './util';

/** `YYYY-MM-DD` for a day relative to today, in Pacific time. */
function day(offset: number): string {
	return ptDate(offset, 12).toISOString().slice(0, 10);
}

/**
 * Four sponsors: one running, one whose term has lapsed unrenewed, one being
 * pitched, and one whose only term ended. Dated relative to today. The running
 * terms are placed on upcoming shows, one of them next month; the pitch on one
 * more, where it stays invisible until it is active.
 */
export async function seedSponsors(events: SeedEvent[]) {
	console.log('Seeding sponsors...');

	const sponsors: SeedOrganization[] = [
		{
			id: 'seed-sponsor-troubadour',
			name: 'Troubadour Music',
			roles: ['sponsor'],
			website: 'https://example.com/troubadour',
			person: { name: 'Dana Whitfield', role: 'Store manager', email: 'sponsor@example.com' }
		},
		{ id: 'seed-sponsor-brewery', name: 'Block 15 Brewing', roles: ['sponsor'] },
		{
			id: 'seed-sponsor-credit-union',
			name: 'Corvallis Community Credit Union',
			roles: ['sponsor']
		},
		{
			id: 'seed-sponsor-print',
			name: 'Valley Print Shop',
			// A sponsor that also supplies: one organization, two roles.
			roles: ['sponsor', 'supplier'],
			notes: 'Printed posters at cost.',
			// Archived: off the list until "Show archived", its ended term kept.
			archivedAt: new Date()
		}
	];

	const ships: NewSponsorship[] = [
		{
			id: 'seed-sponsorship-troubadour-season',
			organizationId: 'seed-sponsor-troubadour',
			title: 'Season sponsor',
			tier: 'Gold',
			status: 'active',
			amountCents: 150_000,
			startsOn: day(-90),
			endsOn: day(40)
		},
		{
			organizationId: 'seed-sponsor-troubadour',
			title: 'Last season',
			tier: 'Silver',
			status: 'ended',
			amountCents: 100_000,
			startsOn: day(-455),
			endsOn: day(-91)
		},
		{
			id: 'seed-sponsorship-brewery-series',
			organizationId: 'seed-sponsor-brewery',
			title: 'Summer concert series',
			tier: 'Silver',
			status: 'active',
			amountCents: 50_000,
			startsOn: day(-120),
			endsOn: day(-6)
		},
		{
			id: 'seed-sponsorship-credit-union-pitch',
			organizationId: 'seed-sponsor-credit-union',
			title: 'All-ages shows',
			status: 'prospect',
			amountCents: 250_000
		},
		{
			organizationId: 'seed-sponsor-print',
			title: 'Poster printing',
			tier: 'In kind',
			status: 'ended',
			startsOn: day(-400),
			endsOn: day(-200)
		}
	];

	await seedOrganizations(sponsors);
	await batchInsert(sponsorship, ships);

	const now = new Date();
	const upcoming = events
		.filter((e) => e.status === 'published' && e.startsAt > now)
		.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
	// The month calendar poster credits next month's sponsors too.
	const nextMonth = upcoming.find((e) => clubMonth(e.startsAt) !== clubMonth(now));
	const place = (sponsorshipId: string, list: SeedEvent[], inCampaign = true) =>
		list.map((e) => ({ sponsorshipId, eventId: e.id, onEventPage: true, inCampaign }));
	const placements = [
		...place('seed-sponsorship-troubadour-season', [
			...upcoming.slice(0, 2),
			...(nextMonth ? [nextMonth] : [])
		]),
		...place('seed-sponsorship-credit-union-pitch', upcoming.slice(2, 3), false),
		...place('seed-sponsorship-brewery-series', [
			...upcoming.slice(3, 4),
			...(nextMonth ? [nextMonth] : [])
		])
	];
	if (placements.length > 0) await batchInsert(sponsorPlacement, placements);
	const logos = await seedSponsorLogos(sponsors.filter((s) => !s.archivedAt));
	return { sponsors: sponsors.length, placements: placements.length, logos };
}

function clubMonth(d: Date): string {
	return d.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }).slice(0, 7);
}

const LOGO_COLORS = ['#003b5c', '#5a3d2b', '#00859b'];

/**
 * A PNG wordmark per sponsor, in the public bucket and the sponsor's `logo`
 * slot, so the flyer and month poster draw logos rather than names. Rendered
 * with the same satori the posters use.
 */
async function seedSponsorLogos(sponsors: SeedOrganization[]): Promise<number> {
	const bucket = env.R2_BUCKET as R2Bucket | undefined;
	if (!bucket) {
		console.warn('  R2_BUCKET is not bound — sponsor logos skipped.');
		return 0;
	}
	const font = readFileSync(
		fileURLToPath(new URL('../../src/lib/server/poster/assets/Lexend-Bold.ttf', import.meta.url))
	);
	let stored = 0;
	for (const [i, s] of sponsors.entries()) {
		const tree = {
			type: 'div',
			props: {
				style: {
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					width: '100%',
					height: '100%',
					background: LOGO_COLORS[i % LOGO_COLORS.length],
					color: '#fffbf6',
					fontFamily: 'Lexend',
					fontSize: 44,
					fontWeight: 700,
					padding: 24,
					textAlign: 'center'
				},
				children: s.name
			}
		};
		const png = (
			await render(tree as never, {
				width: 520,
				height: 200,
				fonts: [{ name: 'Lexend', data: font, weight: 700, style: 'normal' }]
			}).asPng()
		).image;
		const key = `sponsors/logos/${s.id}-seed.png`;
		await bucket.put(key, png, { httpMetadata: { contentType: 'image/png' } });
		const [m] = await batchInsert(media, [
			{ key, contentType: 'image/png', byteSize: png.byteLength, filename: `${s.id}.png` }
		]);
		await batchInsert(mediaAttachment, [
			{ mediaId: m.id, attachableType: 'organization', attachableId: s.id, slot: 'logo' }
		]);
		stored++;
	}
	return stored;
}
