import { describe, expect, it } from 'vitest';
import { isOrderLate } from './order-late';

const now = new Date('2026-09-18T12:00:00Z');
const past = new Date('2026-09-01T00:00:00Z');
const future = new Date('2026-10-01T00:00:00Z');

describe('isOrderLate', () => {
	it('is late once a placed order passes its date with lines outstanding', () => {
		expect(isOrderLate({ status: 'placed', expectedAt: past, isComplete: false }, now)).toBe(true);
	});

	it('is not late before the expected date', () => {
		expect(isOrderLate({ status: 'placed', expectedAt: future, isComplete: false }, now)).toBe(
			false
		);
	});

	it('is not late with no expected date at all', () => {
		expect(isOrderLate({ status: 'placed', expectedAt: null, isComplete: false }, now)).toBe(false);
	});

	it('is not late once everything has arrived', () => {
		expect(isOrderLate({ status: 'placed', expectedAt: past, isComplete: true }, now)).toBe(false);
	});

	it.each(['draft', 'closed', 'dropped'])('is not late while %s', (status) => {
		expect(isOrderLate({ status, expectedAt: past, isComplete: false }, now)).toBe(false);
	});
});
