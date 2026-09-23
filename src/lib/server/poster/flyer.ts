import { render } from '@cf-wasm/og';
import { DEFAULT_TIMEZONE } from '$lib/config';
import { priceDisplay } from '$lib/utils/event-ticketing';
import lexendRegular from './assets/Lexend-Regular.ttf?inline';
import lexendBold from './assets/Lexend-Bold.ttf?inline';
import speaker from './assets/cmc-speaker.png?inline';

/**
 * A show's flyer: the template when there is no art, or the art above a
 * details footer. Brand rules from the design system: Lexend only, flat fills
 * on cream, a hard-stop tri-stripe, and the speaker mascot. Fonts are bundled
 * so a render never waits on a third party.
 */

export const FLYER_WIDTH = 1080;
export const FLYER_HEIGHT = 1350;
const ART_HEIGHT = 1000;

const C = {
	cream: '#fffbf6',
	navy: '#003b5c',
	teal: '#00859b',
	orange: '#e5771e',
	goldenrod: '#ffb500',
	redOrange: '#f84d13',
	brown: '#5a3d2b'
};

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

function clock(d: Date): string {
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

type Node = { type: string; props: Record<string, unknown> };

function el(type: string, style: Record<string, unknown>, children?: unknown, extra = {}): Node {
	return { type, props: { style, children, ...extra } };
}

const stripe = (height: number) =>
	el('div', { display: 'flex', flexDirection: 'column', width: '100%' }, [
		el('div', { height, background: C.teal }),
		el('div', { height, background: C.goldenrod }),
		el('div', { height, background: C.redOrange })
	]);

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

function mascot(width: number): Node {
	return el(
		'img',
		{ width, height: Math.round((width * 125) / 255), flexShrink: 0, marginLeft: 24 },
		undefined,
		{ src: speaker }
	);
}

function titleSize(title: string): number {
	if (title.length <= 16) return 124;
	if (title.length <= 32) return 96;
	return 68;
}

function templateTree(lines: FlyerLines): Node {
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
					])
				].filter(Boolean)
			),
			stripe(22)
		]
	);
}

function artTree(lines: FlyerLines, artSrc: string): Node {
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
			el('img', { width: FLYER_WIDTH, height: ART_HEIGHT, objectFit: 'cover' }, undefined, {
				src: artSrc
			}),
			stripe(12),
			el(
				'div',
				{
					display: 'flex',
					flexGrow: 1,
					alignItems: 'center',
					justifyContent: 'space-between',
					padding: '0 56px'
				},
				[
					el('div', { display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 780 }, [
						el(
							'div',
							{ color: C.navy, fontSize: 40, fontWeight: 700, textTransform: 'uppercase' },
							lines.title
						),
						details(lines, true)
					]),
					mascot(160)
				]
			)
		]
	);
}

function dataUrlBytes(dataUrl: string): ArrayBuffer {
	const bin = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out.buffer;
}

function bytesDataUrl(bytes: Uint8Array, contentType: string): string {
	let bin = '';
	for (let i = 0; i < bytes.length; i += 0x8000) {
		bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	}
	return `data:${contentType};base64,${btoa(bin)}`;
}

/** Rasterize a flyer to PNG. With `art`, the art sits above a details footer. */
export async function renderFlyer(
	lines: FlyerLines,
	art?: { bytes: Uint8Array; contentType: string }
): Promise<Uint8Array> {
	const tree = art ? artTree(lines, bytesDataUrl(art.bytes, art.contentType)) : templateTree(lines);
	const png = await render(tree as never, {
		width: FLYER_WIDTH,
		height: FLYER_HEIGHT,
		fonts: [
			{ name: 'Lexend', data: dataUrlBytes(lexendRegular), weight: 400, style: 'normal' },
			{ name: 'Lexend', data: dataUrlBytes(lexendBold), weight: 700, style: 'normal' }
		]
	}).asPng();
	return png.image;
}
