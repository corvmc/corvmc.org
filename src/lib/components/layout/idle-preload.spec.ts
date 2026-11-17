import { describe, expect, it } from 'vitest';
import { connectionAllowsPreload, linkPaths } from './idle-preload';

describe('connectionAllowsPreload', () => {
	it('allows when the browser reports no connection', () => {
		expect(connectionAllowsPreload(undefined)).toBe(true);
	});

	it('refuses Save-Data and 2g or slower', () => {
		expect(connectionAllowsPreload({ saveData: true, effectiveType: '4g' })).toBe(false);
		expect(connectionAllowsPreload({ effectiveType: '2g' })).toBe(false);
		expect(connectionAllowsPreload({ effectiveType: 'slow-2g' })).toBe(false);
		expect(connectionAllowsPreload({ effectiveType: '3g' })).toBe(true);
	});
});

describe('linkPaths', () => {
	const root = (hrefs: string[]) =>
		({ querySelectorAll: () => hrefs.map((href) => ({ href })) }) as unknown as Parameters<
			typeof linkPaths
		>[0];

	it('keeps same-origin pathnames once, without query or hash', () => {
		const paths = linkPaths(
			root([
				'https://corvmc.org/staff/bands',
				'https://corvmc.org/staff/bands?page=2',
				'https://corvmc.org/staff#top',
				'https://example.com/elsewhere'
			]),
			'https://corvmc.org'
		);
		expect(paths).toEqual(['/staff/bands', '/staff']);
	});
});
