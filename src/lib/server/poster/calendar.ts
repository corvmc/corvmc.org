import { renderSVG } from 'uqr';
import * as publicEnv from '$app/env/public';
import { DEFAULT_TIMEZONE, type PosterFormat } from '#lib/config.js';
import { C, type SponsorLogo } from './brand';
import { clock } from './flyer';
import type { CalendarEvent } from './calendar-service';
import lexendRegular from './assets/Lexend-Regular.ttf?inline';
import lexendBold from './assets/Lexend-Bold.ttf?inline';
import speaker from './assets/cmc-speaker.png?inline';

export type { PosterFormat };

/**
 * A month of public listings as one HTML page, laid out by a browser and
 * printed to PDF (Letter, Tabloid) or captured as a PNG (social feed).
 * Sizes are CSS px at 96 per inch; the design is drawn in rem on a 1080 px
 * wide poster and scaled by the root font size.
 */
const PAGES: Record<
	PosterFormat,
	{ width: number; height: number; margin: number; pdf: 'Letter' | 'Tabloid' | null }
> = {
	// 0.375 in all round: inside what home and office printers can reach.
	letter: { width: 816, height: 1056, margin: 36, pdf: 'Letter' },
	tabloid: { width: 1056, height: 1632, margin: 36, pdf: 'Tabloid' },
	social: { width: 1080, height: 1350, margin: 0, pdf: null }
};

// Tried in order (columns, type size in rem); the first that holds every row wins.
const LAYOUTS = [
	[1, 3.4],
	[1, 2.8],
	[1, 2.4],
	[2, 2.4],
	[2, 2.0],
	[2, 1.7],
	[2, 1.5]
];

export interface CalendarPoster {
	month: string;
	events: CalendarEvent[];
	sponsors: SponsorLogo[];
}

/** The page a browser session hands the renderer; Browser Rendering in production. */
export interface PosterPage {
	setViewport(v: { width: number; height: number }): Promise<unknown>;
	setContent(html: string): Promise<unknown>;
	evaluate(script: string): Promise<unknown>;
	screenshot(): Promise<Uint8Array>;
	pdf(opts: {
		format: 'Letter' | 'Tabloid';
		printBackground: boolean;
		pageRanges: string;
	}): Promise<Uint8Array>;
}

export interface RenderedPoster {
	file: Uint8Array;
	contentType: 'application/pdf' | 'image/png';
	/** A PNG of the same page, for the staff preview. */
	preview: Uint8Array;
}

/** Where the QR code points: the public events page, opened at the month's first day. */
export function monthUrl(month: string): string {
	return `${siteUrl()}/events?from=${month}-01`;
}

/** The public site's origin, without a trailing slash. */
export const siteUrl = () => (publicEnv.PUBLIC_SITE_URL ?? 'https://corvmc.org').replace(/\/$/, '');

/** Text made safe to place in a poster page. */
export const esc = (s: string) =>
	s.replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
	);

/** "THU 19", in club time. */
function dayLabel(d: Date): string {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: DEFAULT_TIMEZONE,
		weekday: 'short',
		day: 'numeric'
	}).formatToParts(d);
	const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
	return `${part('weekday').toUpperCase()} ${part('day')}`;
}

function monthLabel(month: string): string {
	const [y, m] = month.split('-').map(Number);
	return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
		.format(new Date(Date.UTC(y, m - 1, 15)))
		.toUpperCase();
}

const row = (e: CalendarEvent) =>
	`<li class="row"><span class="mark ${e.madeBy}"></span><span class="day">${dayLabel(
		e.startsAt
	)}</span><span class="time">${clock(e.startsAt)}</span><span class="title">${esc(
		e.title
	)}</span></li>`;

const sponsor = (s: SponsorLogo) =>
	s.src ? `<img src="${esc(s.src)}" alt="${esc(s.name)}">` : `<span>${esc(s.name)}</span>`;

const STYLE = `
@font-face { font-family: Lexend; font-weight: 400; src: url(${lexendRegular}) format('truetype'); }
@font-face { font-family: Lexend; font-weight: 700; src: url(${lexendBold}) format('truetype'); }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { background: #fff; overflow: hidden; }
.poster { display: flex; flex-direction: column; background: ${C.cream}; font-family: Lexend; color: ${C.navy}; }
.stripe { display: flex; flex-direction: column; flex-shrink: 0; }
.stripe div { height: 2.2rem; }
main { display: flex; flex-direction: column; flex: 1 1 0; min-height: 0; padding: 4rem 5.6rem 3.2rem; }
.eyebrow { color: ${C.teal}; font-size: 2.8rem; font-weight: 700; letter-spacing: 0.6rem; }
h1 { font-size: 9.6rem; font-weight: 700; line-height: 1.1; }
.legend { display: flex; gap: 3.2rem; margin: 0.8rem 0 2rem; font-size: 2.2rem; color: ${C.brown}; }
.legend span { display: flex; align-items: center; gap: 1rem; }
.mark { display: inline-block; width: 0.55em; height: 0.55em; flex-shrink: 0; }
.mark.cmc { background: ${C.teal}; }
.mark.member { border: 0.14em solid ${C.redOrange}; border-radius: 50%; }
.list { flex: 1 1 0; min-height: 0; overflow: hidden; list-style: none; column-fill: auto; column-gap: 4rem; line-height: 1.25; }
.row { display: grid; grid-template-columns: 1em 4.6em 4.6em 1fr; align-items: start; padding: 0.15em 0; break-inside: avoid; }
.row .mark { margin-top: 0.36em; }
.day { font-weight: 700; white-space: nowrap; }
.time { color: ${C.orange}; white-space: nowrap; }
.title { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.more { color: ${C.brown}; padding: 0.15em 0; }
footer { display: flex; align-items: flex-end; gap: 3.2rem; margin-top: 2.4rem; flex-shrink: 0; }
.sponsors { flex: 1 1 0; display: flex; flex-direction: column; gap: 1.2rem; }
.sponsors h2 { color: ${C.teal}; font-size: 1.8rem; letter-spacing: 0.4rem; }
.logos { display: flex; flex-wrap: wrap; align-items: center; gap: 1.2rem 2.8rem; }
.logos img { height: 6rem; max-width: 15.6rem; object-fit: contain; }
.logos span { font-size: 2.2rem; font-weight: 700; }
.qr { display: flex; flex-direction: column; align-items: center; gap: 0.6rem; }
.qr svg { width: 16rem; height: 16rem; display: block; }
.qr div { font-size: 1.6rem; color: ${C.teal}; }
.mascot { width: 20rem; flex-shrink: 0; }
`;

/** The poster as a self-contained page: fonts, images and QR code inline. */
export function calendarHtml(poster: CalendarPoster, format: PosterFormat): string {
	const page = PAGES[format];
	const width = page.width - 2 * page.margin;
	const height = page.height - 2 * page.margin;
	const url = monthUrl(poster.month);
	const qr = renderSVG(url, { border: 2, blackColor: C.navy, whiteColor: C.cream });
	const stripe = `<div class="stripe"><div style="background:${C.teal}"></div><div style="background:${C.goldenrod}"></div><div style="background:${C.redOrange}"></div></div>`;
	const sponsors = poster.sponsors.length
		? `<h2>SPONSORED BY</h2><div class="logos">${poster.sponsors.map(sponsor).join('')}</div>`
		: '';
	return `<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: ${page.width / 96}in ${page.height / 96}in; margin: 0; }
html { font-size: ${(10 * width) / 1080}px; }
body { width: ${page.width}px; height: ${page.height}px; padding: ${page.margin}px; }
.poster { width: ${width}px; height: ${height}px; }
${STYLE}</style></head><body><div class="poster">${stripe}<main>
<div class="eyebrow">CORVALLIS MUSIC COLLECTIVE</div>
<h1>${monthLabel(poster.month)}</h1>
<div class="legend"><span><i class="mark cmc"></i>CMC event</span><span><i class="mark member"></i>Member event</span></div>
<ol class="list">${poster.events.map(row).join('')}</ol>
<footer><div class="sponsors">${sponsors}</div>
<div class="qr">${qr}<div>${esc(url.replace(/^https?:\/\//, ''))}</div></div>
<img class="mascot" src="${speaker}" alt=""></footer>
</main>${stripe}</div></body></html>`;
}

// Runs in the page, as a string so no bundler helper leaks into it. Shrinks
// the type, then splits into two columns, then names the rows it drops.
const FIT_SCRIPT = `(async () => {
	await document.fonts.ready;
	const list = document.querySelector('.list');
	const fits = () =>
		list.scrollHeight <= list.clientHeight + 1 && list.scrollWidth <= list.clientWidth + 1;
	for (const [columns, size] of ${JSON.stringify(LAYOUTS)}) {
		list.style.columnCount = columns;
		list.style.fontSize = size + 'rem';
		if (fits()) return;
	}
	const rows = [...list.querySelectorAll('.row')];
	const more = document.createElement('li');
	more.className = 'more';
	list.append(more);
	for (let n = 1; n <= rows.length; n++) {
		rows[rows.length - n].remove();
		more.textContent = '+' + n + ' more events';
		if (fits()) return;
	}
})()`;

/** Lay the poster out in `page` and print it in `format`. */
export async function renderCalendar(
	page: PosterPage,
	poster: CalendarPoster,
	format: PosterFormat
): Promise<RenderedPoster> {
	const { width, height, pdf } = PAGES[format];
	await page.setViewport({ width, height });
	await page.setContent(calendarHtml(poster, format));
	await page.evaluate(FIT_SCRIPT);
	const preview = await page.screenshot();
	if (!pdf) return { file: preview, contentType: 'image/png', preview };
	return {
		file: await page.pdf({ format: pdf, printBackground: true, pageRanges: '1' }),
		contentType: 'application/pdf',
		preview
	};
}
