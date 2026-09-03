import { describe, it, expect } from 'vitest';
import { renderPressKitHtml, renderPressKitText, escapeHtml } from './press-kit-html';
import type { PressKitDocument } from './press-kit-html';
import { fullPressKit } from './press-kit';

const BARE: PressKitDocument = {
	name: 'The Velvet Underground',
	tagline: null,
	bioHtml: null,
	genres: [],
	hometown: null,
	foundedYear: null,
	url: null,
	members: [],
	shows: [],
	links: [],
	epk: fullPressKit(null),
	photoPaths: [],
	riderPath: null,
	stagePlotPath: null
};

const FULL: PressKitDocument = {
	...BARE,
	tagline: 'Loud',
	bioHtml: '<p>A band from <em>Corvallis</em>.</p>',
	genres: ['rock'],
	hometown: 'Corvallis',
	foundedYear: '1965',
	url: 'https://the-velvet-underground.corvmc.org',
	members: [{ name: 'Jeff', position: 'bass' }],
	shows: [{ title: 'A gig', when: 'Fri, Sep 4, 2026', where: 'The Barn' }],
	links: [{ label: 'Bandcamp', url: 'https://act.bandcamp.com/album/foo' }],
	epk: fullPressKit({
		bookingContact: { name: 'Bea', email: 'bea@example.com', phone: '555-0100' },
		backline: [{ instrument: 'Bass cab', details: 'Ampeg 8x10', provided: false }],
		pressQuotes: [{ quote: 'Loud and good', publication: 'The Gazette' }],
		achievements: ['Played the big room']
	}),
	photoPaths: ['photos/press-1.jpg'],
	riderPath: 'rider.pdf',
	stagePlotPath: 'stage-plot.png'
};

describe('renderPressKitHtml', () => {
	it('renders an act that has written nothing, without empty sections', () => {
		// A band downloads its kit before filling it in. A page of blank headings
		// would look broken, so a section with no body is omitted entirely.
		const html = renderPressKitHtml(BARE);
		expect(html).toContain('The Velvet Underground');
		expect(html).not.toContain('<h2>Backline</h2>');
		expect(html).not.toContain('<h2>Lineup</h2>');
		expect(html).not.toContain('<h2>Contact</h2>');
	});

	it('carries the advance half — this file is the private one', () => {
		const html = renderPressKitHtml(FULL);
		for (const marker of ['Bea', 'bea@example.com', '555-0100', 'Ampeg 8x10']) {
			expect(html).toContain(marker);
		}
	});

	it('references images by their path inside the zip, not by URL', () => {
		// The unzipped folder has to render with no network at all.
		const html = renderPressKitHtml(FULL);
		expect(html).toContain('src="photos/press-1.jpg"');
		expect(html).not.toMatch(/src="https?:/);
	});

	it('ends with a QR code and the live address', () => {
		// The package is a snapshot; the page it points at is not. Losing this
		// footer is how a sent kit goes stale with nothing to correct it.
		const html = renderPressKitHtml(FULL);
		expect(html).toContain('<svg');
		expect(html).toContain('the-velvet-underground.corvmc.org');
	});

	it('draws no QR when the act has no address to encode', () => {
		expect(renderPressKitHtml(BARE)).not.toContain('<svg');
	});

	it('escapes every field a band controls', () => {
		const html = renderPressKitHtml({
			...FULL,
			name: '<script>alert(1)</script>',
			tagline: 'Tom & Jerry\'s "band"',
			epk: fullPressKit({
				pressQuotes: [{ quote: '<img onerror=x>', publication: 'The <b>Gazette</b>' }],
				bookingContact: { name: '<b>Bea</b>', email: 'a@b.c' }
			})
		});
		expect(html).not.toContain('<script>alert');
		expect(html).not.toContain('<img onerror');
		expect(html).not.toContain('<b>Bea</b>');
		expect(html).toContain('Tom &amp; Jerry&#39;s &quot;band&quot;');
	});

	it('passes the bio through as HTML, because it arrives sanitized', () => {
		// The one exception, and it is deliberate: `sanitizeBio` has already run.
		expect(renderPressKitHtml(FULL)).toContain('<em>Corvallis</em>');
	});
});

describe('renderPressKitText', () => {
	it('is plain text with no tags left in it', () => {
		const text = renderPressKitText(FULL);
		// Named tags, not any `<`: a contact line writes an address as
		// `Bea <bea@example.com>`, which is correct plain text and not markup.
		expect(text).not.toMatch(/<\/?(p|div|span|em|strong|b|i|a|img|script|br)\b/i);
		expect(text).toContain('A band from Corvallis.');
	});

	it('carries the contacts and the live address', () => {
		const text = renderPressKitText(FULL);
		expect(text).toContain('bea@example.com');
		expect(text).toContain('https://the-velvet-underground.corvmc.org');
	});

	it('renders an empty act as just its name', () => {
		expect(renderPressKitText(BARE).trim()).toBe('THE VELVET UNDERGROUND');
	});
});

describe('escapeHtml', () => {
	it('covers all five', () => {
		expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
	});
});
