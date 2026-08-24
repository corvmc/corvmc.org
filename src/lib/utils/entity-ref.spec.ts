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
