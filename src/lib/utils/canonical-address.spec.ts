import { describe, it, expect } from 'vitest';
import { canonicalAddress, groupPublicPath } from './canonical-address';
import { groupKinds } from '$lib/config';

const SITE = 'https://corvmc.org';

describe('canonicalAddress — members', () => {
	it('is /m/{memberNumber} on the site origin', () => {
		expect(canonicalAddress({ kind: 'member', memberNumber: 142 }, { siteUrl: SITE })).toBe(
			'https://corvmc.org/m/142'
		);
	});

	it('follows the site URL into staging, port and all', () => {
		expect(
			canonicalAddress({ kind: 'member', memberNumber: 7 }, { siteUrl: 'http://localhost:5173' })
		).toBe('http://localhost:5173/m/7');
	});

	it('drops a path on the site URL — the address hangs off the origin', () => {
		expect(
			canonicalAddress({ kind: 'member', memberNumber: 7 }, { siteUrl: 'https://corvmc.org/base' })
		).toBe('https://corvmc.org/m/7');
	});

	it('has none until a number is issued', () => {
		expect(canonicalAddress({ kind: 'member', memberNumber: null }, { siteUrl: SITE })).toBeNull();
		expect(
			canonicalAddress({ kind: 'member', memberNumber: undefined }, { siteUrl: SITE })
		).toBeNull();
	});

	it('falls back to production when PUBLIC_SITE_URL is missing or unparseable', () => {
		expect(canonicalAddress({ kind: 'member', memberNumber: 1 })).toBe('https://corvmc.org/m/1');
		expect(canonicalAddress({ kind: 'member', memberNumber: 1 }, { siteUrl: 'not a url' })).toBe(
			'https://corvmc.org/m/1'
		);
	});

	it('takes an explicit origin over the site URL', () => {
		expect(
			canonicalAddress(
				{ kind: 'member', memberNumber: 5 },
				{ siteUrl: SITE, origin: 'https://preview.example' }
			)
		).toBe('https://preview.example/m/5');
	});
});

describe('canonicalAddress — groups', () => {
	it('is the subdomain every group has for free', () => {
		expect(canonicalAddress({ kind: 'group', slug: 'the-band' }, { siteUrl: SITE })).toBe(
			'https://the-band.corvmc.org'
		);
	});

	it('hangs off the base domain the site URL names', () => {
		expect(
			canonicalAddress({ kind: 'group', slug: 'the-band' }, { siteUrl: 'https://www.staging.dev' })
		).toBe('https://the-band.staging.dev');
	});

	it('has none without a slug', () => {
		expect(canonicalAddress({ kind: 'group', slug: null }, { siteUrl: SITE })).toBeNull();
		expect(canonicalAddress({ kind: 'group', slug: '' }, { siteUrl: SITE })).toBeNull();
	});
});

describe('canonicalAddress — external acts', () => {
	// groups-spec.md: an external act has "no public profile, no share link, no
	// short id". Null here is what makes the share affordance simply absent.
	it('never has an address', () => {
		expect(canonicalAddress({ kind: 'external' }, { siteUrl: SITE })).toBeNull();
	});
});

describe('groupPublicPath', () => {
	it('sends a band to the band directory', () => {
		expect(groupPublicPath('band', 'the-band')).toBe('/directory/bands/the-band');
	});

	it('sends clubs and committees to their group page', () => {
		// The bug this fixes: both used to be redirected to /directory/bands/{slug},
		// whose lookup requires kind 'band', so the subdomain 404'd.
		expect(groupPublicPath('club', 'real-book-club')).toBe('/groups/real-book-club');
		expect(groupPublicPath('committee', 'programming')).toBe('/groups/programming');
	});

	it('answers for every kind in the vocabulary', () => {
		for (const kind of groupKinds) {
			expect(groupPublicPath(kind, 'x')).toMatch(/^\/(directory\/bands|groups)\/x$/);
		}
	});
});
