import { describe, expect, it } from 'vitest';
import { parseNeeds } from './needs-filter';

describe('parseNeeds', () => {
	it('keeps a known queue and drops anything else', () => {
		expect(parseNeeds('claims')).toBe('claims');
		expect(parseNeeds('ended')).toBe('ended');
		// Unassigned tasks moved to Tasks' chip (#2625).
		expect(parseNeeds('unassigned')).toBe('');
		expect(parseNeeds('toString')).toBe('');
		expect(parseNeeds('nope')).toBe('');
		expect(parseNeeds(null)).toBe('');
	});
});
