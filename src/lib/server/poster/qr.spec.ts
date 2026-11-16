import { describe, it, expect } from 'vitest';
import { encode } from 'uqr';
import { LOGO_SHARE, logoSquare, posterQr } from './qr';

/** The logo clears only the centre; every other module, finders included, is drawn. */

const URL = 'https://corvmc.org/events/6e2143dd-5ed5-40c4-ab7b-b9174d803e04';

/** The dark modules the SVG draws, as "x,y" without the quiet zone. */
function drawn(svg: string, border: number) {
	const d = svg.match(/<path fill="[^"]+" shape-rendering="crispEdges" d="([^"]*)"/)![1];
	return new Set(
		[...d.matchAll(/M(\d+),(\d+)/g)].map((m) => `${+m[1] - border},${+m[2] - border}`)
	);
}

describe('logoSquare', () => {
	it.each([21, 25, 45, 57])('centres a square of at most the share on a %i-module code', (n) => {
		const { start, width } = logoSquare(n);
		expect(width).toBeLessThanOrEqual(n * LOGO_SHARE);
		expect(start * 2 + width).toBe(n);
	});
});

describe('posterQr', () => {
	it.each([1, 2])('draws every module outside the centre square (border %i)', (border) => {
		const { data, size } = encode(URL, { ecc: 'H', border: 0 });
		const { start, width } = logoSquare(size);
		const shown = drawn(posterQr(URL, border), border);
		for (let y = 0; y < size; y++) {
			for (let x = 0; x < size; x++) {
				const centre = x >= start && x < start + width && y >= start && y < start + width;
				expect(shown.has(`${x},${y}`), `${x},${y}`).toBe(data[y][x] && !centre);
			}
		}
	});

	it('places the speaker mark inside the cleared square', () => {
		const { size } = encode(URL, { ecc: 'H', border: 0 });
		const { start, width } = logoSquare(size);
		const svg = posterQr(URL, 1);
		const [, x, y, w, h] = svg
			.match(/<svg x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/)!
			.map(Number);
		expect(x).toBeGreaterThanOrEqual(start + 1);
		expect(y).toBeGreaterThanOrEqual(start + 1);
		expect(x + w).toBeLessThanOrEqual(start + 1 + width);
		expect(y + h).toBeLessThanOrEqual(start + 1 + width);
	});
});
