import { describe, it, expect, vi } from 'vitest';
import { posterFormats } from '#lib/config.js';
import { calendarHtml, monthUrl, renderCalendar, type PosterPage } from './calendar';

/** What the poster page carries, and how each format is printed. Layout is the browser's. */

const event = (id: string, madeBy: 'cmc' | 'member', title = id) => ({
	id,
	title,
	startsAt: new Date(Date.UTC(2026, 10, 15, 4)),
	madeBy
});

const poster = {
	month: '2026-11',
	events: [event('first', 'member'), event('second', 'cmc'), event('third', 'member')],
	sponsors: [{ name: 'Acme Audio', src: null }]
};

function fakePage() {
	const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
	const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
	const page = {
		setViewport: vi.fn(async () => {}),
		setContent: vi.fn(async () => {}),
		evaluate: vi.fn(async () => {}),
		screenshot: vi.fn(async () => png),
		pdf: vi.fn(async () => pdf)
	} satisfies PosterPage;
	return { page, png, pdf };
}

describe('calendarHtml', () => {
	it('lists events in the order given, each marked by who made it', () => {
		const html = calendarHtml(poster, 'letter');
		const rows = [
			...html.matchAll(/<li class="row"><span class="mark (\w+)">.*?<span class="title">(\w+)</g)
		];
		expect(rows.map((r) => [r[2], r[1]])).toEqual([
			['first', 'member'],
			['second', 'cmc'],
			['third', 'member']
		]);
	});

	it('escapes listing titles and sponsor names', () => {
		const html = calendarHtml(
			{
				...poster,
				events: [event('x', 'cmc', '<script>alert(1)</script> & co')],
				sponsors: [{ name: 'A "B" <C>', src: null }]
			},
			'social'
		);
		expect(html).not.toContain('<script>alert');
		expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; co');
		expect(html).toContain('A &quot;B&quot; &lt;C&gt;');
	});

	it("prints the QR code's address under it", () => {
		const html = calendarHtml(poster, 'tabloid');
		expect(html).toContain('<svg');
		expect(html).toContain(monthUrl('2026-11').replace(/^https?:\/\//, ''));
	});
});

describe('monthUrl', () => {
	it("opens the public events page at the month's first day", () => {
		expect(monthUrl('2026-12')).toMatch(/^https:\/\/[^/]+\/events\?from=2026-12-01$/);
	});
});

describe('renderCalendar', () => {
	it.each([
		['letter', 'Letter'],
		['tabloid', 'Tabloid']
	] as const)('prints %s as a one-page PDF with a PNG preview', async (format, paper) => {
		const { page, png, pdf } = fakePage();
		const out = await renderCalendar(page, poster, format);
		expect(page.pdf).toHaveBeenCalledWith({
			format: paper,
			printBackground: true,
			pageRanges: '1'
		});
		expect(out).toEqual({ file: pdf, contentType: 'application/pdf', preview: png });
	});

	it('captures the social size as a PNG and prints no PDF', async () => {
		const { page, png } = fakePage();
		const out = await renderCalendar(page, poster, 'social');
		expect(page.setViewport).toHaveBeenCalledWith({ width: 1080, height: 1350 });
		expect(page.pdf).not.toHaveBeenCalled();
		expect(out).toEqual({ file: png, contentType: 'image/png', preview: png });
	});

	it('fits the page before capturing it, in every format', async () => {
		for (const format of posterFormats) {
			const { page } = fakePage();
			await renderCalendar(page, poster, format);
			const order = (fn: { mock: { invocationCallOrder: number[] } }) =>
				fn.mock.invocationCallOrder[0];
			expect(order(page.setContent)).toBeLessThan(order(page.evaluate));
			expect(order(page.evaluate)).toBeLessThan(order(page.screenshot));
		}
	});
});
