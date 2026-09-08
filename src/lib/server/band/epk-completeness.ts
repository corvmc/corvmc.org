/**
 * How far along an act's press kit is, as a named list rather than a percentage.
 *
 * This is the second completeness measure the social prior-art report asks for,
 * and it deliberately does **not** replace `isProfileComplete()` in
 * `directory-service.ts`. That one's bar is a single instrument, and it is right
 * to be that low: it backs an ambient nudge, and "a nudge that survives a
 * genuine effort to answer it is worse than no nudge." This one is the opposite
 * shape — a destination with the missing pieces enumerated, so a band can see
 * what a finished kit looks like and what it still owes.
 *
 * The rungs are all **booking** items. What an act needs on stage is a separate
 * document with its own page (`/band/[slug]/rider`), so there is no stage-plot
 * or backline rung here — a press kit that scored a band on its channel list
 * would be measuring the wrong thing.
 *
 * Pure, and takes everything it needs as data. No database, no `slug` lookups,
 * no tier queries: every caller already holds these values, and a function that
 * fetched its own would be a second load-bearing query on a page that has one.
 */

import type { BandEpk } from '$lib/types/band-page';
import type { ProfileLink } from '$lib/server/db/schema/authentication';
import { partitionLinks } from '$lib/utils/directory-display';

/** The band-panel routes a rung can send someone to. */
export type EpkSectionRoute =
	| '/band/[slug]/edit'
	| '/band/[slug]/press-kit'
	| '/band/[slug]/members'
	| '/band/[slug]/events'
	| '/band/[slug]/subscription';

export interface EpkSection {
	key: string;
	/** What the band sees. Written as a thing they have, not a field name. */
	label: string;
	done: boolean;
	/** What to do about it, when it is not done. */
	hint: string;
	/** Which of the two audiences this feeds — the page, or the package. */
	where: 'public' | 'package';
	/**
	 * Where to go and fix it, as a route id rather than a built path. The
	 * component resolves it — `svelte/no-navigation-without-resolve` errors on a
	 * hand-built href, and keeping the literal here means this module stays pure
	 * and needs no `$app/paths` mock in its spec.
	 */
	route: EpkSectionRoute;
	tier: 'free' | 'premium';
}

export interface EpkCompletenessInput {
	slug: string;
	name: string;
	avatarKey: string | null | undefined;
	tagline: string | null | undefined;
	bio: string | null | undefined;
	hometown: string | null | undefined;
	foundedYear: string | null | undefined;
	genres: string[];
	links: ProfileLink[];
	/** Active members who said what they play. The lineup is a roster fact. */
	membersWithPosition: number;
	/** Published upcoming shows. The rung nobody has to maintain. */
	upcomingShows: number;
	epk: BandEpk | null | undefined;
	pressPhotos: number;
	tier: string;
}

function filled(value: string | null | undefined): boolean {
	return !!value && value.trim().length > 0;
}

export function epkSections(input: EpkCompletenessInput): EpkSection[] {
	const edit = '/band/[slug]/edit' as const;
	const kit = '/band/[slug]/press-kit' as const;
	const epk = input.epk;

	const sections: EpkSection[] = [
		{
			key: 'identity',
			label: 'Name and logo',
			done: filled(input.name) && filled(input.avatarKey),
			hint: 'Add a logo or a photo — it is the first thing anyone sees.',
			where: 'public',
			route: edit,
			tier: 'free'
		},
		{
			key: 'tagline',
			label: 'One-line description',
			done: filled(input.tagline),
			hint: 'A short line a listings editor can paste verbatim.',
			where: 'public',
			route: edit,
			tier: 'free'
		},
		{
			key: 'bio',
			label: 'Full bio',
			done: filled(input.bio),
			hint: 'Two or three paragraphs: who you are and what you sound like.',
			where: 'public',
			route: edit,
			tier: 'free'
		},
		{
			key: 'genres',
			label: 'Genres',
			done: input.genres.length > 0,
			hint: 'Tag your genres so you turn up when someone browses for them.',
			where: 'public',
			route: edit,
			tier: 'free'
		},
		{
			key: 'origin',
			label: 'Where you are from',
			done: filled(input.hometown) || filled(input.foundedYear),
			hint: 'A hometown, and the year you started.',
			where: 'public',
			route: edit,
			tier: 'free'
		},
		{
			key: 'music',
			label: 'Something to listen to',
			// A streaming link, not merely an embeddable one. Bandcamp has no
			// in-page embed — its IDs need an API lookup — but a Bandcamp page is
			// unarguably somewhere a booker can hear the act, and marking that act
			// incomplete would be wrong. `orderEmbeddableServices` is the right
			// test for whether the player *renders*; this is the right test for
			// whether there is music to find.
			done: partitionLinks(input.links).streaming.length > 0,
			hint: 'Add a Bandcamp, Spotify, SoundCloud or YouTube link so people can hear you.',
			where: 'public',
			route: edit,
			tier: 'free'
		},
		{
			key: 'lineup',
			label: 'Who plays what',
			done: input.membersWithPosition > 0,
			hint: 'Give at least one member an instrument on the Members page.',
			where: 'public',
			route: '/band/[slug]/members',
			tier: 'free'
		},
		{
			key: 'shows',
			label: 'Upcoming shows',
			done: input.upcomingShows > 0,
			// The one rung that fills itself. Every EPK guide says a stale show
			// list is the commonest failure, and this one reads the gig guide the
			// act already maintains — so it is worth saying so rather than
			// presenting it as one more chore.
			hint: 'Listed automatically from your events — add a gig and it appears here.',
			where: 'public',
			route: '/band/[slug]/events',
			tier: 'free'
		},
		{
			key: 'press',
			label: 'Press quotes or highlights',
			done: (epk?.pressQuotes?.length ?? 0) > 0 || (epk?.achievements?.length ?? 0) > 0,
			hint: 'A review, an award, a support slot — anything somebody else said.',
			where: 'public',
			route: kit,
			tier: 'free'
		},
		{
			key: 'photo',
			label: 'Press photo',
			done: input.pressPhotos > 0,
			hint: 'A high-resolution shot a venue can print. An avatar is not a press photo.',
			where: 'public',
			route: kit,
			tier: 'free'
		},
		{
			key: 'booking',
			label: 'Who to contact',
			done: filled(epk?.bookingContact?.email),
			hint: 'Name a booking contact — it is where your contact form delivers.',
			where: 'package',
			route: kit,
			tier: 'free'
		}
	];

	const premium = input.tier === 'premium';
	sections.push(
		{
			key: 'video',
			label: 'Live video',
			done: premium && (epk?.videos?.length ?? 0) > 0,
			hint: 'A live clip, on your band site.',
			where: 'public',
			route: kit,
			tier: 'premium'
		},
		{
			key: 'gallery',
			label: 'Photo gallery',
			done: premium && input.pressPhotos > 1,
			hint: 'More than one photo, so a venue can pick.',
			where: 'public',
			route: kit,
			tier: 'premium'
		},
		{
			key: 'site',
			label: 'Your own band site',
			done: premium,
			hint: 'A themed page on your own domain.',
			where: 'public',
			route: '/band/[slug]/subscription',
			tier: 'premium'
		}
	);

	return sections;
}

export interface EpkProgress {
	sections: EpkSection[];
	/** Free rungs only — the premium ones are an upsell, not a score. */
	done: number;
	total: number;
	/** The first thing left to do, or null when the free ladder is finished. */
	next: EpkSection | null;
}

export function epkProgress(input: EpkCompletenessInput): EpkProgress {
	const sections = epkSections(input);
	const free = sections.filter((s) => s.tier === 'free');
	return {
		sections,
		done: free.filter((s) => s.done).length,
		total: free.length,
		next: free.find((s) => !s.done) ?? null
	};
}
