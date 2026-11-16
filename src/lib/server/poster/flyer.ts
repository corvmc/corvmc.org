import { DEFAULT_TIMEZONE } from '#lib/config.js';
import { priceDisplay } from '#lib/utils/event-ticketing.js';
import {
	bytesDataUrl,
	C,
	el,
	mascot,
	renderPng,
	sponsorRow,
	stripe,
	type Node,
	type SponsorLogo
} from './brand';

/** A show's flyer: the template when there is no art, or the art above a details footer. */

export const FLYER_WIDTH = 1080;
export const FLYER_HEIGHT = 1350;
const ART_HEIGHT = 1000;
// The art gives up this much height when a sponsor row joins the footer.
const SPONSOR_ROW_HEIGHT = 90;

export interface FlyerSource {
	title: string;
	startsAt: Date;
	doorsAt: Date | null;
	venue: string | null;
	bill: string[];
	ticketingEnabled: boolean;
	ticketPrice: number | null;
	ticketPriceFloorCents: number;
	externalTicketUrl: string | null;
}

export interface FlyerLines {
	title: string;
	when: string;
	doors: string | null;
	venue: string | null;
	bill: string[];
	price: string;
}

export function clock(d: Date): string {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: DEFAULT_TIMEZONE,
		hour: 'numeric',
		minute: '2-digit',
		hour12: true
	}).formatToParts(d);
	const hour = parts.find((p) => p.type === 'hour')?.value;
	const minute = parts.find((p) => p.type === 'minute')?.value;
	const period = parts.find((p) => p.type === 'dayPeriod')?.value.toUpperCase();
	return minute === '00' ? `${hour} ${period}` : `${hour}:${minute} ${period}`;
}

/** The words on the flyer, in the brand's poster conventions. */
export function flyerLines(src: FlyerSource): FlyerLines {
	const day = new Intl.DateTimeFormat('en-US', {
		timeZone: DEFAULT_TIMEZONE,
		weekday: 'long',
		month: 'long',
		day: 'numeric'
	})
		.format(src.startsAt)
		.toUpperCase();

	const shown = priceDisplay(src);
	// Posters say "$10", not "$10.00".
	const label = shown.label.replace(/\.00$/, '');
	const suggested = shown.suggested;
	const price = !suggested
		? label
		: src.ticketPriceFloorCents >= (src.ticketPrice ?? 0)
			? label
			: src.ticketPriceFloorCents === 0
				? `${label} suggested | NOTAFLOF`
				: `${label} suggested`;

	return {
		title: src.title,
		when: `${day} | ${clock(src.startsAt)}`,
		doors: src.doorsAt ? `DOORS ${clock(src.doorsAt)}` : null,
		venue: src.venue,
		bill: src.bill,
		price
	};
}

function details(lines: FlyerLines, compact: boolean): Node {
	const small = compact ? 30 : 38;
	return el(
		'div',
		{
			display: 'flex',
			flexDirection: 'column',
			flexShrink: 1,
			color: C.navy,
			fontSize: small,
			gap: 8
		},
		[
			el('div', { fontWeight: 700, letterSpacing: 2 }, lines.when),
			lines.doors ? el('div', { letterSpacing: 2 }, lines.doors) : null,
			lines.venue ? el('div', {}, lines.venue) : null,
			el('div', { color: C.orange, fontWeight: 700 }, lines.price)
		].filter(Boolean)
	);
}

function titleSize(title: string): number {
	if (title.length <= 16) return 124;
	if (title.length <= 32) return 96;
	return 68;
}

function templateTree(lines: FlyerLines, sponsors: SponsorLogo[]): Node {
	return el(
		'div',
		{
			display: 'flex',
			flexDirection: 'column',
			width: '100%',
			height: '100%',
			background: C.cream,
			fontFamily: 'Lexend'
		},
		[
			stripe(22),
			el(
				'div',
				{ display: 'flex', flexDirection: 'column', flexGrow: 1, padding: '64px 72px', gap: 40 },
				[
					el(
						'div',
						{ color: C.teal, fontSize: 30, letterSpacing: 6, fontWeight: 700 },
						'CORVALLIS MUSIC COLLECTIVE PRESENTS'
					),
					el(
						'div',
						{
							color: C.navy,
							fontSize: titleSize(lines.title),
							fontWeight: 700,
							lineHeight: 1.05,
							textTransform: 'uppercase'
						},
						lines.title
					),
					lines.bill.length > 0
						? el(
								'div',
								{ display: 'flex', flexDirection: 'column', gap: 6, color: C.orange },
								lines.bill.map((name) =>
									el('div', { fontSize: 52, fontWeight: 700 }, name.toUpperCase())
								)
							)
						: null,
					el('div', { flexGrow: 1 }),
					el('div', { display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }, [
						details(lines, false),
						mascot(220)
					]),
					sponsorRow(sponsors, 80)
				].filter(Boolean)
			),
			stripe(22)
		]
	);
}

function artTree(lines: FlyerLines, artSrc: string, sponsors: SponsorLogo[]): Node {
	const artHeight = sponsors.length > 0 ? ART_HEIGHT - SPONSOR_ROW_HEIGHT : ART_HEIGHT;
	return el(
		'div',
		{
			display: 'flex',
			flexDirection: 'column',
			width: '100%',
			height: '100%',
			background: C.cream,
			fontFamily: 'Lexend'
		},
		[
			el('img', { width: FLYER_WIDTH, height: artHeight, objectFit: 'cover' }, undefined, {
				src: artSrc
			}),
			stripe(12),
			el(
				'div',
				{
					display: 'flex',
					flexDirection: 'column',
					flexGrow: 1,
					justifyContent: 'center',
					gap: 20,
					padding: '0 56px'
				},
				[
					el('div', { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, [
						el('div', { display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 780 }, [
							el(
								'div',
								{ color: C.navy, fontSize: 40, fontWeight: 700, textTransform: 'uppercase' },
								lines.title
							),
							details(lines, true)
						]),
						mascot(160)
					]),
					sponsorRow(sponsors, 64)
				].filter(Boolean)
			)
		]
	);
}

/**
 * Rasterize a flyer to PNG. With `art`, the art sits above a details footer;
 * `sponsors` adds a logo row to the footer of either.
 */
export async function renderFlyer(
	lines: FlyerLines,
	opts: { art?: { bytes: Uint8Array; contentType: string }; sponsors?: SponsorLogo[] } = {}
): Promise<Uint8Array> {
	const sponsors = opts.sponsors ?? [];
	const tree = opts.art
		? artTree(lines, bytesDataUrl(opts.art.bytes, opts.art.contentType), sponsors)
		: templateTree(lines, sponsors);
	return renderPng(tree, FLYER_WIDTH, FLYER_HEIGHT);
}
