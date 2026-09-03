import { describe, it, expect } from 'vitest';
import { fullPressKit, hasBookingContact, publicPressKit } from './press-kit';
import type { BandEpk } from '$lib/types/band-page';

/**
 * A band that filled in everything. Every private field carries a string that
 * appears nowhere else, so a leak can be found by searching the serialized
 * projection for it rather than by asserting field by field — which is the
 * check that keeps working when someone adds a field to `BandEpk`.
 */
const FULL: BandEpk = {
	bookingContact: { name: 'Booking Bea', email: 'bea@example.com', phone: '555-0100' },
	managementContact: { name: 'Manager Moe', email: 'moe@example.com', phone: '555-0101' },
	prContact: { name: 'Press Pat', email: 'pat@example.com' },
	technicalRiderKey: 'media/rider-secret.pdf',
	stagePlotKey: 'media/stageplot-secret.png',
	backline: [{ instrument: 'Bass cab', details: 'Ampeg 8x10', provided: false }],
	pressQuotes: [{ quote: 'Loud and good', publication: 'The Gazette', date: '2026-01-01' }],
	achievements: ['Played the big room'],
	videos: [{ url: 'https://youtube.com/watch?v=abc', label: 'Live at the barn' }]
};

/** Everything in `FULL` that must never cross into a public projection. */
const PRIVATE_MARKERS = [
	'Booking Bea',
	'bea@example.com',
	'555-0100',
	'Manager Moe',
	'moe@example.com',
	'555-0101',
	'Press Pat',
	'pat@example.com',
	'rider-secret',
	'stageplot-secret',
	'Ampeg 8x10'
];

describe('publicPressKit', () => {
	it('carries the marketing half', () => {
		const pub = publicPressKit(FULL);
		expect(pub.pressQuotes).toHaveLength(1);
		expect(pub.achievements).toEqual(['Played the big room']);
		expect(pub.videos).toHaveLength(1);
	});

	// The load-bearing test. Serializing and searching means a field added to
	// `BandEpk` and forgotten here fails this rather than passing silently.
	it.each(PRIVATE_MARKERS)('never leaks %s', (marker) => {
		expect(JSON.stringify(publicPressKit(FULL))).not.toContain(marker);
	});

	it('exposes exactly three keys, so a new one has to be considered', () => {
		expect(Object.keys(publicPressKit(FULL)).sort()).toEqual([
			'achievements',
			'pressQuotes',
			'videos'
		]);
	});

	it('is empty rather than undefined for a band that wrote nothing', () => {
		expect(publicPressKit(null)).toEqual({ pressQuotes: [], achievements: [], videos: [] });
		expect(publicPressKit(undefined)).toEqual({ pressQuotes: [], achievements: [], videos: [] });
		expect(publicPressKit({})).toEqual({ pressQuotes: [], achievements: [], videos: [] });
	});
});

describe('fullPressKit', () => {
	it.each(PRIVATE_MARKERS)('carries %s, which is what the package is for', (marker) => {
		expect(JSON.stringify(fullPressKit(FULL))).toContain(marker);
	});

	it('includes the whole public projection', () => {
		const full = fullPressKit(FULL);
		expect(full).toMatchObject(publicPressKit(FULL));
	});

	it('omits absent contacts rather than emitting undefined values', () => {
		const full = fullPressKit({ pressQuotes: [] });
		expect('bookingContact' in full).toBe(false);
		expect('technicalRiderKey' in full).toBe(false);
		expect(full.backline).toEqual([]);
	});
});

describe('hasBookingContact', () => {
	it('needs an email, not just a name', () => {
		expect(hasBookingContact(FULL)).toBe(true);
		expect(hasBookingContact({ bookingContact: { name: 'Nobody', email: '' } })).toBe(false);
		expect(hasBookingContact({})).toBe(false);
		expect(hasBookingContact(null)).toBe(false);
	});
});
