import { DEFAULT_TIMEZONE } from '#lib/config.js';
import { C, el, mascot, renderPng, sponsorRow, stripe, type Node, type SponsorLogo } from './brand';
import { clock } from './flyer';
import type { CalendarBlock, CalendarEvent } from './calendar-service';

/** A month of listings on one poster, at the flyer's size and in its brand. */

export const CALENDAR_WIDTH = 1080;
export const CALENDAR_HEIGHT = 1350;

// The listing area: the page less stripes, padding, the month heading and the footer.
const BODY_HEIGHT = 820;
const BODY_WIDTH = CALENDAR_WIDTH - 2 * 56;
const COLUMN_GAP = 40;
const MAX_LOGOS = 5;

const BLOCK_STYLE: Record<CalendarBlock, { label: string; noun: string; color: string }> = {
	cmc: { label: 'CMC EVENTS', noun: 'CMC events', color: C.teal },
	sustaining: {
		label: 'SUSTAINING MEMBER EVENTS',
		noun: 'sustaining member events',
		color: C.orange
	},
	member: { label: 'MEMBER EVENTS', noun: 'member events', color: C.redOrange }
};

export interface CalendarPoster {
	month: string;
	blocks: { block: CalendarBlock; events: CalendarEvent[] }[];
	sponsors: SponsorLogo[];
}

type Line =
	| { kind: 'head'; block: CalendarBlock }
	| { kind: 'row'; event: CalendarEvent }
	| { kind: 'more'; block: CalendarBlock; count: number };

// Tried in order; the first that holds every listing wins.
const LAYOUTS = [
	{ columns: 1, size: 34 },
	{ columns: 1, size: 28 },
	{ columns: 1, size: 24 },
	{ columns: 2, size: 24 },
	{ columns: 2, size: 20 },
	{ columns: 2, size: 17 }
];

const lineHeight = (line: Line, size: number) =>
	line.kind === 'head' ? Math.round(size * 1.9) : Math.round(size * 1.45);

function linesOf(blocks: CalendarPoster['blocks']): Line[] {
	return blocks
		.filter((b) => b.events.length > 0)
		.flatMap((b) => [
			{ kind: 'head', block: b.block } as Line,
			...b.events.map((event) => ({ kind: 'row', event }) as Line)
		]);
}

/** Split lines into columns of at most `BODY_HEIGHT`, or null when they overflow. */
function flow(lines: Line[], columns: number, size: number): Line[][] | null {
	const out: Line[][] = [[]];
	let used = 0;
	for (const line of lines) {
		const h = lineHeight(line, size);
		if (used + h > BODY_HEIGHT) {
			if (out.length === columns) return null;
			out.push([]);
			used = 0;
		}
		out[out.length - 1].push(line);
		used += h;
	}
	return out;
}

/**
 * The densest layout, with the last block's latest rows replaced by a "+N more"
 * line until it fits. Only reached when two columns at the smallest size fail.
 */
function truncated(blocks: CalendarPoster['blocks'], columns: number, size: number) {
	const shown = blocks.filter((b) => b.events.length > 0);
	const last = shown[shown.length - 1];
	for (let keep = last.events.length - 1; keep >= 0; keep--) {
		const lines = [
			...linesOf([...shown.slice(0, -1), { ...last, events: last.events.slice(0, keep) }]),
			{ kind: 'more', block: last.block, count: last.events.length - keep } as Line
		];
		const fit = flow(lines, columns, size);
		if (fit) return fit;
	}
	return flow(linesOf(shown.slice(0, -1)), columns, size) ?? [[]];
}

/** The columns and type size the poster prints at. */
export function layOut(blocks: CalendarPoster['blocks']) {
	const lines = linesOf(blocks);
	for (const { columns, size } of LAYOUTS) {
		const fit = flow(lines, columns, size);
		if (fit) return { columns: fit, size };
	}
	const { columns, size } = LAYOUTS[LAYOUTS.length - 1];
	return { columns: truncated(blocks, columns, size), size };
}

function dayLabel(d: Date): string {
	return new Intl.DateTimeFormat('en-US', {
		timeZone: DEFAULT_TIMEZONE,
		weekday: 'short',
		day: 'numeric'
	})
		.format(d)
		.toUpperCase();
}

function lineNode(line: Line, size: number): Node {
	const height = lineHeight(line, size);
	if (line.kind === 'head') {
		const s = BLOCK_STYLE[line.block];
		return el(
			'div',
			{
				display: 'flex',
				alignItems: 'flex-end',
				height,
				paddingBottom: Math.round(size * 0.25),
				color: s.color,
				fontSize: Math.round(size * 0.85),
				fontWeight: 700,
				letterSpacing: 4,
				borderBottom: `3px solid ${s.color}`
			},
			s.label
		);
	}
	if (line.kind === 'more') {
		return el(
			'div',
			{ display: 'flex', alignItems: 'center', height, color: C.brown, fontSize: size },
			`+${line.count} more ${BLOCK_STYLE[line.block].noun}`
		);
	}
	return el('div', { display: 'flex', alignItems: 'center', height, fontSize: size }, [
		el(
			'div',
			{ width: Math.round(size * 3.6), flexShrink: 0, color: C.navy, fontWeight: 700 },
			dayLabel(line.event.startsAt)
		),
		el(
			'div',
			{ width: Math.round(size * 4.4), flexShrink: 0, color: C.orange },
			clock(line.event.startsAt)
		),
		el(
			'div',
			{
				flexGrow: 1,
				flexShrink: 1,
				color: C.navy,
				overflow: 'hidden',
				whiteSpace: 'nowrap',
				textOverflow: 'ellipsis'
			},
			line.event.title
		)
	]);
}

function monthLabel(month: string): string {
	const [y, m] = month.split('-').map(Number);
	return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
		.format(new Date(Date.UTC(y, m - 1, 15)))
		.toUpperCase();
}

function footer(sponsors: SponsorLogo[]): Node {
	const shown = sponsors.slice(0, MAX_LOGOS);
	const extra = sponsors.length - shown.length;
	return el(
		'div',
		{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', height: 120 },
		[
			el('div', { display: 'flex', flexDirection: 'column', gap: 8 }, [
				sponsorRow(shown, 60) ?? el('div', { color: C.teal, fontSize: 26 }, 'corvmc.org'),
				extra > 0 ? el('div', { color: C.brown, fontSize: 20 }, `+${extra} more sponsors`) : null
			]),
			mascot(200)
		].filter(Boolean)
	);
}

function tree(poster: CalendarPoster): Node {
	const { columns, size } = layOut(poster.blocks);
	const width =
		columns.length === 1 ? BODY_WIDTH : Math.floor((BODY_WIDTH - COLUMN_GAP) / columns.length);
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
				{ display: 'flex', flexDirection: 'column', flexGrow: 1, padding: '40px 56px 32px' },
				[
					el(
						'div',
						{ color: C.teal, fontSize: 28, letterSpacing: 6, fontWeight: 700 },
						'CORVALLIS MUSIC COLLECTIVE'
					),
					el(
						'div',
						{ color: C.navy, fontSize: 96, fontWeight: 700, lineHeight: 1.1, marginBottom: 12 },
						monthLabel(poster.month)
					),
					el(
						'div',
						{ display: 'flex', gap: COLUMN_GAP, height: BODY_HEIGHT },
						columns.map((col) =>
							el(
								'div',
								{ display: 'flex', flexDirection: 'column', width },
								col.map((line) => lineNode(line, size))
							)
						)
					),
					el('div', { flexGrow: 1 }),
					footer(poster.sponsors)
				]
			),
			stripe(22)
		]
	);
}

/** Rasterize a month's calendar poster to PNG. */
export function renderCalendar(poster: CalendarPoster): Promise<Uint8Array> {
	return renderPng(tree(poster), CALENDAR_WIDTH, CALENDAR_HEIGHT);
}
