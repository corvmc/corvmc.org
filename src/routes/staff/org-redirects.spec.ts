import { describe, it, expect } from 'vitest';
import { load as contractors } from './contractors/+page';
import { load as contractor } from './contractors/[id]/+page';
import { load as funders } from './grants/funders/+page';
import { load as sponsor } from './sponsors/[id]/+page';

/** The organization lists and pages folded into Contacts (#2764); old links land there. */
// The build wraps each load for Sentry, which reads the URL and route.
const at = (path: string, params: Record<string, string> = {}) =>
	({ url: new URL(`https://corvmc.test${path}`), params, route: { id: path } }) as never;

const cases: [string, () => unknown, string][] = [
	['contractors', () => contractors(at('/staff/contractors')), '/staff/contacts?role=contractor'],
	['funders', () => funders(at('/staff/grants/funders')), '/staff/contacts?role=funder'],
	[
		'a contractor',
		() => contractor(at('/staff/contractors/o1', { id: 'o1' })),
		'/staff/contacts/o1'
	],
	[
		'a sponsor',
		() => sponsor(at('/staff/sponsors/o1', { id: 'o1' })),
		'/staff/contacts/o1#sponsorships'
	]
];

describe('old organization URLs', () => {
	it.each(cases)('send %s to Contacts', async (_name, load, location) => {
		let thrown: unknown;
		try {
			await load();
		} catch (err) {
			thrown = err;
		}
		expect(thrown).toMatchObject({ status: 308, location });
	});
});
