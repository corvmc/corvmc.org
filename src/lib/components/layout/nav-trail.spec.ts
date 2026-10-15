import { describe, expect, it } from 'vitest';
import type { ResolvedPathname } from '$app/types';
import { navTrail, type NavTrailGroup } from './nav-trail';

const p = (s: string) => s as ResolvedPathname;

const GROUPS: NavTrailGroup[] = [
	{ items: [{ key: 'dashboard', label: 'Dashboard', href: p('/staff'), exact: true }] },
	{
		title: 'People',
		items: [
			{ key: 'users', label: 'Users', href: p('/staff/users') },
			{
				key: 'volunteer',
				label: 'Volunteering',
				href: p('/staff/volunteer'),
				children: [
					{ key: 'schedule', label: 'Schedule', href: p('/staff/volunteer/schedule') }
				] as NavTrailGroup['items']
			}
		]
	},
	{
		title: 'Space',
		items: [
			{
				key: 'reservations',
				label: 'Reservations',
				href: p('/staff/reservations'),
				also: [p('/staff/recurring')]
			}
		]
	}
];

describe('navTrail', () => {
	it('names the row itself, unlinked, on the row page', () => {
		expect(navTrail(GROUPS, '/staff/users')).toEqual({
			crumbs: [{ label: 'People' }, { label: 'Users' }],
			here: true
		});
	});

	it('links the row on a page beneath it', () => {
		expect(navTrail(GROUPS, '/staff/users/abc')).toEqual({
			crumbs: [{ label: 'People' }, { label: 'Users', href: '/staff/users' }],
			here: false
		});
	});

	it('walks a child row through its parent', () => {
		expect(navTrail(GROUPS, '/staff/volunteer/schedule/').crumbs).toEqual([
			{ label: 'People' },
			{ label: 'Volunteering', href: '/staff/volunteer' },
			{ label: 'Schedule' }
		]);
	});

	it('follows a row that claims another prefix', () => {
		expect(navTrail(GROUPS, '/staff/recurring/s1')).toEqual({
			crumbs: [{ label: 'Space' }, { label: 'Reservations', href: '/staff/reservations' }],
			here: false
		});
	});

	it('is empty for a URL no row claims', () => {
		expect(navTrail(GROUPS, '/staff-ish')).toEqual({ crumbs: [], here: false });
		expect(navTrail(GROUPS, '/staff/elsewhere')).toEqual({ crumbs: [], here: false });
	});
});
