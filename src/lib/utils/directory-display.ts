/**
 * Pure display helpers shared by the directory profile components and the
 * profile remote queries. Kept free of DB/Svelte deps so they can be unit
 * tested and reused on both client and server.
 */
import { detectPlatform } from './link-platform';
import type { ProfileLink, DirectoryContact } from '$lib/server/db/schema/authentication';

/** Services that belong in the icon-only "Listen on" ribbon / the Listen tabs. */
export const STREAMING_PLATFORMS = [
	'Spotify',
	'Bandcamp',
	'SoundCloud',
	'YouTube',
	'Apple Music',
	'Amazon Music',
	'Tidal'
] as const;

const STREAMING_SET = new Set<string>(STREAMING_PLATFORMS);

export function isStreamingPlatform(name: string | undefined | null): boolean {
	return !!name && STREAMING_SET.has(name);
}

export type EmbeddableService = { link: ProfileLink; name: string; embedUrl: string };

/**
 * The embeddable streaming services for a set of links, in the locked tab
 * order. Only links whose platform exposes an in-page embed are included.
 */
export function orderEmbeddableServices(links: ProfileLink[]): EmbeddableService[] {
	return links
		.map((link): EmbeddableService | null => {
			const platform = detectPlatform(link.url);
			return platform?.embedUrl ? { link, name: platform.name, embedUrl: platform.embedUrl } : null;
		})
		.filter((s): s is EmbeddableService => s !== null)
		.sort((a, b) => streamingRank(a.name) - streamingRank(b.name));
}

function streamingRank(name: string): number {
	const i = STREAMING_PLATFORMS.indexOf(name as (typeof STREAMING_PLATFORMS)[number]);
	return i === -1 ? STREAMING_PLATFORMS.length : i;
}

export type PartitionedLinks = {
	/** streaming services — rendered as the icon ribbon */
	streaming: ProfileLink[];
	/** everything else (web, social, EPK) — rendered as labelled rows */
	web: ProfileLink[];
};

/** Split a link list into the streaming ribbon vs. the web/social rows. */
export function partitionLinks(links: ProfileLink[]): PartitionedLinks {
	const streaming: ProfileLink[] = [];
	const web: ProfileLink[] = [];
	for (const link of links) {
		if (isStreamingPlatform(detectPlatform(link.url)?.name)) streaming.push(link);
		else web.push(link);
	}
	return { streaming, web };
}

/**
 * Whether a band's member row should be shown as a locked, unlinked row. In
 * the public view, a member who hasn't opted their own profile to `public` is
 * withheld (but still counted); in the members view everyone is visible.
 */
export function isMemberRowPrivate(
	viewVisibility: 'members' | 'public',
	memberVisibility: string | null | undefined
): boolean {
	return viewVisibility === 'public' && memberVisibility !== 'public';
}

/**
 * Whether a band's detail page should be withheld (404) from a view. `hidden`
 * bands are not shown anywhere; `members` bands only resolve in the members
 * view. Band admins are unaffected — they manage the band via /band/[slug],
 * which authorizes by membership, not directory visibility.
 */
export function isBandProfileHidden(
	viewVisibility: 'members' | 'public',
	bandVisibility: string | null | undefined
): boolean {
	if (bandVisibility === 'public') return false;
	return viewVisibility === 'public' || bandVisibility !== 'members';
}

/**
 * A member's personal directory contact details (email/phone/social) are
 * members-only by default. They are only exposed in the public view when the
 * member has explicitly opted the contact block to `public` via
 * `directoryContact.visibility`. Returns the contact to render, or `null` to
 * withhold it entirely.
 *
 * Band booking contact is public by design and is not gated through here.
 */
export function contactForView(
	viewVisibility: 'members' | 'public',
	contact: DirectoryContact | null | undefined
): DirectoryContact | null {
	if (!contact) return null;
	if (viewVisibility === 'public' && contact.visibility !== 'public') return null;
	return contact;
}

/**
 * Shape a directory member row into the public profile DTO. This is the single
 * gate for what a member exposes publicly: fields are whitelisted explicitly
 * (so a newly added column never leaks by default) and personal contact runs
 * through contactForView(), withholding members-only details.
 */
export function toPublicMemberProfile<B>(member: {
	id: string;
	name: string;
	pronouns: string | null;
	image: string | null;
	bio: string | null;
	tagline: string | null;
	hometown: string | null;
	instruments: string[];
	genres: string[];
	skills: string[];
	lookingForBand: boolean;
	availableForHire: boolean;
	teachesLessons: boolean;
	openToCollaboration: boolean;
	directoryContact: unknown;
	links: unknown;
	bands: B;
}) {
	return {
		id: member.id,
		name: member.name,
		pronouns: member.pronouns,
		image: member.image,
		bio: member.bio,
		tagline: member.tagline,
		hometown: member.hometown,
		instruments: member.instruments,
		genres: member.genres,
		skills: member.skills,
		lookingForBand: member.lookingForBand,
		availableForHire: member.availableForHire,
		teachesLessons: member.teachesLessons,
		openToCollaboration: member.openToCollaboration,
		// Personal contact is members-only unless the member opted it public.
		directoryContact: contactForView('public', member.directoryContact as DirectoryContact | null),
		links: (member.links as ProfileLink[] | null) ?? [],
		bands: member.bands
	};
}
