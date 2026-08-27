import { describe, it, expect } from 'vitest';
import {
	partitionLinks,
	orderEmbeddableServices,
	isStreamingPlatform,
	isMemberRowPrivate,
	isBandProfileHidden,
	contactForView,
	toPublicMemberProfile
} from './directory-display';
import type { ProfileLink, DirectoryContact } from '$lib/server/db/schema/authentication';

const spotify: ProfileLink = {
	label: 'Spotify',
	url: 'https://open.spotify.com/artist/4Z8W4fKeB5YxbusRsdQVPb'
};
const youtube: ProfileLink = { label: 'YT', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' };
const bandcamp: ProfileLink = { label: 'BC', url: 'https://artist.bandcamp.com/album/foo' };
const website: ProfileLink = { label: 'Site', url: 'https://example.com' };
const instagram: ProfileLink = { label: 'IG', url: 'https://instagram.com/artist' };
const appleArtist: ProfileLink = {
	label: 'Apple Music',
	url: 'https://music.apple.com/us/artist/the-church-ladies/123456'
};
const amazon: ProfileLink = {
	label: 'Amazon Music',
	url: 'https://music.amazon.com/artists/B0ABCDEFGH/the-church-ladies'
};

describe('isStreamingPlatform', () => {
	it('recognizes streaming services', () => {
		expect(isStreamingPlatform('Spotify')).toBe(true);
		expect(isStreamingPlatform('Bandcamp')).toBe(true);
	});
	it('rejects non-streaming and empty', () => {
		expect(isStreamingPlatform('Instagram')).toBe(false);
		expect(isStreamingPlatform(undefined)).toBe(false);
	});
});

describe('partitionLinks', () => {
	it('splits streaming services from web/social links', () => {
		const { streaming, web } = partitionLinks([spotify, website, instagram, bandcamp]);
		expect(streaming).toEqual([spotify, bandcamp]);
		expect(web).toEqual([website, instagram]);
	});

	it('treats unknown links as web', () => {
		const { streaming, web } = partitionLinks([website]);
		expect(streaming).toHaveLength(0);
		expect(web).toEqual([website]);
	});

	it('puts Apple Music artist pages and Amazon Music in the listen ribbon', () => {
		const { streaming, web } = partitionLinks([appleArtist, amazon, website]);
		expect(streaming).toEqual([appleArtist, amazon]);
		expect(web).toEqual([website]);
	});
});

describe('orderEmbeddableServices', () => {
	it('keeps only embeddable services and applies the locked tab order', () => {
		// Bandcamp has no in-page embed, so it is excluded even though it streams.
		const services = orderEmbeddableServices([youtube, spotify, bandcamp, website]);
		expect(services.map((s) => s.name)).toEqual(['Spotify', 'YouTube']);
		expect(services.every((s) => s.embedUrl.length > 0)).toBe(true);
	});

	it('returns empty when nothing is embeddable', () => {
		expect(orderEmbeddableServices([website, bandcamp])).toEqual([]);
	});
});

describe('isMemberRowPrivate', () => {
	it('hides non-public members in the public view', () => {
		expect(isMemberRowPrivate('public', 'members')).toBe(true);
		expect(isMemberRowPrivate('public', 'hidden')).toBe(true);
		expect(isMemberRowPrivate('public', null)).toBe(true);
	});

	it('keeps public members and never hides in the members view', () => {
		expect(isMemberRowPrivate('public', 'public')).toBe(false);
		expect(isMemberRowPrivate('members', 'members')).toBe(false);
		expect(isMemberRowPrivate('members', 'hidden')).toBe(false);
	});
});

describe('isBandProfileHidden', () => {
	it('hides hidden bands from every view', () => {
		expect(isBandProfileHidden('public', 'hidden')).toBe(true);
		expect(isBandProfileHidden('members', 'hidden')).toBe(true);
	});

	it('hides members-only bands from the public view but not the members view', () => {
		expect(isBandProfileHidden('public', 'members')).toBe(true);
		expect(isBandProfileHidden('members', 'members')).toBe(false);
	});

	it('shows public bands in every view', () => {
		expect(isBandProfileHidden('public', 'public')).toBe(false);
		expect(isBandProfileHidden('members', 'public')).toBe(false);
	});
});

describe('contactForView', () => {
	const contact: DirectoryContact = { email: 'me@example.com', phone: '555-1234' };

	it('withholds members-only contact from the public view', () => {
		// Default (no visibility set) is members-only — must not leak publicly.
		expect(contactForView('public', contact)).toBeNull();
		expect(contactForView('public', { ...contact, visibility: 'members' })).toBeNull();
	});

	it('exposes contact publicly only when explicitly opted public', () => {
		const publicContact = { ...contact, visibility: 'public' };
		expect(contactForView('public', publicContact)).toEqual(publicContact);
	});

	it('always shows contact in the members view', () => {
		expect(contactForView('members', contact)).toEqual(contact);
		expect(contactForView('members', { ...contact, visibility: 'members' })).toBeTruthy();
	});

	it('returns null for missing contact', () => {
		expect(contactForView('public', null)).toBeNull();
		expect(contactForView('members', undefined)).toBeNull();
	});
});

describe('toPublicMemberProfile', () => {
	const member = {
		id: 'm1',
		name: 'Jeff',
		memberNumber: 7, // NOT part of the public DTO
		pronouns: null,
		image: null,
		bio: null,
		tagline: null,
		hometown: null,
		instruments: ['guitar'],
		genres: ['rock'],
		lookingForBand: false,
		availableForHire: false,
		teachesLessons: false,
		openToCollaboration: false,
		links: null,
		bands: [{ name: 'The Band', slug: 'the-band' }],
		createdAt: new Date(0)
	};

	it('withholds members-only contact and never leaks it into the payload', () => {
		const dto = toPublicMemberProfile({
			...member,
			directoryContact: { email: 'secret@jeff.com', phone: '555-9999', visibility: 'members' }
		});
		expect(dto.directoryContact).toBeNull();
		const serialized = JSON.stringify(dto);
		expect(serialized).not.toContain('secret@jeff.com');
		expect(serialized).not.toContain('555-9999');
	});

	it('treats contact with no visibility set as members-only', () => {
		const dto = toPublicMemberProfile({
			...member,
			directoryContact: { email: 'secret@jeff.com' }
		});
		expect(dto.directoryContact).toBeNull();
		expect(JSON.stringify(dto)).not.toContain('secret@jeff.com');
	});

	it('exposes contact only when the member opted it public', () => {
		const dto = toPublicMemberProfile({
			...member,
			directoryContact: { email: 'book@jeff.com', visibility: 'public' }
		});
		expect(dto.directoryContact).toEqual({ email: 'book@jeff.com', visibility: 'public' });
	});

	it('whitelists fields — non-public columns like memberNumber never appear', () => {
		const dto = toPublicMemberProfile({ ...member, directoryContact: null });
		expect(dto).not.toHaveProperty('memberNumber');
		expect(JSON.stringify(dto)).not.toContain('memberNumber');
	});
});
