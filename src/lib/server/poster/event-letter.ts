import { renderSVG } from 'uqr';
import { C, type SponsorLogo } from './brand';
import { esc, siteUrl, type PosterPage } from './calendar';
import type { FlyerLines } from './flyer';
import lexendRegular from './assets/Lexend-Regular.ttf?inline';
import lexendBold from './assets/Lexend-Bold.ttf?inline';
import speaker from './assets/cmc-speaker.png?inline';

/**
 * One event's social image on a Letter page, above a footer of the event's
 * details. The image keeps its ratio: full width when the footer still gets
 * `FOOTER_MIN`, otherwise scaled down and centred on cream. Sizes are CSS px
 * at 96 per inch.
 */

const PAGE = { width: 816, height: 1056 };
// 0.375 in all round, as the calendar poster: inside what office printers reach.
const MARGIN = 36;
// 2.4 in. A 4:5 image gets 754 px of the 984 px page; a 1:1 image runs full width.
export const FOOTER_MIN = 230;

// Detail type sizes in px, tried in order; the first that fits the footer wins.
const SIZES = [17, 16, 15, 14, 13, 12, 11, 10];

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
body { width: ${PAGE.width}px; height: ${PAGE.height}px; padding: ${MARGIN}px; }
.poster { display: flex; flex-direction: column; width: 100%; height: 100%; background: ${C.cream}; font-family: Lexend; color: ${C.navy}; }
.art { display: block; flex: 0 1 auto; width: 100%; height: auto; min-height: 0; object-fit: contain; }
footer { display: flex; flex-direction: column; flex: 1 0 ${FOOTER_MIN}px; min-height: ${FOOTER_MIN}px; }
.stripe { display: flex; flex-direction: column; flex-shrink: 0; }
.stripe div { height: 5px; }
.body { flex: 1 1 0; min-height: 0; display: flex; align-items: center; gap: 20px; padding: 12px 20px 14px; }
.details { flex: 1 1 0; min-width: 0; max-height: 100%; overflow: hidden; display: flex; flex-direction: column; gap: 0.3em; line-height: 1.2; }
h1 { font-size: 1.9em; font-weight: 700; line-height: 1.05; text-transform: uppercase; overflow-wrap: anywhere; }
.bill { color: ${C.orange}; font-weight: 700; font-size: 1.1em; }
.bill span, .where span { display: inline-block; }
.when { font-weight: 700; letter-spacing: 0.06em; }
.price { color: ${C.orange}; font-weight: 700; }
.sponsors { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4em 1.2em; margin-top: 0.3em; }
.sponsors h2 { color: ${C.teal}; font-size: 0.7em; letter-spacing: 0.25em; }
.sponsors img { height: 2.2em; max-width: 7em; object-fit: contain; }
.sponsors span { font-weight: 700; font-size: 0.9em; }
.side { display: flex; align-items: flex-end; gap: 14px; flex-shrink: 0; }
.mascot { width: 96px; }
.qr { display: flex; flex-direction: column; align-items: center; gap: 4px; width: 132px; }
.qr svg { width: 120px; height: 120px; display: block; }
.qr div { font-size: 8.5px; line-height: 1.25; color: ${C.teal}; text-align: center; overflow-wrap: anywhere; }
`;

/** The poster as a self-contained page: fonts, images and QR code inline. */
export function eventLetterHtml(poster: EventLetter): string {
	const { lines } = poster;
	const qr = renderSVG(poster.url, { border: 2, blackColor: C.navy, whiteColor: C.cream });
	const stripe = `<div class="stripe"><div style="background:${C.teal}"></div><div style="background:${C.goldenrod}"></div><div style="background:${C.redOrange}"></div></div>`;
	const bill = billLine(lines);
	const where = whereLine(lines.venue, poster.address);
	const when = lines.doors ? `${lines.when} · ${lines.doors}` : lines.when;
	const sponsors = poster.sponsors.length
		? `<div class="sponsors"><h2>SPONSORED BY</h2>${poster.sponsors
				.map((s) =>
					s.src ? `<img src="${esc(s.src)}" alt="${esc(s.name)}">` : `<span>${esc(s.name)}</span>`
				)
				.join('')}</div>`
		: '';
	const details = [
		`<h1>${esc(lines.title)}</h1>`,
		bill ? `<div class="bill">${bill.map((b) => `<span>${esc(b)}</span>`).join(' · ')}</div>` : '',
		`<div class="when">${esc(when)}</div>`,
		where.length
			? `<div class="where">${where.map((w) => `<span>${esc(w)}</span>`).join(' · ')}</div>`
			: '',
		lines.price ? `<div class="price">${esc(lines.price)}</div>` : '',
		sponsors
	].join('');
	return `<!doctype html><html><head><meta charset="utf-8"><style>${STYLE}</style></head><body><div class="poster">
<img class="art" src="${esc(poster.art)}" alt="">
<footer>${stripe}<div class="body"><div class="details" style="font-size:${SIZES[0]}px">${details}</div>
<div class="side"><img class="mascot" src="${speaker}" alt=""><div class="qr">${qr}<div>${esc(
		poster.url.replace(/^https?:\/\//, '')
	)}</div></div></div></div></footer></div></body></html>`;
}

// Runs in the page, as a string so no bundler helper leaks into it. Waits for
// the art and fonts, then shrinks the details until they fit the footer.
const FIT_SCRIPT = `(async () => {
	await document.fonts.ready;
	await Promise.all([...document.images].map((i) => i.decode().catch(() => {})));
	const details = document.querySelector('.details');
	for (const size of ${JSON.stringify(SIZES)}) {
		details.style.fontSize = size + 'px';
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
