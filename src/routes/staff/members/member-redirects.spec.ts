import { describe, it, expect } from 'vitest';
import { load as volunteers } from './volunteers/+page';
import { load as hours } from './volunteers/hours/+page';
import { load as teachers } from './instructors/+page';
import { load as invites } from './invites/+page';
import { load as instructors } from '../instructors/+page';
import { load as people } from '../volunteer/people/+page';
import { load as oldHours } from '../volunteer/hours/+page';
import { load as clearances } from '../volunteer/clearances/+page';
import { memberView } from './views';

/** The Members views folded into one list's filters (#2765); old links land there. */
// The build wraps each load for Sentry, which reads the URL and route.
const at = (path: string) =>
	({ url: new URL(`https://corvmc.test${path}`), params: {}, route: { id: path } }) as never;

const cases: [string, () => unknown, string][] = [
	[
		'volunteers, renaming the interest filter',
		() => volunteers(at('/staff/members/volunteers?role=r1&status=blocked')),
		'/staff/members?role=volunteer&interest=r1&status=blocked'
	],
	[
		'teachers',
		() => teachers(at('/staff/members/instructors?status=requested')),
		'/staff/members?role=teacher&status=requested'
	],
	['invites', () => invites(at('/staff/members/invites')), '/staff/members?status=invited'],
	[
		'the hour logs',
		() => hours(at('/staff/members/volunteers/hours?status=all')),
		'/staff/volunteering/hours?status=all'
	],
	[
		'/staff/instructors',
		() => instructors(at('/staff/instructors')),
		'/staff/members?role=teacher'
	],
	[
		'the sign-off tab',
		() => people(at('/staff/volunteer/people?tab=signoff&q=a')),
		'/staff/members?role=volunteer&q=a&status=blocked'
	],
	[
		'/staff/volunteer/hours',
		() => oldHours(at('/staff/volunteer/hours')),
		'/staff/volunteering/hours'
	],
	['clearances', () => clearances(), '/staff/members?role=volunteer']
];

describe('old Members URLs', () => {
	it.each(cases)('send %s to the list', async (_name, load, location) => {
		let thrown: unknown;
		try {
			await load();
		} catch (err) {
			thrown = err;
		}
		expect(thrown).toMatchObject({ status: 308, location });
		// Lands on a view the list renders, not the unfiltered fallback.
		const target = new URL(location, 'https://corvmc.test');
		if (target.pathname === '/staff/members')
			expect(memberView(target.searchParams)).not.toBe('all');
	});
});
