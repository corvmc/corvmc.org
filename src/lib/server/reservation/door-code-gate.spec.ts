import { describe, it, expect } from 'vitest';
import { bookerTypes } from '#lib/config.js';
import { doorCodeWithheld } from './door-code-gate';

const unpaid = {
	status: 'confirmed',
	paidAt: null,
	refundedAt: null,
	cashDueCents: null
};

describe('doorCodeWithheld', () => {
	it('holds the code on unpaid teaching time, and on no other booker', () => {
		const held = bookerTypes.filter((bookerType) => doorCodeWithheld({ ...unpaid, bookerType }));
		expect(held).toEqual(['instructor']);
	});

	it('releases it once the teaching booking is paid or fully covered', () => {
		const teaching = { ...unpaid, bookerType: 'instructor' };
		expect(doorCodeWithheld({ ...teaching, cashDueCents: 1000 })).toBe(true);
		expect(doorCodeWithheld({ ...teaching, paidAt: new Date() })).toBe(false);
		expect(doorCodeWithheld({ ...teaching, cashDueCents: 0 })).toBe(false);
	});
});
