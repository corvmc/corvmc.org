import { type DirectoryVisibility } from '../../src/lib/server/db/schema/authentication';
import { group, groupMember, groupSlugHistory } from '../../src/lib/server/db/schema/group';
import { groupInvite } from '../../src/lib/server/db/schema/group-invite';
import { db } from './db';
import { pendingEntries, pendingSites, pendingTags } from './pending';
import { BAND_ALIASES, BAND_NAMES, BAND_POSITIONS, GENRES, HOMETOWNS, SAMPLE_LINKS } from './pools';
import { type SeedUser } from './types';
import { pick, pickN, randomInt } from './util';
import { randomUUID } from 'crypto';

/**
 * Insert a band together with the `group_member` row that records its owner.
 *
 * These two are one fact stored twice, and the app's guards read only the
 * member row (`requireBandOwner` resolves through `requireBandMember()`), so a
 * band seeded without it has no owner in practice. The seeds can't call the
 * service's `create()` — they need to set slug, tier, timestamps and deletedAt,
 * which `create()` derives — so this is the seed-side equivalent. Going through
 * it everywhere is what stops a new seed band from quietly reproducing the
 * production drift that `scripts/backfill-band-owners.ts` had to repair.
 */
export async function insertBandWithOwner(
	values: typeof group.$inferInsert,
	ownerId: string,
	position?: string
) {
	const [b] = await db.insert(group).values(values).returning();
	await db.insert(groupMember).values({
		groupId: b.id,
		userId: ownerId,
		role: 'owner',
		position: position ?? null,
		status: 'active'
	});
	// `ownerId` rides along in memory only — the column was dropped in phase 3c,
	// and the owner is the `group_member` row written just above. Seed code
	// downstream needs the id to attribute events and reservations, and looking
	// it back up per band would be a query for something this function already
	// knows.
	return { ...b, ownerId };
}

export async function seedBands(users: SeedUser[]) {
	console.log('Seeding bands...');
	const bands = [];

	// First 3 bands are premium, rest are free
	const PREMIUM_BAND_COUNT = 3;

	for (let i = 0; i < BAND_NAMES.length; i++) {
		const owner = users[i % users.length];
		// Same rule as `generateSlug`, which is what a real band creation uses.
		const slug = BAND_NAMES[i]
			.toLowerCase()
			.replace(/[^a-z0-9-]+/g, '')
			.replace(/-{2,}/g, '-')
			.replace(/^-|-$/g, '');

		const genres = pickN(GENRES, randomInt(1, 3));
		const isPremiumBand = i < PREMIUM_BAND_COUNT;
		const bandLinks = [
			{
				label: 'Spotify',
				url: 'https://open.spotify.com/artist/4Z8W4fKeB5YxbusRsdQVPb',
				embed: true
			},
			{ label: 'YouTube', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', embed: true },
			...pickN(SAMPLE_LINKS.slice(3), randomInt(0, 2))
		];
		const bandVisibility = 'public';

		const b = await insertBandWithOwner(
			{
				name: BAND_NAMES[i],
				slug,
				bio: `${BAND_NAMES[i]} is a local band from Corvallis, OR. Formed in 20${randomInt(18, 24)}, they play a mix of ${genres.slice(0, 2).join(' and ')} with influences from all over the map.`
			},
			owner.id,
			pick(BAND_POSITIONS)
		);
		bands.push(b);

		// The premium half — these columns are gone from `group`.
		pendingSites.set(b.id, {
			tier: isPremiumBand ? 'premium' : 'free',
			subscription: isPremiumBand
				? {
						startedAt: new Date(Date.now() - randomInt(30, 180) * 86400000).toISOString(),
						stripeSubscriptionId: `sub_seed_${randomUUID().slice(0, 8)}`,
						billingInterval: i === 0 ? 'yearly' : 'monthly',
						currentPeriodEnd: new Date(Date.now() + randomInt(10, 30) * 86400000).toISOString(),
						cancelAtPeriodEnd: false
					}
				: null,
			// The first premium band has a live custom domain, the second is still
			// waiting on DNS — both states need to be visible in band settings.
			...(isPremiumBand && i < 2
				? {
						customDomain: `${slug.replace(/-/g, '')}.example.com`,
						customDomainStatus: i === 0 ? ('active' as const) : ('pending' as const),
						customDomainHostnameId: `seed-hostname-${randomUUID().slice(0, 8)}`,
						customDomainVerification: {
							ownership: {
								name: `_cf-custom-hostname.${slug.replace(/-/g, '')}.example.com`,
								value: randomUUID()
							},
							ssl: {
								name: `_acme-challenge.${slug.replace(/-/g, '')}.example.com`,
								value: randomUUID().replace(/-/g, '')
							},
							cnameTarget: 'domains.corvmc.org'
						},
						customDomainAddedAt: new Date(Date.now() - randomInt(1, 60) * 86400000)
					}
				: {})
		});

		// The listing half — these columns are gone from `group`.
		pendingEntries.set(b.id, {
			tagline: `${genres[0]} ${pick(['trio', 'quartet', 'duo', 'ensemble', 'collective'])} from Corvallis`,
			hometown: pick(HOMETOWNS),
			foundedYear: String(randomInt(2015, 2024)),
			lookingFor: Math.random() > 0.6 ? 'members' : null,
			visibility: bandVisibility as DirectoryVisibility,
			contact: { email: `booking+${slug}@example.com` },
			links: bandLinks
		});

		for (const value of genres) {
			pendingTags.push({ subjectId: b.id, kind: 'genre', value });
		}

		const memberCount = randomInt(1, 3);
		const candidates = users.filter((u) => u.id !== owner.id);
		const members = pickN(candidates, memberCount);
		for (const m of members) {
			await db.insert(groupMember).values({
				groupId: b.id,
				userId: m.id,
				role: 'member',
				position: pick(BAND_POSITIONS),
				alias: Math.random() > 0.66 ? pick(BAND_ALIASES) : null,
				status: Math.random() > 0.15 ? 'active' : 'pending',
				invitedById: owner.id
			});
		}

		// Give the first premium and first free band a released address, so both
		// old-address redirect paths (microsite and directory profile) have local
		// data to exercise.
		if (i === 0 || i === PREMIUM_BAND_COUNT) {
			await db.insert(groupSlugHistory).values({ slug: `${slug}-old`, groupId: b.id });
		}

		// One invitation to an address with no account behind it, so the members
		// page's "Awaiting signup" card and its Revoke control have a row locally.
		// Deliberately not an address any seeded user holds — that path resolves to
		// a `group_member` row instead and never reaches this table.
		if (i === 0) {
			await db.insert(groupInvite).values({
				groupId: b.id,
				email: `newcomer+${slug}@example.com`,
				role: 'member',
				position: pick(BAND_POSITIONS),
				invitedById: owner.id,
				status: 'pending',
				expiresAt: new Date(Date.now() + 7 * 86400000)
			});
		}
	}

	// Onboarding-state bands: a bare just-created band (name only, as the
	// create-band modal produces) and non-public visibilities, so the
	// sparse-profile rendering and directoryVisibility gating paths have local
	// data. Kept out of BAND_NAMES so the fully-filled pool stays untouched.
	// `bio` stays on `group`; visibility, hometown and foundedYear are listing
	// fields and go to the entry, so each state carries the two halves apart.
	const onboardingStates = [
		{ band: { name: 'Fresh Coat', slug: 'fresh-coat' }, entry: { visibility: 'public' as const } },
		{
			band: {
				name: 'Basement Sessions',
				slug: 'basement-sessions',
				bio: 'We keep to ourselves — hidden from the directory.'
			},
			entry: { visibility: 'hidden' as const, hometown: pick(HOMETOWNS) }
		},
		{
			band: {
				name: 'The Quiet Regulars',
				slug: 'the-quiet-regulars',
				bio: 'Members-only listing: visible to logged-in members, not the public.'
			},
			entry: {
				visibility: 'members' as const,
				hometown: pick(HOMETOWNS),
				foundedYear: String(randomInt(2015, 2024))
			}
		}
	];
	for (let i = 0; i < onboardingStates.length; i++) {
		const owner = users[(BAND_NAMES.length + 1 + i) % users.length];
		const b = await insertBandWithOwner(onboardingStates[i].band, owner.id, pick(BAND_POSITIONS));
		bands.push(b);
		pendingEntries.set(b.id, onboardingStates[i].entry);
	}

	const deactivatedOwner = users[BAND_NAMES.length % users.length];
	const deactivated = await insertBandWithOwner(
		{
			name: 'Disbanded Project',
			slug: 'disbanded-project',
			bio: 'This band was deactivated by staff.',
			ownerId: deactivatedOwner.id,
			deletedAt: new Date(Date.now() - 10 * 86400000)
		},
		deactivatedOwner.id,
		'Guitar'
	);
	bands.push(deactivated);

	return bands;
}
