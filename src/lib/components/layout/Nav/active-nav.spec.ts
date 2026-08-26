import { describe, expect, it } from 'vitest';
import { activeNavKey, childHrefsFor, flattenNav, type NavNode } from './active-nav';

/**
 * The rule every panel's sidebar now shares. It replaced `NavItem`'s exact
 * pathname match, which lit no row at all on any detail page in the app.
 */

const ITEMS: NavNode[] = [
	{ key: 'dashboard', href: '/member' },
	{
		key: 'events',
		href: '/member/events',
		children: [{ key: 'submit', href: '/member/events/submit' }]
	},
	{ key: 'reservations', href: '/member/reservations' },
	{ key: 'live-site', href: '' }
];

describe('activeNavKey', () => {
	it('matches a row exactly', () => {
		expect(activeNavKey(ITEMS, '/member/reservations')).toBe('reservations');
	});

	it('carries a detail page up to its section', () => {
		expect(activeNavKey(ITEMS, '/member/reservations/abc/pay')).toBe('reservations');
	});

	it('prefers the deepest matching row over its parent', () => {
		expect(activeNavKey(ITEMS, '/member/events/submit')).toBe('submit');
		expect(activeNavKey(ITEMS, '/member/events/abc')).toBe('events');
	});

	it('lets the panel root win only when nothing longer matches', () => {
		expect(activeNavKey(ITEMS, '/member')).toBe('dashboard');
	});

	it('requires a segment boundary, not a bare prefix', () => {
		// A bare `startsWith` would hand this to Events.
		expect(activeNavKey(ITEMS, '/member/eventsomething')).toBe('dashboard');
	});

	it('tolerates a trailing slash', () => {
		expect(activeNavKey(ITEMS, '/member/reservations/')).toBe('reservations');
	});

	it('never picks a row whose href leaves the origin', () => {
		// A band's "View Live Site" is filled in by the layout and empty here; an
		// empty href is a prefix of every path, so it would otherwise always win.
		expect(activeNavKey(ITEMS, '/member/events')).toBe('events');
		expect(activeNavKey(ITEMS, '/anything')).toBeNull();
	});

	it('returns null outside the panel', () => {
		expect(activeNavKey(ITEMS, '/staff/users')).toBeNull();
	});

	it('ignores declaration order', () => {
		const shuffled = [...ITEMS].reverse();
		expect(activeNavKey(shuffled, '/member/events/submit')).toBe('submit');
	});
});

describe('flattenNav and childHrefsFor', () => {
	it('flattens parents and children in render order', () => {
		expect(flattenNav(ITEMS).map((i) => i.key)).toEqual([
			'dashboard',
			'events',
			'submit',
			'reservations',
			'live-site'
		]);
	});

	it('keeps the parent in its own childHrefs, so its own page holds it open', () => {
		expect(childHrefsFor(ITEMS[1])).toEqual(['/member/events', '/member/events/submit']);
	});

	it('gives a childless row just its own href', () => {
		expect(childHrefsFor(ITEMS[2])).toEqual(['/member/reservations']);
	});
});
