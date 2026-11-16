import { describe, it, expect } from 'vitest';
import { audienceCount, audiencesBeyondVisibility } from './audience-reach';

const list = { systemKey: null, allowOptIn: false };
const optIn = { systemKey: null, allowOptIn: true };
const allMembers = { systemKey: 'all-members', allowOptIn: false };
const eventAudience = { systemKey: 'event-interest', allowOptIn: false };

describe('audiencesBeyondVisibility (#2773)', () => {
	it('names none for a public event', () => {
		expect(audiencesBeyondVisibility('public', [list, optIn, allMembers])).toEqual([]);
	});

	it('names lists that hold non-members for a members-only event', () => {
		expect(audiencesBeyondVisibility('members', [list, optIn, allMembers, eventAudience])).toEqual([
			list,
			optIn
		]);
	});

	it('names every audience but its own ticket holders for a group event', () => {
		expect(audiencesBeyondVisibility('group', [list, allMembers, eventAudience])).toEqual([
			list,
			allMembers
		]);
	});
});

describe('audienceCount (#2772)', () => {
	it("counts the event audience as the chosen show's people", () => {
		expect(audienceCount({ systemKey: 'event-interest', subscriberCount: 0 }, 4)).toBe(4);
	});

	it('counts every other audience by its stored members', () => {
		expect(audienceCount({ systemKey: 'all-members', subscriberCount: 120 }, 4)).toBe(120);
		expect(audienceCount({ systemKey: null, subscriberCount: 30 }, 4)).toBe(30);
	});
});
