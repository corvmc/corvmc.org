import { describe, it, expect } from 'vitest';
import { load as keys } from '../keys/+page';
import { load as buildingAccess } from '../building-access/+page';
import { load as reservations } from './+page';

/** Practice space's old modal links, Key holders and Building access land on its views (#2766, #3102). */
// The build wraps each load for Sentry, which reads the URL and route.
const at = (path: string) =>
	({ url: new URL(`https://corvmc.test${path}`), params: {}, route: { id: path } }) as never;

async function thrown(load: (e: never) => unknown, path: string) {
	try {
		await load(at(path));
	} catch (err) {
		return err;
	}
	return undefined;
}

describe('old Practice space links', () => {
	it.each([
		[keys, '/staff/keys', '/staff/reservations/settings/building-access'],
		[buildingAccess, '/staff/building-access', '/staff/reservations/settings/building-access'],
		[
			buildingAccess,
			'/staff/building-access?utec=denied',
			'/staff/reservations/settings/building-access?utec=denied'
		],
		[reservations, '/staff/reservations?access', '/staff/reservations/settings/building-access'],
		[
			reservations,
			'/staff/reservations?utec=connected',
			'/staff/reservations/settings/building-access?utec=connected'
		],
		[reservations, '/staff/reservations?recurring', '/staff/recurring?via=reservations']
	])('308 %#', async (load, path, location) => {
		expect(await thrown(load as (e: never) => unknown, path)).toMatchObject({
			status: 308,
			location
		});
	});

	it('leaves the list and its filters alone', async () => {
		expect(
			await thrown(reservations as (e: never) => unknown, '/staff/reservations?booker=closure')
		).toBeUndefined();
	});
});
