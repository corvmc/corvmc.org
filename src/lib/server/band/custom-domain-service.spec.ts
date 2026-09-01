import { describe, it, expect, vi } from 'vitest';

vi.mock('$env/dynamic/public', () => ({ env: { PUBLIC_SITE_URL: 'https://corvmc.org' } }));
vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/db', () => ({ db: {} }));
vi.mock('./band-host-service', () => ({ forgetCustomDomain: vi.fn() }));

import {
	CustomDomainError,
	cnameTarget,
	isCustomDomainConfigured,
	normalizeCustomDomain
} from './custom-domain-service';

/** Domains bands actually type, in the shapes they actually type them. */
describe('normalizeCustomDomain', () => {
	it('accepts a plain domain', () => {
		expect(normalizeCustomDomain('theband.com')).toBe('theband.com');
		expect(normalizeCustomDomain('the-band.co.uk')).toBe('the-band.co.uk');
	});

	it('accepts a single subdomain', () => {
		expect(normalizeCustomDomain('www.theband.com')).toBe('www.theband.com');
	});

	it('strips what people paste from a browser', () => {
		expect(normalizeCustomDomain('https://theband.com/')).toBe('theband.com');
		expect(normalizeCustomDomain('http://theband.com/shows?x=1')).toBe('theband.com');
		expect(normalizeCustomDomain('  THEBAND.com  ')).toBe('theband.com');
		expect(normalizeCustomDomain('theband.com.')).toBe('theband.com');
	});

	it('rejects input that is not a domain', () => {
		for (const bad of ['', '   ', 'theband', 'the band.com', 'theband..com', '-theband.com']) {
			expect(() => normalizeCustomDomain(bad)).toThrow(CustomDomainError);
		}
	});

	it('rejects our own zone — those addresses are assigned, not claimed', () => {
		expect(() => normalizeCustomDomain('corvmc.org')).toThrow(CustomDomainError);
		expect(() => normalizeCustomDomain('theband.corvmc.org')).toThrow(CustomDomainError);
	});

	it('rejects deep subdomains', () => {
		expect(() => normalizeCustomDomain('a.b.theband.com')).toThrow(CustomDomainError);
	});
});

describe('configuration', () => {
	it('reports unconfigured when Cloudflare credentials are missing', () => {
		expect(isCustomDomainConfigured()).toBe(false);
	});

	it('derives the CNAME target from the site domain', () => {
		expect(cnameTarget()).toBe('domains.corvmc.org');
	});
});
