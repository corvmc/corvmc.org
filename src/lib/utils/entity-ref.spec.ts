import { describe, it, expect } from 'vitest';
import { memberSubtype } from './entity-ref';

describe('memberSubtype', () => {
	it('leaves an ordinary member unmarked', () => {
		expect(memberSubtype('member', false)).toBeNull();
		expect(memberSubtype(null, null)).toBeNull();
	});

	it('marks a sustaining subscriber', () => {
		expect(memberSubtype('member', true)).toBe('sustaining');
	});

	/**
	 * Someone can be both. Staff is the one that changes what they can do to the
	 * record you are looking at, so it wins.
	 */
	it('lets an explicit staff role outrank a subscription', () => {
		expect(memberSubtype('staff', true)).toBe('staff');
		expect(memberSubtype('admin', true)).toBe('admin');
	});

	/**
	 * `role` may still carry the legacy 'sustaining member' role name. The
	 * subscription flag is the source of truth for whether someone is currently
	 * sustaining, and the old role string outlived it.
	 */
	it('ignores the legacy sustaining role name', () => {
		expect(memberSubtype('sustaining member', false)).toBeNull();
		expect(memberSubtype('sustaining member', true)).toBe('sustaining');
	});
});

describe('memberSubtype over positions', () => {
	it('badges a named position as staff', () => {
		// The badge means "not an ordinary member". Positions are unranked, so
		// there is no highest one to render and inventing a glyph per position
		// would put a ranking in the UI the auth model does not have.
		expect(memberSubtype('treasurer', false)).toBe('staff');
		expect(memberSubtype('volunteer_coordinator', false)).toBe('staff');
		expect(memberSubtype('site_moderator', true)).toBe('staff');
	});

	it('still singles out admin', () => {
		expect(memberSubtype('admin', false)).toBe('admin');
		expect(memberSubtype('staff', false)).toBe('staff');
	});

	it('ignores a legacy role name that slipped past the SQL filter', () => {
		expect(memberSubtype('member', false)).toBe(null);
		expect(memberSubtype('sustaining', true)).toBe('sustaining');
		expect(memberSubtype('volunteer', false)).toBe(null);
	});

	it('falls back to the subscription, then to null', () => {
		expect(memberSubtype(null, true)).toBe('sustaining');
		expect(memberSubtype(null, false)).toBe(null);
		expect(memberSubtype(undefined, undefined)).toBe(null);
	});
});
