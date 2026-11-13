import { describe, expect, it } from 'vitest';
import { fieldsState, organizationBadge } from './section-state';

describe('settings section state', () => {
	it('tells an empty section from a part-filled and a filled one', () => {
		const states = new Set([
			fieldsState(['', null]),
			fieldsState(['Corvallis', '']),
			fieldsState(['Corvallis', 'OR'])
		]);
		expect(states.size).toBe(3);
	});

	it('badges the Organization tab only while a section is not set', () => {
		expect(organizationBadge([['a', 'b'], ['c']])).toBeUndefined();
		expect(organizationBadge([['a', ''], ['c']])).toBeDefined();
	});
});
