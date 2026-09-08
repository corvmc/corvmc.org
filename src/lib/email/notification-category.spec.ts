import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { BRAND } from './brand';
import { NOTIFICATION_CATEGORIES, CATEGORY_BAR_STROKE } from './notification-category';
import { NOTIFICATION_TYPES } from '$lib/server/db/schema/notification';

// ---------------------------------------------------------------------------
// Category bar
// ---------------------------------------------------------------------------
// The bar carries meaning by colour, so what has to hold is measurable: the
// bar is findable on both surfaces, the five fills are different colours, and
// the dark half exists at all. #642 was filed on numbers nobody had measured,
// so these are computed rather than asserted from a table.
// ---------------------------------------------------------------------------

const LAYOUT = readFileSync(
	'postmark/templates/_layouts/corvmc-transactional/content.html',
	'utf8'
);
const TEMPLATE = readFileSync('postmark/templates/notification/content.html', 'utf8');

const SURFACE = { light: BRAND.cream, dark: BRAND.dark.surface };

const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function luminance(hex: string): number {
	const [r, g, b] = channels(hex).map(linear);
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 1.4.11 contrast ratio. */
export function contrast(a: string, b: string): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}

/** CIE76 in Lab. Coarser than CIEDE2000 and enough to say "a different colour". */
function lab(hex: string): [number, number, number] {
	const [r, g, b] = channels(hex).map(linear);
	const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
	const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
	const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
	const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29);
	return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

function distance(a: string, b: string): number {
	const [l1, a1, b1] = lab(a);
	const [l2, a2, b2] = lab(b);
	return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

const ENTRIES = Object.entries(NOTIFICATION_CATEGORIES);

describe('notification categories', () => {
	it('gives every registered type a category that exists', () => {
		const unknown = NOTIFICATION_TYPES.filter((t) => !NOTIFICATION_CATEGORIES[t.category]).map(
			(t) => t.key
		);

		expect(unknown).toEqual([]);
	});

	it('leaves no category without types, so none is decoration', () => {
		const used = new Set(NOTIFICATION_TYPES.map((t) => t.category));
		const empty = ENTRIES.map(([key]) => key).filter((key) => !used.has(key as never));

		expect(empty).toEqual([]);
	});

	it('stays at five, the number this palette can colour apart', () => {
		expect(ENTRIES).toHaveLength(5);
	});

	it('draws only brand colours', () => {
		const palette = new Set<string>([
			...Object.values(BRAND).flatMap((v) => (typeof v === 'string' ? [v] : Object.values(v)))
		]);
		const strays = ENTRIES.flatMap(([, c]) => [c.light, c.dark]).filter((hex) => !palette.has(hex));

		expect(strays).toEqual([]);
	});

	it('finds the bar on both surfaces by its stroke, which the fills cannot do alone', () => {
		// The point of the stroke. Three of the ten fill/surface pairs are under
		// 3:1 — goldenrod is 1.72:1 on cream — so it is the boundary that has to
		// clear the floor, not the fill.
		expect(contrast(CATEGORY_BAR_STROKE.light, SURFACE.light)).toBeGreaterThanOrEqual(3);
		expect(contrast(CATEGORY_BAR_STROKE.dark, SURFACE.dark)).toBeGreaterThanOrEqual(3);
	});

	it.each(ENTRIES)('%s reads as a different colour from every other', (key) => {
		const mine = NOTIFICATION_CATEGORIES[key as never] as (typeof ENTRIES)[number][1];
		const nearest = ENTRIES.filter(([other]) => other !== key).map(([, c]) => ({
			light: distance(mine.light, c.light),
			dark: distance(mine.dark, c.dark)
		}));

		// 10 in Lab is several times the just-noticeable difference. The tightest
		// pair here is the two oranges — shows against membership — which is the
		// cost the palette imposes, and why the preheader also says the category.
		expect(Math.min(...nearest.map((n) => n.light))).toBeGreaterThan(10);
		expect(Math.min(...nearest.map((n) => n.dark))).toBeGreaterThan(10);
	});

	it.each(ENTRIES)('%s has a dark-mode rule the layout will actually apply', (key, category) => {
		// A fill class added to the template and not to the layout's dark block is
		// silent: the bar just keeps its light colour on a dark surface.
		expect(TEMPLATE).toContain('{{category_class}}');
		expect(LAYOUT).toContain(`.${category.className} { background-color:${category.dark}`);
	});

	it('swaps the stroke in dark mode too', () => {
		expect(LAYOUT).toContain(`.kicker-bar { border-color:${CATEGORY_BAR_STROKE.dark}`);
	});
});
