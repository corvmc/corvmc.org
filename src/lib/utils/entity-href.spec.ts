import { describe, it, expect } from 'vitest';
import { entityHref } from './entity-href';
import { ANONYMOUS, type Panel, type Viewer } from '$lib/types/entity';
import { entityTypes } from '$lib/config';
import { fakeRef } from '$lib/test/fixtures';

const viewer = (over: Partial<Viewer> = {}): Viewer => ({
	userId: 'user-1',
	isStaff: false,
	bandIds: new Set(),
	panel: 'member',
	...over
});

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
			for (const type of ['flag', 'campaign', 'audience', 'equipment', 'loan'] as const) {
				expect(entityHref(fakeRef(type), viewer())).toBeNull();
			}
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
