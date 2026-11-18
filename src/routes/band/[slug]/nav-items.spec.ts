import { describe, it, expect } from 'vitest';
import {
	activeBandNavKey,
	bandNavFooter,
	bandNavItems,
	bandNavSections,
	bandNavTop,
	sectionHasKey,
	type BandNavInput
} from './nav-items';

/**
 * The band panel's nav gating has been wrong twice, both times because a role
 * check read `userRole === 'owner'` — `getBandLayout` returns `role ?? 'staff'`,
 * so admins and staff are the same shape as a real role. This pins the matrix.
 */
const base: BandNavInput = {
	slug: 'the-velvet-underground',
	bandId: 'band-1',
	tier: 'free',
	userRole: 'member',
	isStaff: false,
	features: {}
};

const roles = ['owner', 'admin', 'member', 'staff'] as const;
const asRole = (userRole: string, overrides: Partial<BandNavInput> = {}): BandNavInput => ({
	...base,
	userRole,
	isStaff: userRole === 'staff',
	...overrides
});

function keysFor(overrides: Partial<BandNavInput> = {}): string[] {
	return bandNavItems({ ...base, ...overrides }).map((i) => i.key);
}

describe('bandNavItems', () => {
	it('gives every role Dashboard, Members, Events and Messages', () => {
		for (const userRole of roles) {
			const keys = bandNavItems(asRole(userRole)).map((i) => i.key);
			expect(keys).toEqual(expect.arrayContaining(['dashboard', 'members', 'events', 'messages']));
		}
	});

	// The rider's premise is that the member who owns the amp says what it
	// needs, so a nav that hid it from plain members would defeat it.
	it('gives the tech rider and packing list to every role, including staff', () => {
		for (const userRole of roles) {
			const keys = bandNavItems(asRole(userRole)).map((i) => i.key);
			expect(keys).toEqual(expect.arrayContaining(['rider', 'packing']));
		}
	});

	it('gives Settings to an owner and an admin, but not a plain member', () => {
		expect(keysFor({ userRole: 'owner' })).toContain('settings');
		expect(keysFor({ userRole: 'admin' })).toContain('settings');
		expect(keysFor({ userRole: 'member' })).not.toContain('settings');
	});

	// The topbar icon's count spans every inbox the viewer reads, so only the
	// row can say this band has something waiting (#3136).
	it('badges the Messages row and no other', () => {
		const badged = bandNavItems(asRole('owner')).filter((i) => i.badgeKey);
		expect(badged.map((i) => [i.key, i.badgeKey])).toEqual([['messages', 'inboxUnread']]);
	});

	it('offers no View Live Site row, the editor carrying that link', () => {
		const items = bandNavItems(asRole('owner', { tier: 'premium', features: { bandAudio: true } }));
		expect(items.every((i) => i.href.startsWith('/'))).toBe(true);
	});

	it('sends a staff non-member to staff tools instead of Settings', () => {
		const keys = bandNavItems(asRole('staff')).map((i) => i.key);
		expect(keys).not.toContain('settings');
		expect(keys).toContain('staff-tools');
	});

	it('offers no staff-tools shortcut to an ordinary member', () => {
		expect(keysFor({ userRole: 'member' })).not.toContain('staff-tools');
	});

	it('shows Releases to every role once bandAudio is on, and to none while it is off', () => {
		for (const userRole of roles) {
			expect(
				bandNavItems(asRole(userRole, { features: { bandAudio: true } })).map((i) => i.key)
			).toContain('music');
			expect(bandNavItems(asRole(userRole)).map((i) => i.key)).not.toContain('music');
		}
	});

	it('keeps Payouts to owner and admin, while Releases stays open to members', () => {
		const on = { features: { bandAudio: true } };
		for (const userRole of ['owner', 'admin']) {
			expect(keysFor({ ...on, userRole })).toContain('payouts');
		}
		const member = keysFor({ ...on, userRole: 'member' });
		expect(member).toContain('music');
		expect(member).not.toContain('payouts');
	});

	it('does not let the premium tier stand in for bandAudio', () => {
		expect(keysFor({ userRole: 'owner', tier: 'premium' })).not.toContain('music');
	});

	it('keeps Subscription owner-only', () => {
		expect(keysFor({ userRole: 'owner' })).toContain('subscription');
		expect(keysFor({ userRole: 'admin' })).not.toContain('subscription');
		expect(keysFor({ userRole: 'member' })).not.toContain('subscription');
	});

	it('shows Reservations and Messages to every role', () => {
		for (const userRole of roles) {
			const keys = bandNavItems(asRole(userRole)).map((i) => i.key);
			expect(keys).toEqual(expect.arrayContaining(['reservations', 'messages']));
		}
	});

	it('shows the page editor only to an owner or admin of a premium band', () => {
		const on = { tier: 'premium' };
		expect(keysFor({ ...on, userRole: 'admin' })).toContain('page-editor');
		expect(keysFor({ ...on, userRole: 'owner' })).toContain('page-editor');
		expect(keysFor({ ...on, userRole: 'member' })).not.toContain('page-editor');
		expect(keysFor({ userRole: 'admin' })).not.toContain('page-editor');
	});

	// Every member reads the profile; the pages and write remotes gate editing.
	it('offers the profile and press kit to every member on every tier', () => {
		for (const tier of ['free', 'premium']) {
			for (const userRole of ['owner', 'admin', 'member']) {
				expect(keysFor({ tier, userRole })).toEqual(expect.arrayContaining(['edit', 'press-kit']));
			}
		}
	});

	it('withholds the profile and press kit from non-member staff', () => {
		const keys = bandNavItems(asRole('staff')).map((i) => i.key);
		expect(keys).not.toContain('edit');
		expect(keys).not.toContain('press-kit');
	});

	it('points Staff tools at the band id, not its slug', () => {
		const item = bandNavItems(asRole('staff')).find((i) => i.key === 'staff-tools');
		expect(item?.href).toBe('/staff/bands/band-1');
	});
});

// #3129: rows grouped by the question each answers, as the staff nav is.
describe('bandNavSections', () => {
	const full = asRole('owner', { tier: 'premium', features: { bandAudio: true } });

	it('groups an owner of a premium band into five sections', () => {
		const shape = bandNavSections(full).map((s) => [s.key, s.items.map((i) => i.key)]);
		expect(shape).toEqual([
			['schedule', ['reservations', 'events']],
			['band', ['members', 'messages']],
			['profile', ['edit', 'press-kit', 'page-editor']],
			['stage', ['rider', 'packing']],
			['music', ['music', 'payouts']]
		]);
	});

	it('drops a section the viewer can see no row of', () => {
		const keys = bandNavSections(asRole('staff')).map((s) => s.key);
		expect(keys).toEqual(['schedule', 'band', 'stage']);
	});

	// Rendered as separate lists, so a row in two would draw twice and a row in
	// none could not be reached.
	it.each(roles)('places every %s row in exactly one zone', (userRole) => {
		const input = asRole(userRole, { tier: 'premium', features: { bandAudio: true } });
		const zones = [
			bandNavTop(input),
			...bandNavSections(input).map((s) => s.items),
			bandNavFooter(input)
		].map((items) => items.map((i) => i.key));
		const all = zones.flat();
		expect(new Set(all).size).toBe(all.length);
		expect(all.toSorted()).toEqual(
			bandNavItems(input)
				.map((i) => i.key)
				.toSorted()
		);
	});

	it('says which section holds the active row', () => {
		const [schedule, band] = bandNavSections(full);
		expect(sectionHasKey(schedule, 'events')).toBe(true);
		expect(sectionHasKey(band, 'events')).toBe(false);
		expect(sectionHasKey(band, null)).toBe(false);
	});
});

describe('the foot', () => {
	const premium = { tier: 'premium', features: { bandAudio: true } };

	it('puts billing and settings at the foot, and nothing else', () => {
		expect(bandNavFooter(asRole('owner', premium)).map((i) => i.key)).toEqual([
			'subscription',
			'settings'
		]);
	});

	it('keeps an admin out of billing but not out of settings', () => {
		expect(bandNavFooter(asRole('admin', premium)).map((i) => i.key)).toEqual(['settings']);
	});

	it('leaves a plain member nothing to administer', () => {
		expect(bandNavFooter(asRole('member', premium))).toEqual([]);
	});

	it('sends a staff non-member to staff tools, at the foot', () => {
		expect(bandNavFooter(asRole('staff', premium)).map((i) => i.key)).toEqual(['staff-tools']);
	});

	it('leads with Dashboard alone', () => {
		expect(bandNavTop(asRole('owner')).map((i) => i.key)).toEqual(['dashboard']);
	});
});

describe('activeBandNavKey', () => {
	const input = asRole('owner', { tier: 'premium' });

	it('lights the row a detail page belongs to', () => {
		expect(activeBandNavKey(input, '/band/the-velvet-underground/events/abc')).toBe('events');
		expect(activeBandNavKey(input, '/band/the-velvet-underground/press-kit')).toBe('press-kit');
		expect(activeBandNavKey(input, '/band/the-velvet-underground/page-editor')).toBe('page-editor');
		expect(activeBandNavKey(input, '/band/the-velvet-underground/messages/abc')).toBe('messages');
	});

	it('lights the dashboard only on the band root', () => {
		expect(activeBandNavKey(input, '/band/the-velvet-underground')).toBe('dashboard');
	});

	it('lights nothing for another band', () => {
		expect(activeBandNavKey(input, '/band/some-other-band/members')).toBeNull();
	});

	it('falls back to the dashboard for a row the viewer cannot see', () => {
		const member = asRole('member', { tier: 'premium' });
		expect(activeBandNavKey(member, '/band/the-velvet-underground/settings')).toBe('dashboard');
	});

	it('resolves every visible row to its own key, for every role', () => {
		for (const userRole of roles) {
			const forRole = asRole(userRole, { tier: 'premium' });
			for (const item of bandNavItems(forRole)) {
				expect(activeBandNavKey(forRole, item.href)).toBe(item.key);
			}
		}
	});
});
