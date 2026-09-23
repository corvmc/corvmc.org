import { describe, it, expect } from 'vitest';
import { flyerLines, renderFlyer, FLYER_WIDTH, FLYER_HEIGHT } from './flyer';

/**
 * The details a flyer carries, and that it rasterizes. Vitest resolves the
 * library's `node` export, workerd its `workerd` one; both run the same satori
 * and resvg, so a PNG here is a PNG there.
 */

const SHOW = {
	title: 'Harvest Show',
	// Friday 2026-10-02, 8 PM Pacific.
	startsAt: new Date('2026-10-03T03:00:00Z'),
	doorsAt: new Date('2026-10-03T02:00:00Z'),
	venue: 'Corvallis Music Collective, 6775 SW Philomath Blvd',
	bill: ['The Wrens', 'Openers'],
	ticketingEnabled: true,
	ticketPrice: 1000,
	ticketPriceFloorCents: 0,
	externalTicketUrl: null
};

function pngSize(buf: Uint8Array) {
	const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
	// Signature, then the IHDR chunk: width and height at bytes 16 and 20.
	expect(view.getUint32(0)).toBe(0x89504e47);
	return { width: view.getUint32(16), height: view.getUint32(20) };
}

describe('flyerLines', () => {
	it('puts date and time on one line, piped, in club time', () => {
		expect(flyerLines(SHOW).when).toBe('FRIDAY, OCTOBER 2 | 8 PM');
	});

	it('gives doors when the show has them', () => {
		expect(flyerLines(SHOW).doors).toBe('DOORS 7 PM');
		expect(flyerLines({ ...SHOW, doorsAt: null }).doors).toBeNull();
	});

	it('says a sliding scale that opens at nothing is NOTAFLOF', () => {
		expect(flyerLines(SHOW).price).toBe('$10 suggested | NOTAFLOF');
	});

	it('states a fixed price plainly', () => {
		expect(flyerLines({ ...SHOW, ticketPriceFloorCents: 1000 }).price).toBe('$10');
	});

	it('says free when nobody is selling and there is no price', () => {
		expect(flyerLines({ ...SHOW, ticketingEnabled: false, ticketPrice: null }).price).toBe('Free');
	});

	it('keeps the bill in billing order', () => {
		expect(flyerLines(SHOW).bill).toEqual(['The Wrens', 'Openers']);
	});
});

describe('renderFlyer', () => {
	it('renders the template as a portrait PNG', async () => {
		const png = await renderFlyer(flyerLines(SHOW));
		expect(pngSize(png)).toEqual({ width: FLYER_WIDTH, height: FLYER_HEIGHT });
	});

	it('renders art above the details footer at the same size', async () => {
		// A 1x1 PNG is enough to prove the art path lays out and rasterizes.
		const pixel = Uint8Array.from(
			atob(
				'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
			),
			(c) => c.charCodeAt(0)
		);
		const png = await renderFlyer(flyerLines(SHOW), { bytes: pixel, contentType: 'image/png' });
		expect(pngSize(png)).toEqual({ width: FLYER_WIDTH, height: FLYER_HEIGHT });
	});
});
