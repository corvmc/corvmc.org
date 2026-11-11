import { describe, expect, it } from 'vitest';
import { parseNeeds } from './needs-filter';

describe('parseNeeds', () => {
	it('keeps a known queue and drops anything else', () => {
		expect(parseNeeds('claims')).toBe('claims');
		expect(parseNeeds('ended')).toBe('ended');
		expect(parseNeeds('unassigned')).toBe('unassigned');
		expect(parseNeeds('toString')).toBe('');
		expect(parseNeeds('nope')).toBe('');
		expect(parseNeeds(null)).toBe('');
	});
});
