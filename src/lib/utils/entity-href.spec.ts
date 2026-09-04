import { describe, it, expect } from 'vitest';
import { entityHref } from './entity-href';
import { ANONYMOUS, type Panel, type Viewer } from '$lib/types/entity';
import { capabilities as CAPS, entityTypes } from '$lib/config';
import { fakeRef } from '$lib/test/fixtures';

/**
 * Every capability, which is what somebody holding `staff` actually has — the
 * matrix gives that position everything until the narrowing lands. Written out
 * rather than hardcoded so a new capability cannot quietly narrow these
 * fixtures and turn a real regression into a passing test.
 */
const ALL_CAPABILITIES = new Set(
	Object.entries(CAPS).flatMap(([r, actions]) =>
		(actions as readonly string[]).map((a) => `${r}.${a}`)
	)
);

/**
 * `isStaff` and `capabilities` move together here. entityHref decides the staff
 * arm per route now, so a fixture that says "is staff" but holds nothing would
 * assert the behaviour of a position that does not exist.
 */
const viewer = (over: Partial<Viewer> = {}): Viewer => {
	const base: Viewer = {
		userId: 'user-1',
		isStaff: false,
		capabilities: new Set(),
		bandIds: new Set(),
		panel: 'member'
	};
	const merged = { ...base, ...over };
	if (merged.isStaff && over.capabilities === undefined) merged.capabilities = ALL_CAPABILITIES;
	return merged;
};

const PANELS: Panel[] = ['staff', 'band', 'member', 'public'];

describe('entityHref', () => {
	// The case the whole design exists for. One person, one band, one ref —
	// four different right answers depending on where they are standing.
	describe('a staff user who is also a member of the band', () => {
		const ref = fakeRef('band', { id: 'band-1', slug: 'vu' });
		const them = (panel: Panel) => viewer({ isStaff: true, bandIds: new Set(['band-1']), panel });

		it('keeps them in the band panel rather than promoting to staff', () => {
			expect(entityHref(ref, them('band'))).toBe('/band/vu');
		});

		it('gives the staff record in the staff panel', () => {
			expect(entityHref(ref, them('staff'))).toBe('/staff/bands/band-1');
		});

		it('gives the directory entry in the member panel', () => {
			expect(entityHref(ref, them('member'))).toBe('/member/directory/bands/vu');
		});

		it('gives the public entry on the public site', () => {
			expect(entityHref(ref, them('public'))).toBe('/directory/bands/vu');
		});
	});

	describe('fallback when the current panel has no page for the record', () => {
		it('falls back to the richest page they are entitled to', () => {
			// A report has no band-panel page, so a staff user viewing one from
			// inside a band panel still gets the staff page rather than nothing.
			const ref = fakeRef('flag', { id: 'flag-1' });
			expect(entityHref(ref, viewer({ isStaff: true, panel: 'band' }))).toBe('/staff/flags/flag-1');
		});

		it('does not offer a band page to someone who is not in that band', () => {
			const ref = fakeRef('band', { id: 'band-9', slug: 'strangers' });
			// In the band panel, but of a *different* band.
			const href = entityHref(ref, viewer({ bandIds: new Set(['band-1']), panel: 'band' }));
			expect(href).toBe('/member/directory/bands/strangers');
		});
	});

	describe('safety of the derived link', () => {
		it.each(entityTypes)('never sends an anonymous viewer to /staff for a %s', (type) => {
			const href = entityHref(fakeRef(type), ANONYMOUS);
			expect(href === null || !href.startsWith('/staff')).toBe(true);
		});

		it.each(entityTypes)('never sends a signed-in non-staff member to /staff for a %s', (type) => {
			for (const panel of PANELS) {
				const href = entityHref(fakeRef(type), viewer({ panel }));
				expect(href === null || !href.startsWith('/staff')).toBe(true);
			}
		});

		it('returns null for a staff-only record when the viewer is not staff', () => {
			for (const type of ['flag', 'campaign', 'audience'] as const) {
				expect(entityHref(fakeRef(type), viewer())).toBeNull();
			}
		});

		/**
		 * Gear stopped being staff-only in #286. A printed tag on an amp is
		 * scanned by whoever is standing next to it, so a member needs somewhere
		 * to land — but a signed-out scan still has nowhere to go, which is what
		 * lets `/a/[tag]` answer with a login redirect instead of a 404.
		 */
		it('gives a signed-in member somewhere to land for gear', () => {
			expect(entityHref(fakeRef('equipment'), viewer())).toBe('/member/equipment/equipment-1');
			expect(entityHref(fakeRef('asset'), viewer())).toBe('/member/equipment/assets/asset-1');
			expect(entityHref(fakeRef('loan'), viewer())).toBe('/member/equipment/loans');
		});

		it('has nowhere to send a signed-out scan, because the catalog is not public', () => {
			expect(entityHref(fakeRef('asset'), ANONYMOUS)).toBeNull();
			expect(entityHref(fakeRef('equipment'), ANONYMOUS)).toBeNull();
		});

		it('sends staff to the operational record instead', () => {
			const staff = viewer({ isStaff: true, panel: 'staff' });
			expect(entityHref(fakeRef('asset'), staff)).toBe('/staff/inventory/assets/asset-1');
			expect(entityHref(fakeRef('equipment'), staff)).toBe('/staff/inventory/equipment-1');
		});

		it('returns null when the record is gone', () => {
			expect(entityHref(fakeRef('member', { id: null }), viewer({ isStaff: true }))).toBeNull();
		});

		it('defaults to public routes when no viewer context is mounted', () => {
			expect(entityHref(fakeRef('member', { id: 'm1' }), ANONYMOUS)).toBe('/directory/members/m1');
		});
	});

	describe('ownership', () => {
		it('sends a member to their own profile rather than their directory entry', () => {
			const ref = fakeRef('member', { id: 'user-1' });
			expect(entityHref(ref, viewer({ userId: 'user-1' }))).toBe('/member/profile');
		});

		it('gives the booker their reservation, and nobody else one', () => {
			const ref = fakeRef('reservation', { id: 'r1', ownerUserId: 'user-1' });
			expect(entityHref(ref, viewer({ userId: 'user-1' }))).toBe('/member/reservations/r1');
			expect(entityHref(ref, viewer({ userId: 'user-2' }))).toBeNull();
		});

		it("routes a band's own event into the band panel", () => {
			const ref = fakeRef('event', { id: 'e1', bandId: 'band-1', bandSlug: 'vu' });
			const v = viewer({ bandIds: new Set(['band-1']), panel: 'band' });
			expect(entityHref(ref, v)).toBe('/band/vu/events/e1');
		});
	});

	describe('records addressed by slug', () => {
		it('has no non-staff page for a band whose slug is missing', () => {
			const ref = fakeRef('band', { id: 'band-1', slug: null });
			expect(entityHref(ref, viewer())).toBeNull();
			expect(entityHref(ref, viewer({ isStaff: true, panel: 'staff' }))).toBe(
				'/staff/bands/band-1'
			);
		});
	});
});

// ---------------------------------------------------------------------------
// Per-route staff links.
//
// The staff arm used to be one `viewer.isStaff`. That was fine while every
// elevated user held everything; it stops being fine the moment a treasurer
// exists, because a blanket staff link offers them a page that 403s. The
// header above says a mis-derived link is a 403 and never a leak — these pin
// that it is not a 403 either.
// ---------------------------------------------------------------------------
describe('a position that holds only part of the panel', () => {
	const treasurer = (panel: Panel = 'staff') =>
		viewer({
			isStaff: true,
			// finance.read and credit.read, and nothing that would open a member
			// record or the volunteer surfaces.
			capabilities: new Set(['finance.read', 'credit.read', 'user.list']),
			panel
		});

	it('is not offered the staff member record it cannot open', () => {
		const href = entityHref(fakeRef('member', { id: 'm-1' }), treasurer());
		expect(href).not.toBe('/staff/users/m-1');
	});

	it('is not offered a staff inventory record either', () => {
		const href = entityHref(fakeRef('asset', { id: 'a-1' }), treasurer());
		expect(href ?? '').not.toContain('/staff/inventory');
	});

	it('still gets the staff record for something it does hold', () => {
		const withUsers = viewer({
			isStaff: true,
			capabilities: new Set(['user.read']),
			panel: 'staff'
		});
		expect(entityHref(fakeRef('member', { id: 'm-1' }), withUsers)).toBe('/staff/users/m-1');
	});

	it('falls back to a page it can reach rather than returning nothing', () => {
		// The member arm is still open to them: they are signed in.
		const href = entityHref(fakeRef('member', { id: 'm-1' }), treasurer('member'));
		expect(href).toBe('/member/directory/members/m-1');
	});
});
