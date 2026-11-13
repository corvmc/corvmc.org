import { describe, expect, it } from 'vitest';
import { nextSort, sortDirection } from './sort-token';

describe('sort tokens', () => {
	it('reads the direction of the column the token names, and none for any other', () => {
		expect(sortDirection('name', 'name')).toBe('ascending');
		expect(sortDirection('-name', 'name')).toBe('descending');
		expect(sortDirection('-activity', 'name')).toBe('none');
	});

	it('flips the sorted column and starts another in its first direction', () => {
		expect(nextSort('name', 'name')).toBe('-name');
		expect(nextSort('-name', 'name')).toBe('name');
		expect(nextSort('name', 'activity', true)).toBe('-activity');
		expect(nextSort('name', 'task')).toBe('task');
	});
});
