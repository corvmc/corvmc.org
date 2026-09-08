import { describe, it, expect } from 'vitest';
import {
	bandSiteHref,
	bandSitePath,
	bandSiteUrl,
	bandSlugFromHost,
	baseDomainFromSiteUrl,
	isAppDomain
} from './band-site-url';

describe('bandSiteHref', () => {
	it('emits plain paths on a real subdomain', () => {
		const url = new URL('https://the-neons.corvmc.org/');
		expect(bandSiteHref('the-neons', '', url)).toBe('/');
		expect(bandSiteHref('the-neons', '/events', url)).toBe('/events');
		expect(bandSiteHref('the-neons', '/epk', url)).toBe('/epk');
	});

	it('keeps the dev override query param', () => {
		const url = new URL('http://localhost:5173/?__band_subdomain=the-neons');
		expect(bandSiteHref('the-neons', '/events', url)).toBe('/events?__band_subdomain=the-neons');
		expect(bandSiteHref('the-neons', '', url)).toBe('/?__band_subdomain=the-neons');
	});

	it('keeps the /band-site prefix on path-based access', () => {
		const url = new URL('https://corvmc.org/band-site/the-neons');
		expect(bandSiteHref('the-neons', '/events', url)).toBe('/band-site/the-neons/events');
		expect(bandSiteHref('the-neons', '', url)).toBe('/band-site/the-neons');
	});
});

describe('bandSitePath', () => {
	it('strips the /band-site prefix', () => {
		expect(bandSitePath('the-neons', new URL('https://x.org/band-site/the-neons/events'))).toBe(
			'/events'
		);
		expect(bandSitePath('the-neons', new URL('https://x.org/band-site/the-neons'))).toBe('/');
	});

	it('passes through subdomain paths', () => {
		expect(bandSitePath('the-neons', new URL('https://the-neons.corvmc.org/events'))).toBe(
			'/events'
		);
	});
});

describe('bandSiteUrl', () => {
	it('builds the production subdomain URL', () => {
		expect(bandSiteUrl('the-neons', 'https://corvmc.org')).toBe('https://the-neons.corvmc.org');
		expect(bandSiteUrl('the-neons', 'https://www.corvmc.org')).toBe('https://the-neons.corvmc.org');
	});

	it('keeps the protocol and port in dev', () => {
		expect(bandSiteUrl('the-neons', 'http://localhost:5173')).toBe(
			'http://the-neons.localhost:5173'
		);
	});

	it('falls back to production on missing or invalid input', () => {
		expect(bandSiteUrl('the-neons', undefined)).toBe('https://the-neons.corvmc.org');
		expect(bandSiteUrl('the-neons', 'not a url')).toBe('https://the-neons.corvmc.org');
	});

	it('prefers a live custom domain over the subdomain', () => {
		expect(bandSiteUrl('the-neons', 'https://corvmc.org', 'theband.com')).toBe(
			'https://theband.com'
		);
		// Not yet live — callers pass null until Cloudflare reports it active.
		expect(bandSiteUrl('the-neons', 'https://corvmc.org', null)).toBe(
			'https://the-neons.corvmc.org'
		);
	});
});

describe('bandSlugFromHost', () => {
	const site = 'https://corvmc.org';

	it('extracts the slug from a band subdomain', () => {
		expect(bandSlugFromHost('the-neons.corvmc.org', site)).toBe('the-neons');
	});

	it('returns null for the apex and www', () => {
		expect(bandSlugFromHost('corvmc.org', site)).toBeNull();
		expect(bandSlugFromHost('www.corvmc.org', site)).toBeNull();
	});

	it('returns null for reserved and nested subdomains', () => {
		expect(bandSlugFromHost('media.corvmc.org', site)).toBeNull();
		expect(bandSlugFromHost('staff.corvmc.org', site)).toBeNull();
		expect(bandSlugFromHost('a.b.corvmc.org', site)).toBeNull();
	});

	it('returns null for a custom domain — those resolve through the database', () => {
		expect(bandSlugFromHost('theband.com', site)).toBeNull();
	});

	it('works against a dev base domain', () => {
		expect(bandSlugFromHost('the-neons.localhost', 'http://localhost:5173')).toBe('the-neons');
		expect(bandSlugFromHost('localhost', 'http://localhost:5173')).toBeNull();
	});
});

describe('baseDomainFromSiteUrl', () => {
	it('derives the hostname and strips www', () => {
		expect(baseDomainFromSiteUrl('https://corvmc.org')).toBe('corvmc.org');
		expect(baseDomainFromSiteUrl('https://www.corvmc.org')).toBe('corvmc.org');
		expect(baseDomainFromSiteUrl('https://staging.corvmc.org')).toBe('staging.corvmc.org');
	});

	it('falls back to production on missing or invalid input', () => {
		expect(baseDomainFromSiteUrl(undefined)).toBe('corvmc.org');
		expect(baseDomainFromSiteUrl('not a url')).toBe('corvmc.org');
	});
});

describe('isAppDomain', () => {
	it('accepts the site domain and its subdomains', () => {
		expect(isAppDomain('corvmc.org', 'https://corvmc.org')).toBe(true);
		expect(isAppDomain('www.corvmc.org', 'https://corvmc.org')).toBe(true);
		expect(isAppDomain('the-neons.corvmc.org', 'https://corvmc.org')).toBe(true);
		expect(isAppDomain('media.corvmc.org', 'https://corvmc.org')).toBe(true);
	});

	// The `*/*` zone route means the worker also answers premium bands' own
	// domains as Cloudflare for SaaS custom hostnames. Those are not ours.
	it('rejects a band custom domain and any unrelated host', () => {
		expect(isAppDomain('theband.com', 'https://corvmc.org')).toBe(false);
		expect(isAppDomain('corvmc.org.evil.com', 'https://corvmc.org')).toBe(false);
		expect(isAppDomain('notcorvmc.org', 'https://corvmc.org')).toBe(false);
	});

	it('follows PUBLIC_SITE_URL so dev and staging get their own namespace', () => {
		expect(isAppDomain('localhost', 'http://localhost:5173')).toBe(true);
		expect(isAppDomain('the-neons.localhost', 'http://localhost:5173')).toBe(true);
		expect(isAppDomain('corvmc.org', 'http://localhost:5173')).toBe(false);
	});
});
