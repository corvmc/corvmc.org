import { describe, it, expect } from 'vitest';
import { chunk, chunkInsert } from './chunk';

/** A stand-in builder: each row binds as many parameters as it has entries. */
const build = (group: number[][]) => ({ group, toSQL: () => ({ params: group.flat() }) });

describe('chunkInsert', () => {
	it('keeps every statement within 100 parameters', () => {
		const rows = Array.from({ length: 60 }, () => [1, 2, 3, 4, 5]);
		const statements = chunkInsert(rows, build);
		expect(statements.map((s) => s.toSQL().params.length)).toEqual([100, 100, 100]);
	});

	it('sizes groups by what each row binds', () => {
		const rows = [Array(60).fill(0), Array(30).fill(0), Array(20).fill(0)];
		expect(chunkInsert(rows, build).map((s) => s.group.length)).toEqual([2, 1]);
	});

	it('returns nothing for no rows', () => {
		expect(chunkInsert([], build)).toEqual([]);
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
