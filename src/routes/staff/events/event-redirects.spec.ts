import { describe, it, expect } from 'vitest';
import { load as productions } from '../productions/+page';
import { load as taskProductions } from '../tasks/productions/+page';
import { load as venues } from '../venues/+page';
import { eventView, eventViewPath } from './views';

/** Productions and Venues are views on Events (#2766); old links land on them. */
// The build wraps each load for Sentry, which reads the URL and route.
const at = (path: string) =>
	({ url: new URL(`https://corvmc.test${path}`), params: {}, route: { id: path } }) as never;

describe('old event URLs', () => {
	it.each([
		[
			'/staff/productions?status=draft&needs=1',
			productions,
			'/staff/events?view=productions&status=draft&needs=1'
		],
		[
			'/staff/tasks/productions?venue=v1',
			taskProductions,
			'/staff/events?view=productions&venue=v1'
		],
		['/staff/tasks/productions', taskProductions, '/staff/events?view=productions'],
		['/staff/venues?archived=1', venues, '/staff/events?view=venues&archived=1']
	])('308s %s', async (path, load, location) => {
		let thrown: unknown;
		try {
			await (load as (e: never) => unknown)(at(path));
		} catch (err) {
			thrown = err;
		}
		expect(thrown).toMatchObject({ status: 308, location });
	});
});

describe('eventView', () => {
	it.each([
		['', 'listings'],
		['view=productions', 'productions'],
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
