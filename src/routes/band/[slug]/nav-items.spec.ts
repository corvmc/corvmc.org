import { describe, it, expect } from 'vitest';
import { activeBandNavKey, bandNavItems, type BandNavInput } from './nav-items';

/**
 * The band panel's nav gating has been wrong twice in the same file, both times
 * because a role check that read `userRole === 'owner'` also caught admins and
 * staff — `getBandLayout` returns `role ?? 'staff'`, so those two are the same
 * shape as a real role. This pins the whole matrix.
 */
function labelsFor(overrides: Partial<BandNavInput> = {}): string[] {
	return bandNavItems({
		slug: 'the-velvet-underground',
		bandId: 'band-1',
		tier: 'free',
		userRole: 'member',
		isStaff: false,
		...overrides
	}).map((i) => i.label);
}

describe('bandNavItems', () => {
	it('gives every role Dashboard, Members and Events', () => {
		for (const userRole of ['owner', 'admin', 'member', 'staff']) {
			const labels = labelsFor({ userRole, isStaff: userRole === 'staff' });
			expect(labels).toContain('Dashboard');
			expect(labels).toContain('Members');
			expect(labels).toContain('Events');
		}
	});

	/**
	 * The rider is deliberately the one panel page with no role gate at all,
	 * staff included. Its whole premise is that the member who owns the amp is
	 * the one who can say what it needs, so a nav that hid it from plain members
	 * would defeat the feature — and this is the assertion that fails first if
	 * somebody "tidies" it in behind `isOwnerOrAdmin` with the rows above it.
	 */
	it('gives the tech rider to every role, including staff', () => {
		for (const userRole of ['owner', 'admin', 'member', 'staff']) {
			expect(labelsFor({ userRole, isStaff: userRole === 'staff' })).toContain('Tech rider');
		}
	});

	// The reported bug: an admin could not reach the band's address at all,
	// because the whole Settings entry was gated on owner.
	it('gives Settings to an owner and an admin, but not a plain member', () => {
		expect(labelsFor({ userRole: 'owner' })).toContain('Settings');
		expect(labelsFor({ userRole: 'admin' })).toContain('Settings');
		expect(labelsFor({ userRole: 'member' })).not.toContain('Settings');
	});

	it('sends a staff non-member to staff tools instead of Settings', () => {
		const labels = labelsFor({ userRole: 'staff', isStaff: true });
		expect(labels).not.toContain('Settings');
		expect(labels).toContain('Staff tools');
	});

	it('offers no staff-tools shortcut to an ordinary member', () => {
		expect(labelsFor({ userRole: 'member' })).not.toContain('Staff tools');
	});

	// Billing really is owner-only on the server, so this gate stays as it was.
	// The point of the test is that widening Settings did not widen this.
	it('keeps Subscription owner-only', () => {
		expect(labelsFor({ userRole: 'owner' })).toContain('Subscription');
		expect(labelsFor({ userRole: 'admin' })).not.toContain('Subscription');
		expect(labelsFor({ userRole: 'member' })).not.toContain('Subscription');
	});

	// The `bandReservations` flag was retired on main; band booking is on for
	// every member now, so this asserts presence rather than gating.
	it('shows Reservations to every band member', () => {
		for (const userRole of ['owner', 'admin', 'member']) {
			expect(labelsFor({ userRole })).toContain('Reservations');
		}
	});

	/**
	 * Announcements had a nav row gated on an `announcements` flag. The flag is
	 * retired and the module is unlinked rather than launched, so no role gets the
	 * row and the route answers by direct URL only. Relaunching means putting the
	 * row back — and this assertion is what will fail first when someone does,
	 * which is the point of keeping it.
	 */
	it('shows Announcements to nobody while the module is unlinked', () => {
		for (const userRole of ['owner', 'admin', 'member', 'staff']) {
			expect(labelsFor({ userRole, isStaff: userRole === 'staff' })).not.toContain('Announcements');
		}
	});

	// `bandPremium` used to be half of this gate. It launched, so tier is the
	// whole of it now — which is what the free-band case below is here to pin.
	it('shows the page editor only to an admin of a premium band', () => {
		const on = { tier: 'premium' };
		expect(labelsFor({ ...on, userRole: 'admin' })).toContain('Page Editor');
		expect(labelsFor({ ...on, userRole: 'owner' })).toContain('Page Editor');
		expect(labelsFor({ ...on, userRole: 'member' })).not.toContain('Page Editor');
		expect(labelsFor({ userRole: 'admin' })).not.toContain('Page Editor');
	});

	it('offers Edit Profile to owners and admins only', () => {
		expect(labelsFor({ userRole: 'owner' })).toContain('Edit Profile');
		expect(labelsFor({ userRole: 'admin' })).toContain('Edit Profile');
		expect(labelsFor({ userRole: 'member' })).not.toContain('Edit Profile');
		expect(labelsFor({ userRole: 'staff', isStaff: true })).not.toContain('Edit Profile');
	});

	it('offers Press Kit to owners and admins on every tier', () => {
		// The whole point of the free press kit: it must not follow the band site.
		// Asserted on both tiers so a future gate on this row fails here rather
		// than in the wild.
		expect(labelsFor({ userRole: 'owner' })).toContain('Press Kit');
		expect(labelsFor({ userRole: 'admin' })).toContain('Press Kit');
		expect(labelsFor({ userRole: 'admin', tier: 'premium' })).toContain('Press Kit');
	});

	it('withholds Press Kit from members and non-member staff', () => {
		expect(labelsFor({ userRole: 'member' })).not.toContain('Press Kit');
		expect(labelsFor({ userRole: 'staff', isStaff: true })).not.toContain('Press Kit');
	});

	it('points Staff tools at the band id, not its slug', () => {
		const item = bandNavItems({
			slug: 'the-velvet-underground',
			bandId: 'band-1',
			tier: 'free',
			userRole: 'staff',
			isStaff: true
		}).find((i) => i.key === 'staff-tools');

		expect(item?.href).toBe('/staff/bands/band-1');
	});
});

describe('activeBandNavKey', () => {
	const input: BandNavInput = {
		slug: 'the-velvet-underground',
		bandId: 'band-1',
		tier: 'premium',
		userRole: 'owner',
		isStaff: false
	};

	it('lights the section a detail page belongs to', () => {
		// This lit nothing at all before — `NavItem` matched exactly.
		expect(activeBandNavKey(input, '/band/the-velvet-underground/events/abc')).toBe('events');
		expect(activeBandNavKey(input, '/band/the-velvet-underground/press-kit')).toBe('press-kit');
		// The EPK editor used to sit at `/page-editor/epk` and is the reason this
		// function exists. It now 308s to the press kit, so the old path must not
		// light the premium row on its way there.
		expect(activeBandNavKey(input, '/band/the-velvet-underground/page-editor')).toBe('page-editor');
	});

	it('lights the dashboard only on the band root', () => {
		expect(activeBandNavKey(input, '/band/the-velvet-underground')).toBe('dashboard');
	});

	it('never picks View Live Site, whose href leaves the origin', () => {
		// The layout fills that href in; it is empty in the data, and an empty
		// prefix would otherwise match every path.
		for (const path of ['/band/the-velvet-underground', '/band/the-velvet-underground/members']) {
			expect(activeBandNavKey(input, path)).not.toBe('live-site');
		}
	});

	it('lights nothing for another band', () => {
		expect(activeBandNavKey(input, '/band/some-other-band/members')).toBeNull();
	});

	it('falls back to the dashboard for a row the viewer cannot see', () => {
		// Settings is not in a plain member's nav, so the band root is the longest
		// href that still matches. The page guards itself; the nav simply has
		// nothing better to highlight.
		const member: BandNavInput = { ...input, userRole: 'member' };
		expect(activeBandNavKey(member, '/band/the-velvet-underground/settings')).toBe('dashboard');
	});

	it('resolves every visible row to its own key, for every role', () => {
		for (const userRole of ['owner', 'admin', 'member', 'staff']) {
			const forRole = { ...input, userRole, isStaff: userRole === 'staff' };
			for (const item of bandNavItems(forRole)) {
				if (item.external) continue;
				expect(activeBandNavKey(forRole, item.href)).toBe(item.key);
			}
		}
	});
});
