import { describe, it, expect } from 'vitest';
import { checkInOutcome } from './check-in-outcome';

describe('checkInOutcome', () => {
	it('warns on a ticket already in, and names the person', () => {
		const out = checkInOutcome('Ana', { alreadyIn: true, checkedInAt: new Date() });
		expect(out.tone).toBe('warning');
		expect(out.text).toContain('Ana');
	});

	it('confirms a fresh check-in', () => {
		expect(checkInOutcome('Ana', { alreadyIn: false, checkedInAt: new Date() }).tone).toBe(
			'success'
		);
	});
});
