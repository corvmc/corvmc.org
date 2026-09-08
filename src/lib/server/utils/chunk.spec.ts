import { describe, it, expect } from 'vitest';
import { chunk, chunkSize } from './chunk';

describe('chunkSize', () => {
	// The point of the helper: the row budget falls as the row gets wider, and
	// the four shapes in use each land on a different number.
	it('divides the 100-parameter budget by column count', () => {
		expect(chunkSize(4)).toBe(25);
		expect(chunkSize(5)).toBe(20);
		expect(chunkSize(8)).toBe(12);
		expect(chunkSize(9)).toBe(11);
	});

	it('never returns a size whose statement would exceed 100 parameters', () => {
		for (let columns = 1; columns <= 100; columns++) {
			expect(chunkSize(columns) * columns).toBeLessThanOrEqual(100);
		}
	});
});

describe('chunk', () => {
	it('splits into groups of at most size', () => {
		expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
	});

	it('returns one group when everything fits', () => {
		expect(chunk([1, 2], 5)).toEqual([[1, 2]]);
	});

	it('returns nothing for no rows', () => {
		expect(chunk([], 5)).toEqual([]);
	});
});
