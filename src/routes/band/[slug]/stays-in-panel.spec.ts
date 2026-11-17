import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A band reservation's Pay linked to the member panel's pay page, so paying moved the member
 * out of the band panel (#3131). Every band-panel file, and the band's reservation card, must
 * link to the band's own reservation pages instead.
 */
const BAND_DIR = join(import.meta.dirname);
const SHARED = [
	join(import.meta.dirname, '../../../lib/components/reservations/BandReservationCard.svelte')
];

const files = [
	...readdirSync(BAND_DIR, { recursive: true, encoding: 'utf8' })
		.filter((f) => /\.(svelte|ts)$/.test(f) && !/\.spec\.ts$/.test(f))
		.map((f) => join(BAND_DIR, f)),
	...SHARED
];

describe('band panel reservation links', () => {
	it('finds band panel files to check', () => {
		expect(files.length).toBeGreaterThan(20);
	});

	it('never send a member to the member panel for a band reservation', () => {
		const hits = files.filter((f) =>
			/\/member\/reservations\b|'member\/reservations/.test(readFileSync(f, 'utf8'))
		);
		expect(hits).toEqual([]);
	});
});
