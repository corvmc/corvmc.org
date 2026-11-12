import { describe, it, expect, vi } from 'vitest';
import { renderSVG } from 'uqr';
import {
	billLine,
	eventLetterHtml,
	eventUrl,
	printedUrl,
	QR_OPTIONS,
	renderEventLetter,
	whereLine,
	type EventLetter
} from './event-letter';
import type { PosterPage } from './calendar';

/** What the print poster's footer carries, and how it prints. Layout is the browser's. */

const full: EventLetter = {
	lines: {
		title: 'Harvest Show',
		when: 'SATURDAY, NOVEMBER 14 | 8 PM',
		doors: 'DOORS 7 PM',
		venue: 'Whiteside',
		bill: ['First Band', 'Second Band'],
		price: '$10 suggested | NOTAFLOF'
	},
	address: '361 SW Madison Ave, Corvallis, OR',
	url: 'https://corvmc.org/events/evt-1',
	art: 'data:image/png;base64,AAAA',
	sponsors: [
		{ name: 'Acme Audio', src: 'data:image/png;base64,BBBB' },
		{ name: 'Bean Cafe', src: null }
	]
};

const bare: EventLetter = {
	...full,
	lines: { ...full.lines, doors: null, venue: null, bill: [], price: 'Free' },
	address: null,
	sponsors: []
};

/** The footer's fields, by class, with their text. */
function rows(html: string) {
	return Object.fromEntries(
		[...html.matchAll(/<(div|span) class="(bill|when|where|price|sponsors)">(.*?)<\/\1>/g)].map(
			(m) => [m[2], m[3].replace(/<[^>]+>/g, '')]
		)
	);
}

describe('eventLetterHtml', () => {
	it('prints every detail the event has', () => {
		const html = eventLetterHtml(full);
		expect(html).toContain('<h1>Harvest Show</h1>');
		expect(rows(html)).toMatchObject({
			bill: 'First Band · Second Band',
			when: 'SATURDAY, NOVEMBER 14 | 8 PM · DOORS 7 PM',
			where: 'Whiteside · 361 SW Madison Ave, Corvallis, OR',
			price: '$10 suggested | NOTAFLOF'
		});
	});

	it('leaves out the rows the event has no data for', () => {
		const html = eventLetterHtml(bare);
		const shown = rows(html);
		expect(shown).not.toHaveProperty('bill');
		expect(shown).not.toHaveProperty('where');
		expect(shown).not.toHaveProperty('sponsors');
		expect(shown.when).toBe('SATURDAY, NOVEMBER 14 | 8 PM');
		expect(html).not.toContain('SPONSORED BY');
	});

	it('draws each sponsor by logo, or by name when there is none', () => {
		const html = eventLetterHtml(full);
		expect(html).toContain('<img src="data:image/png;base64,BBBB" alt="Acme Audio">');
		expect(html).toContain('<span>Bean Cafe</span>');
	});

	it("codes the event's page in the QR and prints the events page under it", () => {
		const html = eventLetterHtml(full);
		const qr = renderSVG(full.url, QR_OPTIONS);
		expect(html).toContain(qr);
		expect(html).toContain(`<div>${printedUrl()}</div>`);
		expect(html.replace(qr, '')).not.toContain('evt-1');
	});

	it('escapes event text', () => {
		const html = eventLetterHtml({
			...full,
			lines: { ...full.lines, title: '<script>x</script> & co', bill: ['A "B"'] }
		});
		expect(html).not.toContain('<script>x');
		expect(html).toContain('&lt;script&gt;x&lt;/script&gt; &amp; co');
		expect(html).toContain('A &quot;B&quot;');
	});
});

describe('eventUrl', () => {
	it("is the event's public page", () => {
		expect(eventUrl('evt-9')).toMatch(/^https:\/\/[^/]+\/events\/evt-9$/);
	});
});

describe('printedUrl', () => {
	it('is the events page, without the scheme', () => {
		expect(printedUrl()).toMatch(/^[^/:]+\/events$/);
	});
});

describe('billLine', () => {
	it('drops a lineup that only repeats the title', () => {
		expect(billLine({ ...full.lines, bill: ['harvest show '] })).toBeNull();
		expect(billLine({ ...full.lines, bill: [' ', ''] })).toBeNull();
		expect(billLine({ ...full.lines, bill: ['Solo Act'] })).toEqual(['Solo Act']);
	});
});

describe('whereLine', () => {
	it.each([
		['Hall', '1 Main St', ['Hall', '1 Main St']],
		['Hall, 1 Main St', '1 Main St', ['Hall, 1 Main St']],
		[null, '1 Main St', ['1 Main St']],
		['Hall', ' ', ['Hall']],
		[null, null, []]
	] as const)('%s + %s', (venue, address, out) => {
		expect(whereLine(venue, address)).toEqual(out);
	});
});

describe('renderEventLetter', () => {
	it('prints one Letter page with backgrounds', async () => {
		const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
		const page = {
			setViewport: vi.fn(async () => {}),
			setContent: vi.fn(async () => {}),
			evaluate: vi.fn(async () => {}),
			screenshot: vi.fn(async () => new Uint8Array()),
			pdf: vi.fn(async () => pdf)
		} satisfies PosterPage;
		expect(await renderEventLetter(page, full)).toBe(pdf);
		expect(page.setViewport).toHaveBeenCalledWith({ width: 816, height: 1056 });
		expect(page.pdf).toHaveBeenCalledWith({
			format: 'Letter',
			printBackground: true,
			pageRanges: '1'
		});
	});
});
