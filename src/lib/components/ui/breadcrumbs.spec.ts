import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import type { ResolvedPathname } from '$app/types';
import Breadcrumbs from './Breadcrumbs.svelte';
import PageHeader from './PageHeader.svelte';
import { pageCrumbs, type NavTrail } from './breadcrumbs';

const p = (s: string) => s as ResolvedPathname;
const users: NavTrail = {
	crumbs: [{ label: 'People' }, { label: 'Users', href: p('/staff/users') }],
	here: false
};

describe('pageCrumbs', () => {
	it('appends the leaf to the nav trail', () => {
		expect(pageCrumbs(users, [], 'Jordan')).toEqual([...users.crumbs, { label: 'Jordan' }]);
	});

	it('appends nothing when the page is the nav row', () => {
		const here: NavTrail = { crumbs: [{ label: 'Users' }], here: true };
		expect(
			pageCrumbs({ ...here, crumbs: [{ label: 'X', href: p('/x') }, ...here.crumbs] }, [], 'Users')
		).toEqual([{ label: 'X', href: '/x' }, { label: 'Users' }]);
	});

	it('puts explicit parents between the trail and the leaf, minus any the nav shows', () => {
		const parents = [
			{ label: 'Users', href: p('/staff/users') },
			{ label: 'Jordan', href: p('/staff/users/j') }
		];
		expect(pageCrumbs(users, parents, 'Edit').map((c) => c.label)).toEqual([
			'People',
			'Users',
			'Jordan',
			'Edit'
		]);
	});

	it('works with no panel at all, from parents alone', () => {
		expect(pageCrumbs(undefined, [{ label: 'Events', href: p('/events') }], 'Show')).toEqual([
			{ label: 'Events', href: '/events' },
			{ label: 'Show' }
		]);
	});

	it('renders nothing when no crumb links anywhere', () => {
		expect(pageCrumbs(undefined, [], 'Title')).toEqual([]);
		expect(
			pageCrumbs({ crumbs: [{ label: 'People' }, { label: 'Users' }], here: true }, [], 'Users')
		).toEqual([]);
	});
});

describe('Breadcrumbs', () => {
	it('links every crumb but the last, which is the current page', async () => {
		const { body } = await render(Breadcrumbs, {
			props: { crumbs: [{ label: 'Users', href: p('/staff/users') }, { label: 'Jordan' }] }
		});
		expect(body).toContain('<a href="/staff/users">Users</a>');
		expect(body).toMatch(/aria-current="page"[^>]*>Jordan</);
		expect(body).not.toContain('…');
	});

	it('collapses to an ellipsis, parent and leaf at phone width', async () => {
		const { body } = await render(Breadcrumbs, {
			props: {
				crumbs: [
					{ label: 'Space' },
					{ label: 'Reservations', href: p('/staff/reservations') },
					{ label: 'Recurring', href: p('/staff/reservations?recurring') },
					{ label: 'Weekly' }
				]
			}
		});
		expect(body).toContain('…');
		expect(body.match(/max-sm:hidden/g)).toHaveLength(2);
	});

	it('renders nothing for an empty trail', async () => {
		const { body } = await render(Breadcrumbs, { props: { crumbs: [] } });
		expect(body).not.toContain('<nav');
	});
});

describe('PageHeader trail', () => {
	it('renders a parent trail outside any panel', async () => {
		const { body } = await render(PageHeader, {
			props: { title: 'Show', parent: { label: 'Events', href: p('/events') } }
		});
		expect(body).toContain('aria-label="Breadcrumb"');
		expect(body).toContain('<a href="/events">Events</a>');
	});

	it('renders no trail for a bare title', async () => {
		const { body } = await render(PageHeader, { props: { title: 'Show' } });
		expect(body).not.toContain('aria-label="Breadcrumb"');
	});
});
