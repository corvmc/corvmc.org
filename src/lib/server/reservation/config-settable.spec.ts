import { describe, expect, it, vi } from 'vitest';
import { readFileSync, globSync } from 'node:fs';

vi.mock('#lib/server/site-config/site-config-service.js', () => ({
	getConfigsByPrefix: async () => ({})
}));

const { getReservationConfig } = await import('./config');

/**
 * Every key `getReservationConfig()` reads is written by some remote form, by
 * its literal `'reservation.<key>'`. A key nothing writes can be changed only
 * in `site_config` by hand: the four teaching terms were (#2807).
 * `src/form-coverage.spec.ts` then holds the form's field to a rendered control.
 */
describe('reservation config', () => {
	it('has a remote that writes each key', async () => {
		const remotes = globSync('src/lib/remote/*.remote.ts')
			.map((f) => readFileSync(f, 'utf8'))
			.join('\n');
		const keys = Object.keys(await getReservationConfig());

		const unwritten = keys.filter((key) => !remotes.includes(`'reservation.${key}'`));

		expect(unwritten).toEqual([]);
	});
});
