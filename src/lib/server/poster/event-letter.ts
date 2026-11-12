import { renderSVG } from 'uqr';
import { C, type SponsorLogo } from './brand';
import { esc, siteUrl, type PosterPage } from './calendar';
import type { FlyerLines } from './flyer';
import lexendRegular from './assets/Lexend-Regular.ttf?inline';
import lexendBold from './assets/Lexend-Bold.ttf?inline';
import speaker from './assets/cmc-speaker.png?inline';

/**
 * One event's social image full bleed on a Letter page, above a dense footer
 * of the event's details. The art runs to the top and side edges; the footer
 * keeps its contents `INSET` inside the page. Sizes are CSS px at 96 per inch.
 */

const PAGE = { width: 816, height: 1056 };
// 0.25 in: the smallest margin office printers reliably reach, for footer text.
const INSET = 24;
// 1.5 in. A 4:5 image (1020 px tall at full width) gets 912 px: 10.6% cropped, centred.
export const FOOTER_MIN = 144;
// Past this share of its height cropped, the art is fitted inside cream bands instead.
const MAX_CROP = 0.12;

// Detail type sizes in px, largest first; the first that fits the footer wins.
const SIZES = [20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9];

export interface EventLetter {
	lines: FlyerLines;
	address: string | null;
	url: string;
	/** The image as a data URL. */
	art: string;
	sponsors: SponsorLogo[];
}

/** Where the QR code points: the event's public page. */
export function eventUrl(eventId: string): string {
	return `${siteUrl()}/events/${eventId}`;
}

/**
 * The address printed under the QR code. Events have no slug or short link,
 * and a UUID path cannot be typed off paper, so it names the events page.
 */
export function printedUrl(): string {
	return `${siteUrl().replace(/^https?:\/\//, '')}/events`;
}

/** The lineup, unless it only repeats the title. */
export function billLine(lines: FlyerLines): string[] | null {
	const bill = lines.bill.filter((b) => b.trim());
	if (bill.length === 0) return null;
	if (bill.length === 1 && bill[0].trim().toLowerCase() === lines.title.trim().toLowerCase()) {
		return null;
	}
	return bill;
}

/** Venue and address, without repeating an address the venue name already holds. */
export function whereLine(venue: string | null, address: string | null): string[] {
	const v = venue?.trim() || null;
	const a = address?.trim() || null;
	if (v && a && !v.toLowerCase().includes(a.toLowerCase())) return [v, a];
	return [v ?? a].filter((s): s is string => Boolean(s));
}

const STYLE = `
@font-face { font-family: Lexend; font-weight: 400; src: url(${lexendRegular}) format('truetype'); }
@font-face { font-family: Lexend; font-weight: 700; src: url(${lexendBold}) format('truetype'); }
@page { size: 8.5in 11in; margin: 0; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { background: #fff; overflow: hidden; }
body { width: ${PAGE.width}px; height: ${PAGE.height}px; }
.poster { display: flex; flex-direction: column; width: 100%; height: 100%; background: ${C.cream}; font-family: Lexend; color: ${C.navy}; }
.art { display: block; flex: none; width: 100%; height: ${PAGE.height - FOOTER_MIN}px; object-fit: cover; object-position: center; }
footer { display: flex; flex-direction: column; flex: 1 0 ${FOOTER_MIN}px; min-height: ${FOOTER_MIN}px; }
.stripe { display: flex; flex-direction: column; flex-shrink: 0; }
.stripe div { height: 3px; }
.body { flex: 1 1 0; min-height: 0; display: flex; align-items: center; gap: 12px; padding: 6px ${INSET}px ${INSET}px; }
.details { flex: 1 1 0; min-width: 0; max-height: 100%; overflow: hidden; display: flex; flex-direction: column; gap: 0.12em; line-height: 1.18; }
.details > * { flex-shrink: 0; }
h1 { font-size: 1.8em; font-weight: 700; line-height: 1.05; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
em { font-style: normal; display: inline-block; }
.bill { color: ${C.orange}; font-weight: 700; }
.when { font-weight: 700; letter-spacing: 0.04em; }
.price { color: ${C.orange}; font-weight: 700; }
.sponsors { display: flex; flex-wrap: wrap; align-items: center; gap: 0.2em 0.9em; }
.sponsors h2 { color: ${C.teal}; font-size: 0.62em; letter-spacing: 0.2em; }
.sponsors img { height: 1.6em; max-width: 6em; object-fit: contain; }
.sponsors span { font-weight: 700; font-size: 0.85em; }
.side { display: flex; align-items: flex-end; gap: 6px; flex-shrink: 0; }
.mascot { width: 56px; }
.qr { display: flex; flex-direction: column; align-items: center; gap: 2px; }
.qr svg { width: 96px; height: 96px; display: block; }
.qr div { font-size: 9px; line-height: 1.1; color: ${C.teal}; white-space: nowrap; }
`;

// Navy on cream with a one-module quiet zone; the cream footer extends it.
export const QR_OPTIONS = { border: 1, blackColor: C.navy, whiteColor: C.cream };

const sep = ' · ';

/** The poster as a self-contained page: fonts, images and QR code inline. */
export function eventLetterHtml(poster: EventLetter): string {
	const { lines } = poster;
	const qr = renderSVG(poster.url, QR_OPTIONS);
	const stripe = `<div class="stripe"><div style="background:${C.teal}"></div><div style="background:${C.goldenrod}"></div><div style="background:${C.redOrange}"></div></div>`;
	const bill = billLine(lines);
	const where = whereLine(lines.venue, poster.address);
	const when = lines.doors ? `${lines.when}${sep}${lines.doors}` : lines.when;
	const ems = (parts: string[]) => parts.map((p) => `<em>${esc(p)}</em>`).join(sep);
	const info = [
		`<span class="when">${esc(when)}</span>`,
		where.length ? `<span class="where">${ems(where)}</span>` : '',
		lines.price ? `<span class="price">${esc(lines.price)}</span>` : ''
	]
		.filter(Boolean)
		.join(sep);
	const sponsors = poster.sponsors.length
		? `<div class="sponsors"><h2>SPONSORED BY</h2>${poster.sponsors
				.map((s) =>
					s.src ? `<img src="${esc(s.src)}" alt="${esc(s.name)}">` : `<span>${esc(s.name)}</span>`
				)
				.join('')}</div>`
		: '';
	const details = [
		`<h1>${esc(lines.title)}</h1>`,
		bill ? `<div class="bill">${ems(bill)}</div>` : '',
		`<div class="info">${info}</div>`,
		sponsors
	].join('');
	return `<!doctype html><html><head><meta charset="utf-8"><style>${STYLE}</style></head><body><div class="poster">
<img class="art" src="${esc(poster.art)}" alt="">
<footer>${stripe}<div class="body"><div class="details" style="font-size:${SIZES[0]}px">${details}</div>
<div class="side"><img class="mascot" src="${speaker}" alt=""><div class="qr">${qr}<div>${esc(
		printedUrl()
	)}</div></div></div></div></footer></div></body></html>`;
}

// Runs in the page, as a string so no bundler helper leaks into it. Sizes the
// art box, then the QR code to the footer left, then takes the largest type
// that fits, with the title shrunk onto one line at each size.
const FIT_SCRIPT = `(async () => {
	await document.fonts.ready;
	await Promise.all([...document.images].map((i) => i.decode().catch(() => {})));
	const art = document.querySelector('.art');
	const natural = art.naturalWidth ? ${PAGE.width} * art.naturalHeight / art.naturalWidth : 0;
	const box = ${PAGE.height - FOOTER_MIN};
	art.style.height = Math.min(natural || box, box) + 'px';
	if (natural > box && (natural - box) / natural > ${MAX_CROP}) art.style.objectFit = 'contain';
	const body = document.querySelector('.body');
	const details = document.querySelector('.details');
	const title = details.querySelector('h1');
	const qr = document.querySelector('.qr svg');
	const room = body.clientHeight - 6 - ${INSET} - 12;
	const side = Math.max(64, Math.min(132, room));
	qr.style.width = qr.style.height = side + 'px';
	document.querySelector('.mascot').style.width = Math.round(side * 0.58) + 'px';
	for (const size of ${JSON.stringify(SIZES)}) {
		details.style.fontSize = size + 'px';
		for (let t = 2.4; t >= 1.1; t -= 0.05) {
			title.style.fontSize = t + 'em';
			if (title.scrollWidth <= title.clientWidth + 1) break;
		}
		if (details.scrollHeight <= details.clientHeight + 1) return;
	}
})()`;

/** Lay the poster out in `page` and print it as a one-page Letter PDF. */
export async function renderEventLetter(
	page: PosterPage,
	poster: EventLetter
): Promise<Uint8Array> {
	await page.setViewport(PAGE);
	await page.setContent(eventLetterHtml(poster));
	await page.evaluate(FIT_SCRIPT);
	return page.pdf({ format: 'Letter', printBackground: true, pageRanges: '1' });
}
