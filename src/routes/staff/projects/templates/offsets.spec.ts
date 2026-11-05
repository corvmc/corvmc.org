import { describe, expect, it } from 'vitest';
import { splitOffset } from './offsets';

describe('splitOffset', () => {
	it('reads back the largest whole unit and the sign', () => {
		expect(splitOffset(-10080)).toEqual({ amount: 7, unit: 'days', direction: 'before' });
		expect(splitOffset(-180)).toEqual({ amount: 3, unit: 'hours', direction: 'before' });
		expect(splitOffset(45)).toEqual({ amount: 45, unit: 'minutes', direction: 'after' });
		expect(splitOffset(0)).toEqual({ amount: 0, unit: 'minutes', direction: 'after' });
	});
});
