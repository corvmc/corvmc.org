import { describe, it, expect } from 'vitest';
import { shiftLabel, shiftRoleSuffix } from './shift-label';

const base = { roleName: 'Work Parties' };

describe('shiftLabel', () => {
	it('prefers the shift’s own name', () => {
		expect(shiftLabel({ ...base, title: 'Spring Deep Clean', eventTitle: 'Open Mic' })).toBe(
			'Spring Deep Clean'
		);
	});

	it('falls back to the event, which named the shift before titles existed', () => {
		expect(shiftLabel({ ...base, eventTitle: 'Open Mic' })).toBe('Open Mic');
	});

	it('falls back to the role, which is every shift that has neither', () => {
		expect(shiftLabel(base)).toBe('Work Parties');
	});

	it('treats a whitespace-only title as absent rather than as a blank heading', () => {
		expect(shiftLabel({ ...base, title: '   ', eventTitle: 'Open Mic' })).toBe('Open Mic');
	});
});

describe('shiftRoleSuffix', () => {
	it('is null when the role is already the label, so a card does not say it twice', () => {
		expect(shiftRoleSuffix(base)).toBeNull();
	});

	it('names the role beneath a title', () => {
		expect(shiftRoleSuffix({ ...base, title: 'Spring Deep Clean' })).toBe('Work Parties');
	});

	it('names the role beneath an event title', () => {
		expect(shiftRoleSuffix({ ...base, eventTitle: 'Open Mic' })).toBe('Work Parties');
	});
});

describe('a work order with no role', () => {
	it('is labelled by its title, and says it has no role beneath', () => {
		const task = { roleName: null, title: 'Buy paint' };
		expect(shiftLabel(task)).toBe('Buy paint');
		expect(shiftRoleSuffix(task)).toBe('No role');
	});

	it('still has a label with nothing to name it by', () => {
		expect(shiftLabel({ roleName: null })).toBe('Untitled task');
	});
});
