import { describe, it, expect } from 'vitest';
import { load as events } from './+page';
import { load as taskProductions } from '../tasks/productions/+page';
import { load as venues } from '../venues/+page';
import { load as production } from './[id]/production/+page';
import { load as vendors } from './[id]/vendors/+page';
import { eventView, eventViewPath } from './views';

/**
 * Venues is a Calendar view (#2766); Productions is its own list (#3112). Old
 * links land on each. `/staff/productions` once 308'd to the Events view, so a
 * redirect into it carries `via`.
 */
// The build wraps each load for Sentry, which reads the URL and route.
const at = (path: string, params: Record<string, string> = {}) =>
	({ url: new URL(`https://corvmc.test${path}`), params, route: { id: path } }) as never;

describe('old event URLs', () => {
	it.each([
		[
			'/staff/events?view=productions&status=draft&production=offered&needs=1',
			events,
			'/staff/productions?status=offered&needs=1&via=%2Fstaff%2Fevents'
		],
		[
			'/staff/tasks/productions?venue=v1',
			taskProductions,
			'/staff/productions?via=%2Fstaff%2Ftasks%2Fproductions'
		],
		['/staff/venues?archived=1', venues, '/staff/events?view=venues&archived=1'],
		// The console and the vendors page are tabs of the event page (#3270).
		['/staff/events/e1/production?tab=advance', production, '/staff/events/e1?tab=production'],
		['/staff/events/e1/vendors', vendors, '/staff/events/e1?tab=vendors']
	])('308s %s', async (path, load, location) => {
		let thrown: unknown;
		try {
			await (load as (e: never) => unknown)(at(path, { id: 'e1' }));
		} catch (err) {
			thrown = err;
		}
		expect(thrown).toMatchObject({ status: 308, location });
	});

	it('leaves every other Calendar view where it is', async () => {
		await expect(
			(async () => (events as (e: never) => unknown)(at('/staff/events?view=venues')))()
		).resolves.toBeUndefined();
	});
});

describe('eventView', () => {
	it.each([
		['', 'listings'],
		['view=vendors', 'vendors'],
		['view=listings', 'listings'],
		['view=nope', 'listings']
	])('reads %j as %s', (query, view) => {
		expect(eventView(new URLSearchParams(query))).toBe(view);
	});

	it('round-trips through the path', () => {
		expect(eventViewPath('listings')).toBe('/staff/events');
		expect(eventView(new URL(`http://x${eventViewPath('venues', '?a=1')}`).searchParams)).toBe(
			'venues'
		);
	});
});
