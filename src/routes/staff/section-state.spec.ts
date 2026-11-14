import { describe, expect, it } from 'vitest';
import { fieldsState } from './section-state';

describe('settings section state', () => {
	it('tells an empty section from a part-filled and a filled one', () => {
		const states = new Set([
			fieldsState(['', null]),
			fieldsState(['Corvallis', '']),
			fieldsState(['Corvallis', 'OR'])
		]);
		expect(states.size).toBe(3);
	});
});
